import { EventEmitter } from "node:events";
import PQueue from "p-queue";
import type {
  Decision,
  FilterResult,
  OrchestratorVerdict,
  PoolEvent,
} from "@sniperbot/shared";
import { childLogger } from "../utils/logger.js";
import { getRpcConnection } from "../state/rpc.js";
import { env } from "../config/env.js";
import { enabledFilters } from "./registry.js";
import type { Filter, FilterContext, SyntheticMock } from "./types.js";
import { makeResult } from "./types.js";
import { getPrisma } from "../state/db.js";

const log = childLogger("orchestrator");

interface OrchestratorEvents {
  verdict: (verdict: OrchestratorVerdict) => void;
}

export declare interface FilterOrchestrator {
  on<E extends keyof OrchestratorEvents>(
    event: E,
    listener: OrchestratorEvents[E],
  ): this;
  emit<E extends keyof OrchestratorEvents>(
    event: E,
    ...args: Parameters<OrchestratorEvents[E]>
  ): boolean;
}

export class FilterOrchestrator extends EventEmitter {
  private readonly queue = new PQueue({ concurrency: 8 });
  private readonly filters: Filter[];
  private snipes = 0;
  private rejects = 0;

  constructor() {
    super();
    this.filters = enabledFilters();
    log.info(
      { count: this.filters.length, ids: this.filters.map((f) => f.id) },
      "Filter orchestrator ready",
    );
  }

  getStats() {
    return {
      snipes: this.snipes,
      rejects: this.rejects,
      filters: this.filters.length,
      queued: this.queue.size,
    };
  }

  async evaluate(pool: PoolEvent): Promise<void> {
    await this.queue.add(() => this.runFilters(pool));
  }

  private async runFilters(pool: PoolEvent): Promise<void> {
    const start = Date.now();
    const conn = getRpcConnection();
    const syntheticMock = extractSyntheticMock(pool);
    const ctx: FilterContext = {
      conn,
      isSynthetic: syntheticMock !== undefined,
      syntheticMock,
    };

    const results = await Promise.all(
      this.filters.map(async (f) => {
        try {
          return await f.evaluate(pool, ctx);
        } catch (err) {
          return makeResult(f.id, "error", `unhandled: ${(err as Error).message}`);
        }
      }),
    );

    const verdict = this.computeVerdict(pool, results, Date.now() - start);
    if (verdict.decision === "snipe") this.snipes++;
    else this.rejects++;

    this.emit("verdict", verdict);
    void this.persist(verdict, results).catch((err) =>
      log.warn({ err, sig: pool.signature }, "verdict persist failed"),
    );

    log.info(
      {
        decision: verdict.decision.toUpperCase(),
        score: `${verdict.totalScore}/${verdict.maxScore}`,
        passed: verdict.passedCount,
        failed: verdict.failedCount,
        source: pool.source,
        mint: pool.tokenMint.slice(0, 8) + "…",
        ms: verdict.totalDurationMs,
      },
      "verdict",
    );
  }

  private computeVerdict(
    pool: PoolEvent,
    results: FilterResult[],
    totalDurationMs: number,
  ): OrchestratorVerdict {
    let totalScore = 0;
    let maxScore = 0;
    let passed = 0;
    let failed = 0;
    let firstFailReason = "";

    for (let i = 0; i < this.filters.length; i++) {
      const filter = this.filters[i];
      const result = results[i];
      if (!filter || !result) continue;

      maxScore += 100 * filter.weight;
      if (result.status === "skip" || result.status === "error") continue;

      totalScore += result.score * filter.weight;
      if (result.status === "pass") passed++;
      if (result.status === "fail") {
        failed++;
        if (!firstFailReason) firstFailReason = `${filter.id}: ${result.reason}`;
      }
    }

    const scorePct = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
    const minScore = env.FILTER_MIN_FILTER_SCORE;

    let decision: Decision = "snipe";
    let reason = `score ${scorePct}% ≥ min ${minScore}%`;
    if (failed > 0) {
      decision = "reject";
      reason = firstFailReason;
    } else if (scorePct < minScore) {
      decision = "reject";
      reason = `score ${scorePct}% < min ${minScore}%`;
    }

    return {
      poolAddress: pool.poolAddress,
      signature: pool.signature,
      source: pool.source,
      totalScore: scorePct,
      maxScore: 100,
      passedCount: passed,
      failedCount: failed,
      decision,
      decisionReason: reason,
      results,
      decidedAt: Date.now(),
      totalDurationMs,
    };
  }

  private async persist(
    verdict: OrchestratorVerdict,
    results: FilterResult[],
  ): Promise<void> {
    const prisma = getPrisma();
    const pool = await prisma.pool.findUnique({ where: { poolAddress: verdict.poolAddress } });
    if (!pool) return;

    await prisma.$transaction([
      prisma.poolDecision.upsert({
        where: { poolAddress: verdict.poolAddress },
        create: {
          poolAddress: verdict.poolAddress,
          decision: verdict.decision,
          totalScore: verdict.totalScore,
          decisionReason: verdict.decisionReason,
          decidedAt: new Date(verdict.decidedAt),
        },
        update: {
          decision: verdict.decision,
          totalScore: verdict.totalScore,
          decisionReason: verdict.decisionReason,
          decidedAt: new Date(verdict.decidedAt),
        },
      }),
      ...results.map((r) =>
        prisma.filterResult.create({
          data: {
            poolId: pool.id,
            filterId: r.filterId,
            passed: r.status === "pass",
            score: r.score,
            reason: r.reason,
            metadata: r.metadata as object | undefined,
            evaluatedAt: new Date(r.evaluatedAt),
            durationMs: r.durationMs,
          },
        }),
      ),
    ]);
  }
}

function extractSyntheticMock(pool: PoolEvent): SyntheticMock | undefined {
  const raw = pool.rawEvent as { synthetic?: boolean; mock?: SyntheticMock } | undefined;
  if (raw?.synthetic && raw.mock) return raw.mock;
  return undefined;
}
