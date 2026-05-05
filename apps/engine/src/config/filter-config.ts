import { EventEmitter } from "node:events";
import type { FilterConfigDelta, FilterId } from "@sniperbot/shared";
import { env } from "./env.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("filter-config");

export interface ResolvedFilterConfig {
  enabled(id: FilterId): boolean;
  liquidityMinUsd: number;
  liquidityMaxUsd: number;
  lpLockedRequired: boolean;
  mintAuthRenounced: boolean;
  freezeAuthRenounced: boolean;
  topHolderMaxPct: number;
  top10HoldersMaxPct: number;
  devRugRateMax: number;
  honeypotSimRequired: boolean;
  maxSellTaxPct: number;
  bundledLaunchReject: boolean;
  minFilterScore: number;
}

interface RuntimeStoreEvents {
  changed: (active: { name: string; delta: FilterConfigDelta } | null) => void;
}

declare interface FilterConfigStore {
  on<E extends keyof RuntimeStoreEvents>(e: E, listener: RuntimeStoreEvents[E]): this;
  emit<E extends keyof RuntimeStoreEvents>(e: E, ...args: Parameters<RuntimeStoreEvents[E]>): boolean;
}

class FilterConfigStore extends EventEmitter {
  private active: { name: string; delta: FilterConfigDelta } | null = null;

  setActive(name: string, delta: FilterConfigDelta): void {
    this.active = { name, delta };
    log.info({ name, enabledOverrides: Object.keys(delta.enabled ?? {}).length }, "filter preset activated");
    this.emit("changed", this.active);
  }

  clear(): void {
    this.active = null;
    this.emit("changed", null);
  }

  activeName(): string | null {
    return this.active?.name ?? null;
  }

  resolve(): ResolvedFilterConfig {
    const d = this.active?.delta;
    const t = d?.thresholds ?? {};
    const enabledMap = d?.enabled ?? {};
    return {
      enabled: (id) => enabledMap[id] ?? true,
      liquidityMinUsd: t.liquidityMinUsd ?? env.FILTER_LIQUIDITY_MIN_USD,
      liquidityMaxUsd: t.liquidityMaxUsd ?? env.FILTER_LIQUIDITY_MAX_USD,
      lpLockedRequired: t.lpLockedRequired ?? env.FILTER_LP_LOCKED_REQUIRED,
      mintAuthRenounced: t.mintAuthRenounced ?? env.FILTER_MINT_AUTH_RENOUNCED,
      freezeAuthRenounced: t.freezeAuthRenounced ?? env.FILTER_FREEZE_AUTH_RENOUNCED,
      topHolderMaxPct: t.topHolderMaxPct ?? env.FILTER_TOP_HOLDER_MAX_PCT,
      top10HoldersMaxPct: t.top10HoldersMaxPct ?? env.FILTER_TOP_10_HOLDERS_MAX_PCT,
      devRugRateMax: t.devRugRateMax ?? env.FILTER_DEV_RUG_RATE_MAX,
      honeypotSimRequired: t.honeypotSimRequired ?? env.FILTER_HONEYPOT_SIM_REQUIRED,
      maxSellTaxPct: t.maxSellTaxPct ?? env.FILTER_MAX_SELL_TAX_PCT,
      bundledLaunchReject: t.bundledLaunchReject ?? env.FILTER_BUNDLED_LAUNCH_REJECT,
      minFilterScore: t.minFilterScore ?? env.FILTER_MIN_FILTER_SCORE,
    };
  }
}

export const filterConfig = new FilterConfigStore();
export { FilterConfigStore };
