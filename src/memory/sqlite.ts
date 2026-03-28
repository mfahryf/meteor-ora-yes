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
