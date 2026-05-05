-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "filterScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "peakGainPct" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "FilterPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilterPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FilterPreset_name_key" ON "FilterPreset"("name");

-- CreateIndex
CREATE INDEX "FilterPreset_isActive_idx" ON "FilterPreset"("isActive");

-- CreateIndex
CREATE INDEX "Position_closeReason_idx" ON "Position"("closeReason");
