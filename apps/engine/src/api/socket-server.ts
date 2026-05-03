import { createServer, type Server as HttpServer } from "node:http";
import { Server as IOServer } from "socket.io";
import type { PoolEvent } from "@sniperbot/shared";
import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";
import { getRecentPools } from "../state/pool-stream.js";
import type { PoolDetector } from "../feeds/pool-detector.js";

const log = childLogger("socket-server");

export interface ServerToClientEvents {
  "pool:new": (event: PoolEvent) => void;
  "system:status": (status: SystemStatus) => void;
}

export interface ClientToServerEvents {
  "pool:replay": (count: number, ack: (events: PoolEvent[]) => void) => void;
}

export interface SystemStatus {
  mode: "paper" | "live";
  detectedTotal: number;
  skipped: number;
  queued: number;
  uptime: number;
  syntheticFeed: boolean;
}

export class SocketServer {
  private http: HttpServer;
  private io: IOServer<ClientToServerEvents, ServerToClientEvents>;
  private readonly detector: PoolDetector;
  private readonly startedAt = Date.now();
  private statusInterval: NodeJS.Timeout | null = null;

  constructor(detector: PoolDetector) {
    this.detector = detector;
    this.http = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, uptime: Date.now() - this.startedAt }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    this.io = new IOServer(this.http, {
      cors: { origin: "*", methods: ["GET", "POST"] },
      transports: ["websocket", "polling"],
    });

    this.io.on("connection", (socket) => {
      log.info({ id: socket.id, clients: this.io.sockets.sockets.size }, "client connected");

      socket.emit("system:status", this.buildStatus());

      socket.on("pool:replay", async (count, ack) => {
        const safe = Math.min(Math.max(1, count), 200);
        const recent = await getRecentPools(safe);
        ack(recent);
      });

      socket.on("disconnect", (reason) => {
        log.info({ id: socket.id, reason }, "client disconnected");
      });
    });

    this.detector.on("pool", (event) => {
      this.io.emit("pool:new", event);
    });
  }

  private buildStatus(): SystemStatus {
    const stats = this.detector.getStats();
    return {
      mode: env.MODE,
      detectedTotal: stats.parsed,
      skipped: stats.skipped,
      queued: stats.queued,
      uptime: Date.now() - this.startedAt,
      syntheticFeed: env.SYNTHETIC_FEED,
    };
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(env.ENGINE_HTTP_PORT, () => {
        log.info({ port: env.ENGINE_HTTP_PORT }, "Socket.io server listening");

        this.statusInterval = setInterval(() => {
          this.io.emit("system:status", this.buildStatus());
        }, 2000);

        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
    await this.io.close();
    await new Promise<void>((resolve, reject) =>
      this.http.close((err) => (err ? reject(err) : resolve())),
    );
    log.info("stopped");
  }
}
