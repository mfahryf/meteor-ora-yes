// src/memory/sqlite.ts
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let _db: Database | null = null;

export function getDb(): Database {
    if (!_db) {
        throw new Error("Database not initialized. Call initDb() first.");
    }
    return _db;
}

export function initDb(path: string = "data/dlmm.db"): Database {
    if (path !== ":memory:") {
        mkdirSync(dirname(path), { recursive: true });
    }

    _db = new Database(path);

    _db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY,
        position_pubkey TEXT,
        pool_address TEXT,
        token_a TEXT,
        token_b TEXT,
        action TEXT,
        amount_sol REAL,
        amount_token REAL,
        tx_signature TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS positions (
        position_pubkey TEXT PRIMARY KEY,
        pool_address TEXT,
        strategy_type TEXT,
        bin_step INTEGER,
        min_bin INTEGER,
        max_bin INTEGER,
        amount_x REAL,
        amount_y REAL,
        opened_at DATETIME,
        closed_at DATETIME,
        final_pnl REAL,
        status TEXT
    );
    CREATE TABLE IF NOT EXISTS fee_claims (
        id INTEGER PRIMARY KEY,
        position_pubkey TEXT,
        fee_a REAL,
        fee_b REAL,
        tx_signature TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS config_log (
        id INTEGER PRIMARY KEY,
        key TEXT,
        old_value TEXT,
        new_value TEXT,
        reason TEXT,
        agent_type TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
        id INTEGER PRIMARY KEY,
        agent_type TEXT,
        goal TEXT,
        tools_called TEXT,
        final_answer TEXT,
        success BOOLEAN,
        duration_ms INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS chat_sessions (
        session_id TEXT PRIMARY KEY,
        message_history TEXT,
        context TEXT,
        created_at DATETIME,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_activity ON chat_sessions(last_activity);
    CREATE TABLE IF NOT EXISTS strategies (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        bin_range_rules TEXT,
        directional_split TEXT,
        ratio_rules TEXT,
        management_rules TEXT,
        active BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS blacklist (
        id INTEGER PRIMARY KEY,
        token_mint TEXT UNIQUE NOT NULL,
        reason TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS smart_wallets (
        id INTEGER PRIMARY KEY,
        address TEXT UNIQUE NOT NULL,
        label TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pool_notes (
        id INTEGER PRIMARY KEY,
        pool_address TEXT NOT NULL,
        note TEXT NOT NULL,
        agent_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pool_notes_pool ON pool_notes(pool_address);
    CREATE INDEX IF NOT EXISTS idx_blacklist_mint ON blacklist(token_mint);
    CREATE TABLE IF NOT EXISTS position_outcomes (
        id INTEGER PRIMARY KEY,
        position_pubkey TEXT,
        pool_address TEXT,
        strategy_type TEXT,
        token_symbol TEXT,
        entry_amount_sol REAL,
        entry_timestamp DATETIME,
        exit_amount_sol REAL,
        exit_timestamp DATETIME,
        fees_earned_sol REAL DEFAULT 0,
        pnl_sol REAL,
        pnl_pct REAL,
        duration_minutes REAL,
        exit_reason TEXT,
        pool_tvl_at_entry REAL,
        pool_volume_at_entry REAL,
        pool_age_hours_at_entry REAL,
        price_change_1h_at_entry REAL,
        bin_step INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_outcomes_strategy ON position_outcomes(strategy_type);
    CREATE INDEX IF NOT EXISTS idx_outcomes_exit_ts ON position_outcomes(exit_timestamp);
    CREATE TABLE IF NOT EXISTS config_change_log (
        id INTEGER PRIMARY KEY,
        key TEXT,
        old_value TEXT,
        new_value TEXT,
        reason TEXT,
        proposed_by TEXT,
        guard_checks TEXT,
        applied BOOLEAN,
        rejection_reason TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_config_log_key ON config_change_log(key);
    CREATE TABLE IF NOT EXISTS shadow_portfolios (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        initial_balance_sol REAL NOT NULL,
        current_balance_sol REAL NOT NULL,
        total_deployed_sol REAL DEFAULT 0,
        total_returned_sol REAL DEFAULT 0,
        total_fees_earned_sol REAL DEFAULT 0,
        total_pnl_sol REAL DEFAULT 0,
        total_pnl_pct REAL DEFAULT 0,
        positions_opened INTEGER DEFAULT 0,
        positions_closed INTEGER DEFAULT 0,
        win_count INTEGER DEFAULT 0,
        loss_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS shadow_positions (
        id INTEGER PRIMARY KEY,
        portfolio_id INTEGER,
        pool_address TEXT,
        token_a_symbol TEXT,
        token_b_symbol TEXT,
        token_a_mint TEXT,
        strategy_type TEXT,
        bin_step INTEGER,
        bins_below INTEGER,
        bins_above INTEGER,
        entry_price REAL,
        entry_amount_sol REAL,
        entry_tvl REAL,
        entry_volume_24h REAL,
        entry_fee_apr REAL,
        entry_timestamp DATETIME,
        current_price REAL,
        price_change_pct REAL DEFAULT 0,
        accumulated_fees_sol REAL DEFAULT 0,
        unrealized_pnl_sol REAL DEFAULT 0,
        unrealized_pnl_pct REAL DEFAULT 0,
        duration_minutes REAL DEFAULT 0,
        last_checked DATETIME,
        exit_price REAL,
        exit_amount_sol REAL,
        exit_reason TEXT,
        exit_timestamp DATETIME,
        final_pnl_sol REAL,
        final_pnl_pct REAL,
        status TEXT DEFAULT 'open',
        dex_buy_sell_ratio REAL,
        dex_price_change_1h REAL,
        dex_pair_age_hours REAL,
        dex_liquidity_usd REAL,
        debate_bull_score REAL,
        debate_bear_score REAL,
        debate_arbiter_score REAL,
        FOREIGN KEY (portfolio_id) REFERENCES shadow_portfolios(id)
    );
    CREATE INDEX IF NOT EXISTS idx_shadow_pos_status ON shadow_positions(status);
    CREATE INDEX IF NOT EXISTS idx_shadow_pos_portfolio ON shadow_positions(portfolio_id);
  `);

    // Seed built-in strategies on first boot
    const { seedStrategies } = require("./strategies") as typeof import("./strategies");
    seedStrategies();

    return _db;
}

export function closeDb(): void {
    if (_db) {
        _db.close();
        _db = null;
    }
}
