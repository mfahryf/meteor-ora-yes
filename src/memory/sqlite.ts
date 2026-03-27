// src/memory/sqlite.ts
import { Database } from "bun:sqlite";

export let db: Database;

export function initDb(path: string = "data/dlmm.db") {
  db = new Database(path);

  db.exec(`
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
  `);
}
