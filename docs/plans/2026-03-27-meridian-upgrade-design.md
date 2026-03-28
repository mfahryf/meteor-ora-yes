# Meridian Upgrade Design

## Overview

Integrate proven Meridian architecture patterns into the DLMM agent:
6 new modules, 4 rewrites, 2 extensions. Production hardening + intelligence layer + strategy brain.

## Decisions

- **Wallet balances**: Helius API (USD values per token, total portfolio)
- **Token research**: Jupiter Datapi (primary) + Birdeye (fallback)
- **Top LPer study**: LPAgent API with key rotation
- **Swap**: Jupiter Ultra (primary) + Quote API (fallback)
- **Strategy system**: Code-based compute functions, rules stored in SQLite
- **Safety**: Multi-layer pre-checks on all write tools

## Architecture

```
src/chain/
  jupiter.ts          ← REWRITE: Ultra API (primary) + Quote API (fallback)
  token-research.ts   ← REWRITE: Jupiter Datapi (primary) + Birdeye (fallback)
  wallet-balances.ts  ← NEW: Helius wallet API (USD values, total portfolio)
  lpagent.ts          ← NEW: Top LPer study via api.lpagent.io
  scanner.ts          ← EXTEND: OHLCV + volume history endpoints
  connection.ts       ← KEEP

src/tools/
  safety.ts           ← REWRITE: multi-layer pre-checks on all write tools
  register.ts         ← EXTEND: new tools, auto-swap hooks
  strategies.ts       ← NEW: 5 built-in strategy compute functions

src/memory/
  strategies.ts       ← EXTEND: JSON columns for strategy rules, seed data
```

## Strategy System

5 built-in strategies, each a pure function:

```typescript
interface DeployParams {
  strategy_type: "spot" | "curve" | "bid_ask";
  bins_below: number;
  bins_above: number;
  amount_sol: number;
  amount_token: number;
  need_swap: boolean;
  swap_amount_sol: number;
  management_rules: {
    on_oor_down: "close" | "reseed" | "hold";
    on_oor_up: "close" | "hold";
    on_profit_pct: number | null;
    compound_fees: boolean;
    partial_harvest_bps: number | null;
  };
}
```

| Strategy | Ratio logic | Bin logic | Management |
|----------|-------------|-----------|------------|
| custom_ratio_spot | price_1h + net_buyers → 20/80 to 80/20 token/SOL | vol→bins(25-69), trend→direction split | Standard: close on OOR/TP |
| single_sided_reseed | 100% token | bins_below=20-50, bins_above=0 | OOR down → withdraw+reseed, not close |
| fee_compounding | 50/50 | Balanced ±35, tighten per study | Claim→re-add fees when >$5 |
| multi_layer | Split per layer | Same base range, stacked shapes | Manage as one unit |
| partial_harvest | 50/50 | Slightly wider than compounding | 10% total return → withdraw 50% |

## Safety System

WRITE tools: deploy_position, close_position, swap_token, claim_fees, add_liquidity, withdraw_liquidity

### deploy_position checks:
1. Config: maxPositions, maxDeployAmount, bin_step range, blockedLaunchpads
2. Duplicates: same pool, same base_mint (force fresh scan, no cache)
3. Balance: SOL >= amount + gasReserve (skip for token-only)
4. Amount: floor/ceiling enforcement

### Auto-swap hooks:
- After close_position: swap base token to SOL if >= $0.10
- After claim_fees: swap claimed token to SOL if autoSwapAfterClaim=true

## Token Research

Jupiter Datapi (`datapi.jup.ag/v1`):
- getTokenInfo: search → mcap, organic, audit, stats_1h/24h, global_fees_sol
- getTokenHolders: top 100 → bundler detection, smart wallet cross-ref with PnL
- getTokenNarrative: ChainInsight narrative

Bundler detection signals:
- common_funder: 2+ wallets funded by same address
- funded_same_window: funded within ±5000 slots

## LPAgent Integration

API: `api.lpagent.io/open-api/v1`
- studyTopLPers(pool, limit): top LPers → filter credible → fetch historical → aggregate patterns
- Returns: avg_hold_hours, avg_win_rate, avg_roi_pct, scalper vs holder count
- Key rotation: comma-separated LPAGENT_API_KEY for round-robin

## Jupiter Ultra

Primary path:
1. GET /order → unsigned tx + requestId
2. Sign → base64
3. POST /execute → signature, amounts

Fallback on 500/errorCode:
1. GET /quote → quoteResponse
2. POST /swap → signed transaction
3. sendRawTransaction → confirm

## Tool Registration (14 tools)

| Tool | Status |
|------|--------|
| deploy_position | Extend: safety + strategy compute |
| close_position | Extend: auto-swap base token |
| swap_token | Rewrite: Ultra + Quote fallback |
| claim_fees | Extend: auto-swap option |
| withdraw_liquidity | New |
| add_liquidity | New |
| get_wallet_balance | Rewrite: Helius API |
| get_token_info | Rewrite: Jupiter Datapi |
| get_token_holders | Rewrite: Datapi + bundler + smart wallets |
| get_token_narrative | Rewrite: Jupiter ChainInsight |
| study_top_lpers | New: LPAgent API |
| get_pool_ohlcv | New: Meteora API |
| get_pool_volume_history | New: Meteora API |
| set_position_note | New: persistent instruction |

## New .env keys

```
HELIUS_API_KEY=
LPAGENT_API_KEY=          # supports comma-separated for key rotation
JUPITER_DATAPI_KEY=       # optional, higher rate limits
```

## Implementation Order

### Phase A: Foundation (safety first)
- Rewrite jupiter.ts → Ultra + Quote fallback
- New wallet-balances.ts → Helius API
- Rewrite safety.ts → multi-layer checks
- Extend register.ts → auto-swap hooks + new liquidity tools
- Add withdraw_liquidity + add_liquidity + set_position_note

### Phase B: Intelligence (research layer)
- Rewrite token-research.ts → Jupiter Datapi + Birdeye
- New lpagent.ts → top LPer study
- Extend scanner.ts → OHLCV + volume history
- Add study_top_lpers + get_pool_ohlcv + get_pool_volume_history tools

### Phase C: Strategy (the brain)
- Extend strategies.ts schema → JSON columns
- New strategies.ts compute functions → 5 strategies
- Seed strategies on first boot
- Wire into screener prompt

### Phase D: Polish
- Update system prompts → strategy-aware
- Update .env.example + config schema
- Integration tests
