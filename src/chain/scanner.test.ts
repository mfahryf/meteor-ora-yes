// src/chain/scanner.test.ts
import { expect, test, mock } from "bun:test";
import { discoverPools, getPoolDetail, searchPools } from "./scanner";

const mockPoolRaw = {
  address: "PoolABC",
  token_x: { address: "MintA", symbol: "SOL", decimals: 9 },
  token_y: { address: "MintB", symbol: "BONK", decimals: 5 },
  pool_config: { bin_step: 100, base_fee_pct: 1, max_fee_pct: 2, protocol_fee_pct: 0.1 },
  tvl: 50000,
  volume: { "24h": 10000 },
  fees: { "24h": 50 },
  apr: 12.5,
  current_price: 0.001,
};

const paginatedResponse = { data: [mockPoolRaw, { ...mockPoolRaw, tvl: 100, address: "SmallPool" }], current_page: 1, page_size: 50, total: 2 };

test("discoverPools returns filtered pools", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async (url: string) => {
    return new Response(JSON.stringify(paginatedResponse), {
      headers: { "content-type": "application/json" },
    });
  }) as any;

  const pools = await discoverPools({ minTvl: 1000 });
  expect(pools.length).toBe(1);
  expect(pools[0].address).toBe("PoolABC");
  expect(pools[0].tokenBSymbol).toBe("BONK");

  globalThis.fetch = originalFetch;
});

test("discoverPools throws on API error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 500 }))) as any;

  await expect(discoverPools()).rejects.toThrow("Pool discovery failed");

  globalThis.fetch = originalFetch;
});

test("getPoolDetail returns single pool", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async (url: string) => {
    return new Response(JSON.stringify(mockPoolRaw), {
      headers: { "content-type": "application/json" },
    });
  }) as any;

  const pool = await getPoolDetail("PoolABC");
  expect(pool.address).toBe("PoolABC");
  expect(pool.tvl).toBe(50000);

  globalThis.fetch = originalFetch;
});

test("searchPools uses query param", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async (url: string) => {
    // Verify query param is present in URL
    expect(url).toContain("query=BONK");
    return new Response(JSON.stringify({ data: [mockPoolRaw] }), {
      headers: { "content-type": "application/json" },
    });
  }) as any;

  const results = await searchPools("BONK");
  expect(results.length).toBe(1);
  expect(results[0].tokenBSymbol).toBe("BONK");

  globalThis.fetch = originalFetch;
});
