// src/memory/runs.ts
import { getDb } from "./sqlite";

export interface AgentRunRecord {
    id?: number;
    agent_type: string;
    goal: string;
    tools_called: string; // JSON array
    final_answer: string;
    success: boolean;
    duration_ms: number;
    timestamp?: string;
}

export function insertAgentRun(run: AgentRunRecord): void {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO agent_runs (agent_type, goal, tools_called, final_answer, success, duration_ms)
        VALUES ($type, $goal, $tools, $answer, $success, $duration)
    `);
    stmt.run({
        $type: run.agent_type,
        $goal: run.goal,
        $tools: run.tools_called,
        $answer: run.final_answer,
        $success: run.success ? 1 : 0,
        $duration: run.duration_ms,
    });
}

export function getRecentRuns(limit: number = 20): AgentRunRecord[] {
    const db = getDb();
    return db.prepare(`SELECT * FROM agent_runs ORDER BY timestamp DESC LIMIT $limit`)
        .all({ $limit: limit }) as AgentRunRecord[];
}

export function getRunsByType(agentType: string, limit: number = 20): AgentRunRecord[] {
    const db = getDb();
    return db.prepare(`SELECT * FROM agent_runs WHERE agent_type = $type ORDER BY timestamp DESC LIMIT $limit`)
        .all({ $type: agentType, $limit: limit }) as AgentRunRecord[];
}
