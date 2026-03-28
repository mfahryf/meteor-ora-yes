// src/memory/strategies.ts
import { getDb } from "./sqlite";

export interface StrategyRecord {
  id?: number;
  name: string;
  type: string;
  description: string;
  binRangeRules: Record<string, [number, number]>;
  directionalSplit: Record<string, number>;
  ratioRules: Record<string, [number, number]>;
  managementRules: Record<string, unknown>;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export function addStrategy(
  s: Omit<StrategyRecord, "id" | "createdAt" | "updatedAt">,
): void {
  const db = getDb();
  const stmt = db.prepare(`
        INSERT INTO strategies (name, type, description, bin_range_rules, directional_split, ratio_rules, management_rules, active)
        VALUES ($name, $type, $desc, $binRules, $dirSplit, $ratioRules, $mgmtRules, $active)
        ON CONFLICT(name) DO UPDATE SET
            type = $type, description = $desc, bin_range_rules = $binRules,
            directional_split = $dirSplit, ratio_rules = $ratioRules,
            management_rules = $mgmtRules, active = $active, updated_at = CURRENT_TIMESTAMP
    `);
  stmt.run({
    $name: s.name,
    $type: s.type,
    $desc: s.description,
    $binRules: JSON.stringify(s.binRangeRules),
    $dirSplit: JSON.stringify(s.directionalSplit),
    $ratioRules: JSON.stringify(s.ratioRules),
    $mgmtRules: JSON.stringify(s.managementRules),
    $active: s.active ? 1 : 0,
  });
}

export function listStrategies(): StrategyRecord[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM strategies ORDER BY created_at DESC")
    .all() as any[];
  return rows.map(rowToStrategy);
}

export function getStrategy(name: string): StrategyRecord | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM strategies WHERE name = $name")
    .get({ $name: name }) as any;
  return row ? rowToStrategy(row) : null;
}

export function setActiveStrategy(name: string): void {
  const db = getDb();
  db.prepare("UPDATE strategies SET active = 0 WHERE active = 1").run();
  db.prepare(
    "UPDATE strategies SET active = 1, updated_at = CURRENT_TIMESTAMP WHERE name = $name",
  ).run({ $name: name });
}

export function getActiveStrategy(): StrategyRecord | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM strategies WHERE active = 1")
    .get() as any;
  return row ? rowToStrategy(row) : null;
}

export function removeStrategy(name: string): boolean {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM strategies WHERE name = $name")
    .run({ $name: name });
  return result.changes > 0;
}

// ─── Seed built-in strategies ──────────────────────────────────────

const BUILTIN_STRATEGIES: Omit<
  StrategyRecord,
  "id" | "createdAt" | "updatedAt"
>[] = [
  {
    name: "Custom Ratio Spot",
    type: "custom_ratio_spot",
    description:
      "Dynamic token/SOL ratio based on price momentum + net buyers. Volatility → bin count, trend → directional split. Standard close on OOR/TP.",
    binRangeRules: {
      lowVolBins: [25, 35],
      medVolBins: [35, 50],
      highVolBins: [50, 60],
      extremeVolBins: [60, 69],
    },
    directionalSplit: { downtrend: 0.75, uptrend: 0.35, flat: 0.55 },
    ratioRules: {
      strongBull: [80, 20],
      bull: [70, 30],
      neutral: [50, 50],
      bear: [30, 70],
      strongBear: [20, 80],
    },
    managementRules: {
      onOorDown: "close",
      onOorUp: "close",
      onProfitPct: null,
      compoundFees: false,
      partialHarvestBps: null,
    },
    active: false,
  },
  {
    name: "Single-Sided Reseed",
    type: "single_sided_reseed",
    description:
      "100% token position with wide bins below. OOR down triggers withdraw + reseed rather than close. For high-volatility degen pools with strong narrative.",
    binRangeRules: {
      lowVolBins: [20, 30],
      medVolBins: [30, 40],
      highVolBins: [40, 50],
      extremeVolBins: [50, 55],
    },
    directionalSplit: { downtrend: 0.85, uptrend: 0.5, flat: 0.7 },
    ratioRules: {
      strongBull: [100, 0],
      bull: [100, 0],
      neutral: [100, 0],
      bear: [100, 0],
      strongBear: [100, 0],
    },
    managementRules: {
      onOorDown: "reseed",
      onOorUp: "hold",
      onProfitPct: null,
      compoundFees: false,
      partialHarvestBps: null,
    },
    active: false,
  },
  {
    name: "Fee Compounding",
    type: "fee_compounding",
    description:
      "Balanced 50/50 with ±35 bins. Auto-claims and re-adds fees when accumulated > $5. Best for stable, range-bound pools with consistent volume.",
    binRangeRules: {
      lowVolBins: [30, 35],
      medVolBins: [35, 40],
      highVolBins: [40, 50],
      extremeVolBins: [50, 55],
    },
    directionalSplit: { downtrend: 0.55, uptrend: 0.45, flat: 0.5 },
    ratioRules: {
      strongBull: [50, 50],
      bull: [50, 50],
      neutral: [50, 50],
      bear: [50, 50],
      strongBear: [50, 50],
    },
    managementRules: {
      onOorDown: "close",
      onOorUp: "close",
      onProfitPct: null,
      compoundFees: true,
      partialHarvestBps: null,
    },
    active: false,
  },
  {
    name: "Multi-Layer",
    type: "multi_layer",
    description:
      "Split capital into 2 layers — inner (60%) and outer (40%) with same base range. Managed as one unit. For mixed-signal, high-volume pools.",
    binRangeRules: {
      lowVolBins: [25, 35],
      medVolBins: [35, 50],
      highVolBins: [50, 60],
      extremeVolBins: [60, 69],
    },
    directionalSplit: { downtrend: 0.7, uptrend: 0.4, flat: 0.5 },
    ratioRules: {
      strongBull: [70, 30],
      bull: [60, 40],
      neutral: [50, 50],
      bear: [40, 60],
      strongBear: [30, 70],
    },
    managementRules: {
      onOorDown: "close",
      onOorUp: "hold",
      onProfitPct: null,
      compoundFees: false,
      partialHarvestBps: null,
    },
    active: false,
  },
  {
    name: "Partial Harvest",
    type: "partial_harvest",
    description:
      "50/50 with slightly wider bins than compounding. Harvests 50% of position when total return hits 10%. Best for high-fee pools with clear take-profit.",
    binRangeRules: {
      lowVolBins: [30, 40],
      medVolBins: [40, 50],
      highVolBins: [50, 65],
      extremeVolBins: [60, 70],
    },
    directionalSplit: { downtrend: 0.55, uptrend: 0.45, flat: 0.5 },
    ratioRules: {
      strongBull: [50, 50],
      bull: [50, 50],
      neutral: [50, 50],
      bear: [50, 50],
      strongBear: [50, 50],
    },
    managementRules: {
      onOorDown: "close",
      onOorUp: "hold",
      onProfitPct: 10,
      compoundFees: false,
      partialHarvestBps: 5000,
    },
    active: false,
  },
];

export function seedStrategies(): void {
  const db = getDb();
  const count = (
    db.prepare("SELECT COUNT(*) as c FROM strategies").get() as any
  ).c;
  if (count > 0) return; // Already seeded

  for (const s of BUILTIN_STRATEGIES) {
    addStrategy(s);
  }

  // Default active: Custom Ratio Spot
  setActiveStrategy("Custom Ratio Spot");
}

function rowToStrategy(row: any): StrategyRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description || "",
    binRangeRules: JSON.parse(row.bin_range_rules || "{}"),
    directionalSplit: JSON.parse(row.directional_split || "{}"),
    ratioRules: JSON.parse(row.ratio_rules || "{}"),
    managementRules: JSON.parse(row.management_rules || "{}"),
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
