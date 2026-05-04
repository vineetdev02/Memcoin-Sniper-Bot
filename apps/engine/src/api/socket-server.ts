import { createServer, type Server as HttpServer } from "node:http";
import { Server as IOServer } from "socket.io";
import type {
  BankrollSnapshot,
  OrchestratorVerdict,
  PoolEvent,
  Position,
  PositionClosedEvent,
  PositionOpenedEvent,
  PositionUpdateEvent,
} from "@sniperbot/shared";
import { env } from "../config/env.js";
import { childLogger } from "../utils/logger.js";
import { getRecentPools } from "../state/pool-stream.js";
import { getRecentVerdicts } from "../state/verdict-stream.js";
import type { PoolDetector } from "../feeds/pool-detector.js";
import type { FilterOrchestrator } from "../filters/orchestrator.js";
import type { PositionStore } from "../state/position-store.js";
import type { PnlTracker } from "../analytics/pnl-tracker.js";

const log = childLogger("socket-server");

export interface ServerToClientEvents {
  "pool:new": (event: PoolEvent) => void;
  "verdict:new": (verdict: OrchestratorVerdict) => void;
  "system:status": (status: SystemStatus) => void;
  "position:opened": (e: PositionOpenedEvent) => void;
  "position:update": (e: PositionUpdateEvent) => void;
  "position:closed": (e: PositionClosedEvent) => void;
  "bankroll:snapshot": (snap: BankrollSnapshot) => void;
}

export interface ClientToServerEvents {
  "pool:replay": (count: number, ack: (events: PoolEvent[]) => void) => void;
  "verdict:replay": (count: number, ack: (verdicts: OrchestratorVerdict[]) => void) => void;
  "positions:list": (
    ack: (data: { open: Position[]; recentlyClosed: Position[] }) => void,
  ) => void;
  "bankroll:get": (ack: (snap: BankrollSnapshot) => void) => void;
}

export interface SystemStatus {
  mode: "paper" | "live";
  detectedTotal: number;
  skipped: number;
  queued: number;
  uptime: number;
  syntheticFeed: boolean;
  snipes: number;
  rejects: number;
  filterCount: number;
  filterQueue: number;
  openPositions: number;
  realizedPnlUsd: number;
}

export class SocketServer {
  private http: HttpServer;
  private io: IOServer<ClientToServerEvents, ServerToClientEvents>;
  private readonly detector: PoolDetector;
  private readonly orchestrator: FilterOrchestrator;
  private readonly positionStore: PositionStore;
  private readonly pnl: PnlTracker;
  private readonly startedAt = Date.now();
  private statusInterval: NodeJS.Timeout | null = null;

  constructor(
    detector: PoolDetector,
    orchestrator: FilterOrchestrator,
    positionStore: PositionStore,
    pnl: PnlTracker,
  ) {
    this.detector = detector;
    this.orchestrator = orchestrator;
    this.positionStore = positionStore;
    this.pnl = pnl;

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

      socket.on("verdict:replay", async (count, ack) => {
        const safe = Math.min(Math.max(1, count), 200);
        const recent = await getRecentVerdicts(safe);
        ack(recent);
      });

      socket.on("positions:list", (ack) => {
        ack({
          open: this.positionStore.list(),
          recentlyClosed: this.positionStore.recentlyClosed(50),
        });
      });

      socket.on("bankroll:get", (ack) => {
        ack(this.pnl.buildSnapshot());
      });

      socket.on("disconnect", (reason) => {
        log.info({ id: socket.id, reason }, "client disconnected");
      });
    });

    this.detector.on("pool", (event) => this.io.emit("pool:new", event));
    this.orchestrator.on("verdict", (verdict) => this.io.emit("verdict:new", verdict));
    this.positionStore.on("position-opened", (e) => this.io.emit("position:opened", e));
    this.positionStore.on("position-update", (e) => this.io.emit("position:update", e));
    this.positionStore.on("position-closed", (e) => {
      this.io.emit("position:closed", e);
      this.io.emit("bankroll:snapshot", this.pnl.buildSnapshot());
    });
  }

  private buildStatus(): SystemStatus {
    const detectorStats = this.detector.getStats();
    const orchStats = this.orchestrator.getStats();
    const posStats = this.positionStore.getStats();
    return {
      mode: env.MODE,
      detectedTotal: detectorStats.parsed,
      skipped: detectorStats.skipped,
      queued: detectorStats.queued,
      uptime: Date.now() - this.startedAt,
      syntheticFeed: env.SYNTHETIC_FEED,
      snipes: orchStats.snipes,
      rejects: orchStats.rejects,
      filterCount: orchStats.filters,
      filterQueue: orchStats.queued,
      openPositions: posStats.open,
      realizedPnlUsd: posStats.realizedPnlUsd,
    };
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(env.ENGINE_HTTP_PORT, () => {
        log.info({ port: env.ENGINE_HTTP_PORT }, "Socket.io server listening");
        this.statusInterval = setInterval(
          () => this.io.emit("system:status", this.buildStatus()),
          2000,
        );
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
