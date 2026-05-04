import type { Filter } from "./types.js";
import { liquidityMinFilter } from "./liquidity-min.js";
import { mintAuthorityFilter } from "./mint-authority.js";
import { freezeAuthorityFilter } from "./freeze-authority.js";
import { lpLockedFilter } from "./lp-locked.js";
import { topHoldersFilter } from "./top-holders.js";
import { honeypotSimFilter } from "./honeypot-sim.js";
import { devWalletFilter } from "./dev-wallet.js";
import {
  antiSniperWarFilter,
  bundledLaunchFilter,
  insiderDetectionFilter,
  socialSignalFilter,
  volumeVelocityFilter,
} from "./stubs.js";

export const allFilters: Filter[] = [
  honeypotSimFilter,
  lpLockedFilter,
  mintAuthorityFilter,
  freezeAuthorityFilter,
  devWalletFilter,
  topHoldersFilter,
  liquidityMinFilter,
  bundledLaunchFilter,
  insiderDetectionFilter,
  antiSniperWarFilter,
  volumeVelocityFilter,
  socialSignalFilter,
];

export function enabledFilters(): Filter[] {
  return allFilters.filter((f) => f.enabled);
}
