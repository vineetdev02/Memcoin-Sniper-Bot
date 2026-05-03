-- CreateEnum
CREATE TYPE "Mode" AS ENUM ('paper', 'live');

-- CreateEnum
CREATE TYPE "DexSource" AS ENUM ('pumpfun', 'pumpswap', 'raydium_amm', 'raydium_clmm', 'raydium_launchpad', 'meteora', 'orca');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('snipe', 'reject');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('open', 'partial', 'closed');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('buy', 'sell');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('filled', 'failed', 'partial');

-- CreateEnum
CREATE TYPE "ExitReason" AS ENUM ('tp1', 'tp2', 'tp3', 'tp4', 'stop_loss', 'trailing_stop', 'time_exit', 'rug_pull', 'kill_switch', 'manual');

-- CreateTable
CREATE TABLE "Pool" (
    "id" TEXT NOT NULL,
    "poolAddress" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "baseMint" TEXT NOT NULL,
    "source" "DexSource" NOT NULL,
    "initialLiquidityUsd" DOUBLE PRECISION NOT NULL,
    "initialPriceUsd" DOUBLE PRECISION NOT NULL,
    "creatorWallet" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "signature" TEXT NOT NULL,
    "rawEvent" JSONB,

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilterResult" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "filterId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,

    CONSTRAINT "FilterResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolDecision" (
    "id" TEXT NOT NULL,
    "poolAddress" TEXT NOT NULL,
    "decision" "Decision" NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "decisionReason" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "entryPriceUsd" DOUBLE PRECISION NOT NULL,
    "entrySizeUsd" DOUBLE PRECISION NOT NULL,
    "tokensHeld" DOUBLE PRECISION NOT NULL,
    "currentPriceUsd" DOUBLE PRECISION NOT NULL,
    "unrealizedPnlUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "realizedPnlUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "peakPriceUsd" DOUBLE PRECISION NOT NULL,
    "tpLadder" JSONB NOT NULL,
    "stopLossPct" DOUBLE PRECISION NOT NULL,
    "trailingStopArmed" BOOLEAN NOT NULL DEFAULT false,
    "status" "PositionStatus" NOT NULL DEFAULT 'open',
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closeReason" "ExitReason",

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "status" "TradeStatus" NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "amountTokens" DOUBLE PRECISION NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "feeSol" DOUBLE PRECISION NOT NULL,
    "slippagePct" DOUBLE PRECISION NOT NULL,
    "mevPenaltyPct" DOUBLE PRECISION,
    "exitReason" "ExitReason",
    "signature" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuggedDevWallet" (
    "walletAddress" TEXT NOT NULL,
    "rugCount" INTEGER NOT NULL DEFAULT 0,
    "totalLaunches" INTEGER NOT NULL DEFAULT 0,
    "rugRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT,
    "notes" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuggedDevWallet_pkey" PRIMARY KEY ("walletAddress")
);

-- CreateTable
CREATE TABLE "BankrollSnapshot" (
    "id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "balanceUsd" DOUBLE PRECISION NOT NULL,
    "realizedPnl" DOUBLE PRECISION NOT NULL,
    "openExposure" DOUBLE PRECISION NOT NULL,
    "positionCnt" INTEGER NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankrollSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pool_poolAddress_key" ON "Pool"("poolAddress");

-- CreateIndex
CREATE INDEX "Pool_detectedAt_idx" ON "Pool"("detectedAt");

-- CreateIndex
CREATE INDEX "Pool_creatorWallet_idx" ON "Pool"("creatorWallet");

-- CreateIndex
CREATE INDEX "Pool_source_idx" ON "Pool"("source");

-- CreateIndex
CREATE INDEX "FilterResult_poolId_idx" ON "FilterResult"("poolId");

-- CreateIndex
CREATE INDEX "FilterResult_filterId_passed_idx" ON "FilterResult"("filterId", "passed");

-- CreateIndex
CREATE UNIQUE INDEX "PoolDecision_poolAddress_key" ON "PoolDecision"("poolAddress");

-- CreateIndex
CREATE INDEX "PoolDecision_decidedAt_idx" ON "PoolDecision"("decidedAt");

-- CreateIndex
CREATE INDEX "PoolDecision_decision_idx" ON "PoolDecision"("decision");

-- CreateIndex
CREATE INDEX "Position_status_idx" ON "Position"("status");

-- CreateIndex
CREATE INDEX "Position_openedAt_idx" ON "Position"("openedAt");

-- CreateIndex
CREATE INDEX "Position_mode_idx" ON "Position"("mode");

-- CreateIndex
CREATE INDEX "Trade_positionId_idx" ON "Trade"("positionId");

-- CreateIndex
CREATE INDEX "Trade_executedAt_idx" ON "Trade"("executedAt");

-- CreateIndex
CREATE INDEX "RuggedDevWallet_rugRate_idx" ON "RuggedDevWallet"("rugRate");

-- CreateIndex
CREATE INDEX "BankrollSnapshot_mode_takenAt_idx" ON "BankrollSnapshot"("mode", "takenAt");

-- AddForeignKey
ALTER TABLE "FilterResult" ADD CONSTRAINT "FilterResult_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;
