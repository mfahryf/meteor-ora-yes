// src/telegram/session.ts
import { getDb } from "../memory/sqlite";

export interface ChatSession {
  sessionId: string;
  messageHistory: any[];
  context: any;
  createdAt: string;
  lastActivity: string;
}

export function saveSession(
  chatId: string,
  messages: any[],
  context: any = {},
): void {
  const db = getDb();
  const stmt = db.prepare(`
        INSERT INTO chat_sessions (session_id, message_history, context, created_at, last_activity)
        VALUES ($id, $hist, $ctx, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(session_id) DO UPDATE SET
            message_history = excluded.message_history,
            context = excluded.context,
            last_activity = CURRENT_TIMESTAMP
    `);
  stmt.run({
    $id: chatId,
    $hist: JSON.stringify(messages),
    $ctx: JSON.stringify(context),
  });
}

export function loadSession(chatId: string): ChatSession {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM chat_sessions WHERE session_id = ?`);
  const row = stmt.get(chatId) as any;
  if (!row) {
    return {
      sessionId: chatId,
      messageHistory: [],
      context: {},
      createdAt: "",
      lastActivity: "",
    };
  }
  return {
    sessionId: row.session_id,
    messageHistory: JSON.parse(row.message_history || "[]"),
    context: JSON.parse(row.context || "{}"),
    createdAt: row.created_at,
    lastActivity: row.last_activity,
  };
}

export function clearSession(chatId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM chat_sessions WHERE session_id = ?`).run(chatId);
}

export function pruneOldSessions(maxAgeMs: number = 86400000): void {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAgeMs)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  db.prepare(`DELETE FROM chat_sessions WHERE last_activity < ?`).run(cutoff);
}
