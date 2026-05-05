import type { FilterConfigDelta, FilterPreset } from "@sniperbot/shared";
import { BUILT_IN_PRESETS } from "@sniperbot/shared";
import { childLogger } from "../utils/logger.js";
import { getPrisma } from "./db.js";
import { filterConfig } from "../config/filter-config.js";

const log = childLogger("filter-presets");

interface PresetRow {
  id: string;
  name: string;
  description: string | null;
  config: unknown;
  isActive: boolean;
  isBuiltIn: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function rowToPreset(r: PresetRow): FilterPreset {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    config: r.config as FilterConfigDelta,
    isActive: r.isActive,
    isBuiltIn: r.isBuiltIn,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

export async function seedBuiltInPresets(): Promise<void> {
  const prisma = getPrisma();
  for (const p of BUILT_IN_PRESETS) {
    await prisma.filterPreset.upsert({
      where: { name: p.name },
      create: {
        name: p.name,
        description: p.description,
        config: p.config as object,
        isBuiltIn: true,
        isActive: false,
      },
      update: {
        description: p.description,
        config: p.config as object,
        isBuiltIn: true,
      },
    });
  }
  log.info({ count: BUILT_IN_PRESETS.length }, "built-in presets seeded");
}

export async function listPresets(): Promise<FilterPreset[]> {
  const rows = (await getPrisma().filterPreset.findMany({
    orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }],
  })) as PresetRow[];
  return rows.map(rowToPreset);
}

export async function loadActivePreset(): Promise<FilterPreset | null> {
  const row = (await getPrisma().filterPreset.findFirst({
    where: { isActive: true },
  })) as PresetRow | null;
  return row ? rowToPreset(row) : null;
}

export async function activatePreset(presetId: string): Promise<FilterPreset> {
  const prisma = getPrisma();
  const target = (await prisma.filterPreset.findUnique({ where: { id: presetId } })) as
    | PresetRow
    | null;
  if (!target) throw new Error(`preset ${presetId} not found`);

  await prisma.$transaction([
    prisma.filterPreset.updateMany({ where: { isActive: true }, data: { isActive: false } }),
    prisma.filterPreset.update({ where: { id: presetId }, data: { isActive: true } }),
  ]);

  const updated = (await prisma.filterPreset.findUnique({ where: { id: presetId } })) as PresetRow;
  filterConfig.setActive(updated.name, updated.config as FilterConfigDelta);
  log.info({ name: updated.name }, "preset activated");
  return rowToPreset(updated);
}

export async function deactivatePresets(): Promise<void> {
  await getPrisma().filterPreset.updateMany({ where: { isActive: true }, data: { isActive: false } });
  filterConfig.clear();
  log.info("active preset cleared (using env defaults)");
}

export async function savePreset(input: {
  name: string;
  description?: string;
  config: FilterConfigDelta;
}): Promise<FilterPreset> {
  const prisma = getPrisma();
  const existing = (await prisma.filterPreset.findUnique({ where: { name: input.name } })) as
    | PresetRow
    | null;
  if (existing?.isBuiltIn) throw new Error("cannot overwrite built-in preset");
  const row = (await prisma.filterPreset.upsert({
    where: { name: input.name },
    create: {
      name: input.name,
      description: input.description,
      config: input.config as object,
      isBuiltIn: false,
      isActive: false,
    },
    update: {
      description: input.description,
      config: input.config as object,
    },
  })) as PresetRow;
  return rowToPreset(row);
}

export async function deletePreset(presetId: string): Promise<void> {
  const prisma = getPrisma();
  const row = (await prisma.filterPreset.findUnique({ where: { id: presetId } })) as
    | PresetRow
    | null;
  if (!row) return;
  if (row.isBuiltIn) throw new Error("cannot delete built-in preset");
  if (row.isActive) {
    filterConfig.clear();
  }
  await prisma.filterPreset.delete({ where: { id: presetId } });
}

export async function bootstrapPresets(): Promise<void> {
  await seedBuiltInPresets();
  const active = await loadActivePreset();
  if (active) {
    filterConfig.setActive(active.name, active.config);
  } else {
    log.info("no active preset — using env defaults");
  }
}
