// src/simulation/shadow-portfolio.ts
// Virtual wallet for shadow trading — tracks SOL balance without actual on-chain txns
// Uses real market data but simulated execution

import { getDb } from "../memory/sqlite";
import { logger } from "../utils/logger";

// ─── Types ─────────────────────────────────────────────────────────

export interface ShadowPortfolio {
    id: number;
    name: string;
    initial_balance_sol: number;
    current_balance_sol: number;
    total_deployed_sol: number;
    total_returned_sol: number;
    total_fees_earned_sol: number;
    total_pnl_sol: number;
    total_pnl_pct: number;
    positions_opened: number;
    positions_closed: number;
    win_count: number;
    loss_count: number;
    created_at: string;
    updated_at: string;
}

export interface ShadowPosition {
    id?: number;
    portfolio_id: number;
    pool_address: string;
    token_a_symbol: string;
    token_b_symbol: string;
    token_a_mint: string;
    strategy_type: string;
    bin_step: number;
    bins_below: number;
    bins_above: number;

    // Entry state (captured from real market data)
    entry_price: number;
    entry_amount_sol: number;
    entry_tvl: number;
    entry_volume_24h: number;
    entry_fee_apr: number;
    entry_timestamp: string;

    // Live state (updated by monitor)
    current_price: number;
    price_change_pct: number;
    accumulated_fees_sol: number;
    unrealized_pnl_sol: number;
    unrealized_pnl_pct: number;
    duration_minutes: number;
    last_checked: string;

    // Exit state
    exit_price?: number;
    exit_amount_sol?: number;
    exit_reason?: string;
    exit_timestamp?: string;
    final_pnl_sol?: number;
    final_pnl_pct?: number;

    status: "open" | "closed";

    // DexScreener context at entry
    dex_buy_sell_ratio?: number;
    dex_price_change_1h?: number;
    dex_pair_age_hours?: number;
    dex_liquidity_usd?: number;

    // Debate result (if debate was used)
    debate_bull_score?: number;
    debate_bear_score?: number;
    debate_arbiter_score?: number;
}

// ─── Portfolio CRUD ────────────────────────────────────────────────

export function createPortfolio(name: string, initialBalanceSol: number): ShadowPortfolio {
    const db = getDb();
    db.prepare(`
        INSERT INTO shadow_portfolios (name, initial_balance_sol, current_balance_sol)
        VALUES ($name, $balance, $balance)
    `).run({ $name: name, $balance: initialBalanceSol });

    const row = db.prepare(
        `SELECT * FROM shadow_portfolios WHERE name = $name`
    ).get({ $name: name }) as ShadowPortfolio;

    logger.info({ name, balance: initialBalanceSol }, "Shadow portfolio created");
    return row;
}

export function getPortfolio(portfolioId: number): ShadowPortfolio | null {
    const db = getDb();
    return db.prepare(
        `SELECT * FROM shadow_portfolios WHERE id = $id`
    ).get({ $id: portfolioId }) as ShadowPortfolio | null;
}

export function getDefaultPortfolio(): ShadowPortfolio {
    const db = getDb();
    let portfolio = db.prepare(
        `SELECT * FROM shadow_portfolios ORDER BY id ASC LIMIT 1`
    ).get() as ShadowPortfolio | null;

    if (!portfolio) {
        portfolio = createPortfolio("default", 1.0); // start with 1 SOL virtual
    }
    return portfolio;
}

export function getPortfolioSummary(portfolioId: number): ShadowPortfolio | null {
    const db = getDb();
    return db.prepare(`SELECT * FROM shadow_portfolios WHERE id = $id`).get({ $id: portfolioId }) as ShadowPortfolio | null;
}

// ─── Shadow Position CRUD ──────────────────────────────────────────

export function openShadowPosition(pos: Omit<ShadowPosition, "id" | "status" | "current_price" | "price_change_pct" | "accumulated_fees_sol" | "unrealized_pnl_sol" | "unrealized_pnl_pct" | "duration_minutes" | "last_checked">): ShadowPosition {
    const db = getDb();

    // Deduct from portfolio balance
    db.prepare(`
        UPDATE shadow_portfolios
        SET current_balance_sol = current_balance_sol - $amount,
            total_deployed_sol = total_deployed_sol + $amount,
            positions_opened = positions_opened + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $pid
    `).run({ $amount: pos.entry_amount_sol, $pid: pos.portfolio_id });

    db.prepare(`
        INSERT INTO shadow_positions (
            portfolio_id, pool_address, token_a_symbol, token_b_symbol, token_a_mint,
            strategy_type, bin_step, bins_below, bins_above,
            entry_price, entry_amount_sol, entry_tvl, entry_volume_24h, entry_fee_apr,
            entry_timestamp, current_price, price_change_pct,
            accumulated_fees_sol, unrealized_pnl_sol, unrealized_pnl_pct,
            duration_minutes, last_checked, status,
            dex_buy_sell_ratio, dex_price_change_1h, dex_pair_age_hours, dex_liquidity_usd,
            debate_bull_score, debate_bear_score, debate_arbiter_score
        ) VALUES (
            $pid, $pool, $tokenA, $tokenB, $tokenAMint,
            $strategy, $binStep, $binsBelow, $binsAbove,
            $entryPrice, $entrySol, $entryTvl, $entryVol, $entryApr,
            $entryTs, $entryPrice, 0,
            0, 0, 0,
            0, CURRENT_TIMESTAMP, 'open',
            $bsr, $pc1h, $pairAge, $liq,
            $bullScore, $bearScore, $arbiterScore
        )
    `).run({
        $pid: pos.portfolio_id,
        $pool: pos.pool_address,
        $tokenA: pos.token_a_symbol,
        $tokenB: pos.token_b_symbol,
        $tokenAMint: pos.token_a_mint,
        $strategy: pos.strategy_type,
        $binStep: pos.bin_step,
        $binsBelow: pos.bins_below,
        $binsAbove: pos.bins_above,
        $entryPrice: pos.entry_price,
        $entrySol: pos.entry_amount_sol,
        $entryTvl: pos.entry_tvl,
        $entryVol: pos.entry_volume_24h,
        $entryApr: pos.entry_fee_apr,
        $entryTs: pos.entry_timestamp || new Date().toISOString(),
        $bsr: pos.dex_buy_sell_ratio ?? null,
        $pc1h: pos.dex_price_change_1h ?? null,
        $pairAge: pos.dex_pair_age_hours ?? null,
        $liq: pos.dex_liquidity_usd ?? null,
        $bullScore: pos.debate_bull_score ?? null,
        $bearScore: pos.debate_bear_score ?? null,
        $arbiterScore: pos.debate_arbiter_score ?? null,
    });

    const row = db.prepare(
        `SELECT * FROM shadow_positions WHERE portfolio_id = $pid ORDER BY id DESC LIMIT 1`
    ).get({ $pid: pos.portfolio_id }) as ShadowPosition;

    logger.info({
        pool: pos.pool_address,
        token: `${pos.token_a_symbol}/${pos.token_b_symbol}`,
        amount: pos.entry_amount_sol,
        strategy: pos.strategy_type,
        price: pos.entry_price,
    }, "🔮 Shadow position OPENED");

    return row;
}

export function getOpenShadowPositions(portfolioId?: number): ShadowPosition[] {
    const db = getDb();
    if (portfolioId) {
        return db.prepare(
            `SELECT * FROM shadow_positions WHERE status = 'open' AND portfolio_id = $pid`
        ).all({ $pid: portfolioId }) as ShadowPosition[];
    }
    return db.prepare(
        `SELECT * FROM shadow_positions WHERE status = 'open'`
    ).all() as ShadowPosition[];
}

export function updateShadowPosition(id: number, updates: {
    current_price: number;
    price_change_pct: number;
    accumulated_fees_sol: number;
    unrealized_pnl_sol: number;
    unrealized_pnl_pct: number;
    duration_minutes: number;
}): void {
    const db = getDb();
    db.prepare(`
        UPDATE shadow_positions SET
            current_price = $price,
            price_change_pct = $changePct,
            accumulated_fees_sol = $fees,
            unrealized_pnl_sol = $pnl,
            unrealized_pnl_pct = $pnlPct,
            duration_minutes = $duration,
            last_checked = CURRENT_TIMESTAMP
        WHERE id = $id
    `).run({
        $id: id,
        $price: updates.current_price,
        $changePct: updates.price_change_pct,
        $fees: updates.accumulated_fees_sol,
        $pnl: updates.unrealized_pnl_sol,
        $pnlPct: updates.unrealized_pnl_pct,
        $duration: updates.duration_minutes,
    });
}

export function closeShadowPosition(id: number, exitData: {
    exit_price: number;
    exit_reason: string;
    final_pnl_sol: number;
    final_pnl_pct: number;
    accumulated_fees_sol: number;
}): void {
    const db = getDb();

    // Get position to find portfolio
    const pos = db.prepare(`SELECT * FROM shadow_positions WHERE id = $id`).get({ $id: id }) as ShadowPosition;
    if (!pos) return;

    const exitAmountSol = pos.entry_amount_sol + exitData.final_pnl_sol;

    // Update position
    db.prepare(`
        UPDATE shadow_positions SET
            exit_price = $exitPrice,
            exit_amount_sol = $exitSol,
            exit_reason = $reason,
            exit_timestamp = CURRENT_TIMESTAMP,
            final_pnl_sol = $pnl,
            final_pnl_pct = $pnlPct,
            accumulated_fees_sol = $fees,
            status = 'closed',
            last_checked = CURRENT_TIMESTAMP
        WHERE id = $id
    `).run({
        $id: id,
        $exitPrice: exitData.exit_price,
        $exitSol: exitAmountSol,
        $reason: exitData.exit_reason,
        $pnl: exitData.final_pnl_sol,
        $pnlPct: exitData.final_pnl_pct,
        $fees: exitData.accumulated_fees_sol,
    });

    // Update portfolio
    const isWin = exitData.final_pnl_sol > 0;
    db.prepare(`
        UPDATE shadow_portfolios SET
            current_balance_sol = current_balance_sol + $returnSol,
            total_returned_sol = total_returned_sol + $returnSol,
            total_fees_earned_sol = total_fees_earned_sol + $fees,
            total_pnl_sol = total_pnl_sol + $pnl,
            positions_closed = positions_closed + 1,
            win_count = win_count + $win,
            loss_count = loss_count + $loss,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $pid
    `).run({
        $pid: pos.portfolio_id,
        $returnSol: exitAmountSol,
        $fees: exitData.accumulated_fees_sol,
        $pnl: exitData.final_pnl_sol,
        $win: isWin ? 1 : 0,
        $loss: isWin ? 0 : 1,
    });

    // Update total_pnl_pct
    const portfolio = getPortfolio(pos.portfolio_id);
    if (portfolio) {
        const pnlPct = ((portfolio.current_balance_sol - portfolio.initial_balance_sol) / portfolio.initial_balance_sol) * 100;
        db.prepare(`UPDATE shadow_portfolios SET total_pnl_pct = $pct WHERE id = $id`).run({ $pct: pnlPct, $id: portfolio.id });
    }

    logger.info({
        pool: pos.pool_address,
        token: `${pos.token_a_symbol}/${pos.token_b_symbol}`,
        pnlSol: exitData.final_pnl_sol.toFixed(4),
        pnlPct: exitData.final_pnl_pct.toFixed(1) + "%",
        reason: exitData.exit_reason,
        fees: exitData.accumulated_fees_sol.toFixed(4),
    }, `🔮 Shadow position CLOSED: ${isWin ? "✅ WIN" : "❌ LOSS"}`);
}

export function getShadowHistory(portfolioId: number, limit: number = 50): ShadowPosition[] {
    const db = getDb();
    return db.prepare(
        `SELECT * FROM shadow_positions WHERE portfolio_id = $pid AND status = 'closed' ORDER BY exit_timestamp DESC LIMIT $limit`
    ).all({ $pid: portfolioId, $limit: limit }) as ShadowPosition[];
}
