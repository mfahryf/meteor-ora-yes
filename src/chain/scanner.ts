// src/chain/scanner.ts
// Pool discovery via Meteora DLMM API
// Docs: https://dlmm.datapi.meteora.ag/api-docs/openapi.json

import { logger } from "../utils/logger";

export interface PoolInfo {
  address: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  binStep: number;
  baseFeePct: number;
  tvl: number;
  volume24h: number;
  fees24h: number;
  feeApr: number;
  currentPrice: number;
  feeActiveTvlRatio?: number;
  volatility?: number;
  priceTrend?: "up" | "down" | "flat";
}

export interface ScannerFilter {
  minTvl?: number;
  maxTvl?: number;
  minVolume?: number;
  minBinStep?: number;
  maxBinStep?: number;
  category?: "trending" | "new" | "volume";
  limit?: number;
}

const METEORA_API = "https://dlmm.datapi.meteora.ag";

const SORT_MAP: Record<string, string> = {
  trending: "volume_24h:desc",
  volume: "volume_24h:desc",
  new: "pool_created_at:desc",
};

export async function discoverPools(filter: ScannerFilter = {}): Promise<PoolInfo[]> {
  const params = new URLSearchParams();
  const pageSize = Math.min(filter.limit || 50, 1000);
  params.set("page_size", String(pageSize));
  params.set("page", "1");

  if (filter.category) {
    params.set("sort_by", SORT_MAP[filter.category] || "volume_24h:desc");
  }

  // Use server-side filter_by for numeric fields
  const filterExprs: string[] = [];
  if (filter.minTvl) filterExprs.push(`tvl>${filter.minTvl}`);
  if (filter.maxTvl) filterExprs.push(`tvl<${filter.maxTvl}`);
  if (filter.minVolume) filterExprs.push(`volume_24h>${filter.minVolume}`);
  if (filter.minBinStep) filterExprs.push(`bin_step>=${filter.minBinStep}`);
  if (filter.maxBinStep) filterExprs.push(`bin_step<=${filter.maxBinStep}`);
  if (filterExprs.length > 0) {
    params.set("filter_by", filterExprs.join(" && "));
  }

  const url = `${METEORA_API}/pools?${params.toString()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Meteora API returned ${res.status}`);

    const json = await res.json() as { data: any[] };
    const pools = json.data.map(normalizePool);

    // Client-side safety filter in case server-side filter_by isn't applied
    return applyFilters(pools, filter);
  } catch (error) {
    throw new Error(`Pool discovery failed: ${error instanceof Error ? error.message : error}`);
  }
}

export async function getPoolDetail(poolAddress: string): Promise<PoolInfo> {
  try {
    const res = await fetch(`${METEORA_API}/pools/${poolAddress}`);
    if (!res.ok) throw new Error(`Pool ${poolAddress} not found (${res.status})`);

    const data = await res.json();
    return normalizePool(data);
  } catch (error) {
    throw new Error(`Failed to get pool detail: ${error instanceof Error ? error.message : error}`);
  }
}

export async function searchPools(query: string, limit: number = 10): Promise<PoolInfo[]> {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("page_size", String(limit));

  const url = `${METEORA_API}/pools?${params.toString()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Meteora API returned ${res.status}`);

    const json = await res.json() as { data: any[] };
    return json.data.map(normalizePool);
  } catch (error) {
    throw new Error(`Pool search failed: ${error instanceof Error ? error.message : error}`);
  }
}

function normalizePool(raw: any): PoolInfo {
  const tokenX = raw.token_x || {};
  const tokenY = raw.token_y || {};
  const poolConfig = raw.pool_config || {};
  const volume = raw.volume || {};
  const fees = raw.fees || {};

  return {
    address: raw.address || "",
    tokenAMint: tokenX.address || "",
    tokenBMint: tokenY.address || "",
    tokenASymbol: tokenX.symbol || "",
    tokenBSymbol: tokenY.symbol || "",
    binStep: poolConfig.bin_step || 0,
    baseFeePct: poolConfig.base_fee_pct || 0,
    tvl: raw.tvl || 0,
    volume24h: volume["24h"] || 0,
    fees24h: fees["24h"] || 0,
    feeApr: raw.apr || raw.fee_tvl_ratio?.["24h"] || 0,
    currentPrice: raw.current_price || 0,
  };
}

// ─── OHLCV + Volume History ─────────────────────────────────────────

export interface OHLCVCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface VolumeRecord {
  timestamp: number;
  volume: number;
}

export type TimeFrame = "5m" | "30m" | "1h" | "2h" | "4h" | "12h" | "24h";

export async function getPoolOHLCV(
  poolAddress: string,
  timeframe: TimeFrame = "24h",
  startTime?: number,
  endTime?: number
): Promise<OHLCVCandle[]> {
  const params = new URLSearchParams();
  if (timeframe) params.set("timeframe", timeframe);
  if (startTime) params.set("start_time", String(startTime));
  if (endTime) params.set("end_time", String(endTime));

  try {
    const res = await fetch(`${METEORA_API}/pools/${poolAddress}/ohlcv?${params}`);
    if (!res.ok) throw new Error(`OHLCV API returned ${res.status}`);

    const json = await res.json() as any;
    const candles = (json.data ?? json) as any[];
    return candles.map((c: any) => ({
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
  } catch (error) {
    throw new Error(`Failed to get OHLCV: ${error instanceof Error ? error.message : error}`);
  }
}

export async function getPoolVolumeHistory(
  poolAddress: string,
  timeframe: TimeFrame = "24h",
  startTime?: number,
  endTime?: number
): Promise<VolumeRecord[]> {
  const params = new URLSearchParams();
  if (timeframe) params.set("timeframe", timeframe);
  if (startTime) params.set("start_time", String(startTime));
  if (endTime) params.set("end_time", String(endTime));

  try {
    const res = await fetch(`${METEORA_API}/pools/${poolAddress}/volume/history?${params}`);
    if (!res.ok) throw new Error(`Volume history API returned ${res.status}`);

    const json = await res.json() as any;
    const records = (json.data ?? json) as any[];
    return records.map((r: any) => ({
      timestamp: r.timestamp,
      volume: r.volume,
    }));
  } catch (error) {
    throw new Error(`Failed to get volume history: ${error instanceof Error ? error.message : error}`);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────

function applyFilters(pools: PoolInfo[], filter: ScannerFilter): PoolInfo[] {
  return pools.filter(p => {
    if (filter.minTvl && p.tvl < filter.minTvl) return false;
    if (filter.maxTvl && p.tvl > filter.maxTvl) return false;
    if (filter.minVolume && p.volume24h < filter.minVolume) return false;
    if (filter.minBinStep && p.binStep < filter.minBinStep) return false;
    if (filter.maxBinStep && p.binStep > filter.maxBinStep) return false;
    return true;
  });
}
