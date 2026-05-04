import type { BankrollSnapshot, Position } from "@sniperbot/shared";
import { childLogger } from "../utils/logger.js";
import { env } from "../config/env.js";
import { getPrisma } from "../state/db.js";
import type { PositionStore } from "../state/position-store.js";

const log = childLogger("pnl");

export class PnlTracker {
  private readonly store: PositionStore;
  private readonly startingBalance: number;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private wins = 0;
  private losses = 0;
  private totalWinPct = 0;
  private totalLossPct = 0;
  private totalGrossWinUsd = 0;
  private totalGrossLossUsd = 0;
  private totalTrades = 0;

  constructor(store: PositionStore) {
    this.store = store;
    this.startingBalance = env.PAPER_STARTING_BALANCE_USD;

    store.on("position-closed", ({ position }) => this.onClose(position));
  }

  private onClose(p: Position): void {
    this.totalTrades++;
    const pct = (p.realizedPnlUsd / p.entrySizeUsd) * 100;
    if (p.realizedPnlUsd >= 0) {
      this.wins++;
      this.totalWinPct += pct;
      this.totalGrossWinUsd += p.realizedPnlUsd;
    } else {
      this.losses++;
      this.totalLossPct += pct;
      this.totalGrossLossUsd += Math.abs(p.realizedPnlUsd);
    }
  }

  start(intervalMs = 60_000): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setInterval(() => void this.takeSnapshot(), intervalMs);
    log.info({ intervalMs }, "pnl tracker started");
  }

  stop(): void {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.snapshotTimer = null;
  }

  buildSnapshot(): BankrollSnapshot {
    const stats = this.store.getStats();
    const balanceUsd = this.startingBalance + stats.realizedPnlUsd;
    const totalClosed = this.wins + this.losses;
    return {
      balanceUsd,
      realizedPnlUsd: stats.realizedPnlUsd,
      unrealizedPnlUsd: stats.unrealizedPnlUsd,
      openExposureUsd: stats.openExposureUsd,
      openPositionCount: stats.open,
      totalTrades: totalClosed,
      wins: this.wins,
      losses: this.losses,
      winRatePct: totalClosed > 0 ? (this.wins / totalClosed) * 100 : 0,
      avgWinPct: this.wins > 0 ? this.totalWinPct / this.wins : 0,
      avgLossPct: this.losses > 0 ? this.totalLossPct / this.losses : 0,
      profitFactor:
        this.totalGrossLossUsd > 0
          ? this.totalGrossWinUsd / this.totalGrossLossUsd
          : this.totalGrossWinUsd > 0
            ? Infinity
            : 0,
      takenAt: Date.now(),
    };
  }

  private async takeSnapshot(): Promise<void> {
    const snap = this.buildSnapshot();
    try {
      const prisma = getPrisma();
      await prisma.bankrollSnapshot.create({
        data: {
          mode: env.MODE,
          balanceUsd: snap.balanceUsd,
          realizedPnl: snap.realizedPnlUsd,
          openExposure: snap.openExposureUsd,
          positionCnt: snap.openPositionCount,
        },
      });
    } catch (err) {
      log.warn({ err }, "snapshot persist failed");
    }
  }
}
