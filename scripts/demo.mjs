#!/usr/bin/env node
// `pnpm demo`: the whole bot on fake launches, in one command.
//
// Starts a throwaway Postgres and Redis, then the engine with SYNTHETIC_FEED on
// and the bot switched on, then the dashboard. Nothing in your .env is used: the
// engine gets .env.example plus the overrides below, so a real Helius key or
// Telegram bot cannot be used by accident. Ctrl+C stops everything and deletes
// the demo database.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = join(root, "apps", "engine");
const dashboardDir = join(root, "apps", "dashboard");
const compose = ["compose", "-p", "sniperbot-demo", "-f", join(root, "scripts", "demo.compose.yml")];

const say = (msg) => console.log(`[demo] ${msg}`);

function fail(msg) {
  console.error(`[demo] ${msg}`);
  process.exit(1);
}

function docker(args) {
  return spawnSync("docker", [...compose, ...args], { encoding: "utf8" });
}

/** The first port at or above `from` that nothing is listening on. */
function freePort(from) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(freePort(from + 1)));
    server.listen(from, () => server.close(() => resolve(from)));
  });
}

/** Docker picked the host port; ask it which. */
function hostPort(service, containerPort) {
  const out = (docker(["port", service, String(containerPort)]).stdout ?? "").trim();
  return Number(out.split(":").pop()) || null;
}

async function waitFor(url, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function tail(file, lines = 25) {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "(no log)";
  }
}

// === Preflight ===
for (const dir of [root, engineDir, dashboardDir]) {
  if (!existsSync(join(dir, "node_modules"))) fail("dependencies are missing. Run `pnpm install` first.");
}
const dockerCheck = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
if (dockerCheck.error || dockerCheck.status !== 0) {
  fail("Docker with Compose v2 is needed for the demo's Postgres and Redis. Install Docker, start it, and run `pnpm demo` again.");
}

const requireEngine = createRequire(join(engineDir, "package.json"));
const requireDashboard = createRequire(join(dashboardDir, "package.json"));
const tsxCli = requireEngine.resolve("tsx/cli");
const prismaCli = requireEngine.resolve("prisma/build/index.js");
const nextCli = requireDashboard.resolve("next/dist/bin/next");
const { io } = requireDashboard("socket.io-client");

// === Shutdown, set up before anything starts so Ctrl+C always cleans up ===
const children = [];
let stopping = false;

async function stop(code) {
  if (stopping) return;
  stopping = true;
  say("stopping…");
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGINT");
  }
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 15_000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    ),
  );
  docker(["down", "-v", "--remove-orphans"]);
  say("stopped, and the demo database is deleted.");
  process.exit(code);
}

process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));

// === Postgres and Redis ===
say("starting a throwaway Postgres and Redis in Docker (the first run downloads the images)…");
const up = docker(["up", "-d", "--wait"]);
if (up.status !== 0) {
  console.error(up.stderr);
  await stop(1);
}
const pgPort = hostPort("postgres", 5432);
const redisPort = hostPort("redis", 6379);
if (!pgPort || !redisPort) {
  say("could not find the ports Docker gave Postgres and Redis");
  await stop(1);
}
const enginePort = await freePort(4000);
const dashboardPort = await freePort(3000);

const engineEnv = {
  ...process.env,
  // dotenv reads this instead of .env, and never overrides what is set here.
  DOTENV_CONFIG_PATH: join(root, ".env.example"),
  MODE: "paper",
  ENABLE_LIVE_TRADING: "false",
  SYNTHETIC_FEED: "true",
  HELIUS_API_KEY: "",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_CHAT_ID: "",
  DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${pgPort}/sniperbot`,
  REDIS_URL: `redis://127.0.0.1:${redisPort}`,
  ENGINE_HTTP_PORT: String(enginePort),
};

say("creating the tables…");
for (const args of [["migrate", "deploy"], ["generate"]]) {
  const run = spawnSync(process.execPath, [prismaCli, ...args], { cwd: engineDir, env: engineEnv, encoding: "utf8" });
  if (run.status !== 0) {
    console.error(run.stdout, run.stderr);
    say(`prisma ${args.join(" ")} failed`);
    await stop(1);
  }
}

// === Engine and dashboard, with their logs in files so the terminal stays readable ===
const logDir = mkdtempSync(join(tmpdir(), "sniperbot-demo-"));
const engineLog = join(logDir, "engine.log");
const dashboardLog = join(logDir, "dashboard.log");

function start(name, args, cwd, env, log) {
  const fd = openSync(log, "a");
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", fd, fd] });
  child.once("exit", (code) => {
    if (stopping) return;
    say(`the ${name} exited (code ${code}). The end of its log:\n${tail(log)}`);
    void stop(1);
  });
  children.push(child);
  return child;
}

say("starting the engine…");
const engine = start("engine", [tsxCli, "src/index.ts"], engineDir, engineEnv, engineLog);
if (!(await waitFor(`http://127.0.0.1:${enginePort}/health`, 60_000, engine))) {
  if (!stopping) {
    say(`the engine did not come up. The end of its log:\n${tail(engineLog)}`);
    await stop(1);
  }
}

// The bot always boots OFF. On the synthetic feed it spends no RPC credits, so switch it on.
const botOn = await new Promise((resolve) => {
  const socket = io(`http://127.0.0.1:${enginePort}`, { transports: ["websocket"] });
  const timer = setTimeout(() => {
    socket.close();
    resolve(false);
  }, 10_000);
  socket.on("connect", () => {
    socket.emit("bot:set", true, (result) => {
      clearTimeout(timer);
      socket.close();
      resolve(result.ok && result.botOn);
    });
  });
});
if (!botOn) say("could not switch the bot on; press Bot OFF → ON in the dashboard header.");

say("starting the dashboard (the first page compile takes a little while)…");
const dashboard = start(
  "dashboard",
  [nextCli, "dev", "-p", String(dashboardPort)],
  dashboardDir,
  { ...process.env, NEXT_PUBLIC_ENGINE_URL: `http://localhost:${enginePort}` },
  dashboardLog,
);
if (!(await waitFor(`http://localhost:${dashboardPort}/`, 180_000, dashboard))) {
  if (!stopping) {
    say(`the dashboard did not come up. The end of its log:\n${tail(dashboardLog)}`);
    await stop(1);
  }
}

console.log(`
  Memecoin Sniper Bot demo is running.

  Dashboard   http://localhost:${dashboardPort}
  Feed        synthetic: fake launches every few seconds, rugs included
  Trading     paper only, no wallet, no API key, no real money

  Logs        ${engineLog}
              ${dashboardLog}

  Press Ctrl+C to stop. The demo database is deleted when it stops.
`);
