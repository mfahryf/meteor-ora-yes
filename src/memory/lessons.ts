// src/memory/lessons.ts
import { getQdrantClient, resetQdrantClient } from "./qdrant";
import { logger } from "../utils/logger";

export const COLLECTIONS = {
    poolOutcomes: "pool_outcomes",
    lessons: "lessons",
    strategyOutcomes: "strategy_outcomes",
    chatArchives: "chat_archives",
} as const;

export interface Lesson {
    id: string;
    text: string;
    role: string; // SCREENER | MANAGER | EVOLVER | CHAT
    pinned: boolean;
    tags?: string[];
    createdAt: string;
}

export async function ensureCollections(): Promise<void> {
    const client = getQdrantClient();

    for (const [name, col] of Object.entries(COLLECTIONS)) {
        let existed = true;
        try {
            await client.getCollection(col);
        } catch {
            await client.createCollection(col, {
                vectors: { size: 1536, distance: "Cosine" },
            });
            logger.info({ collection: col }, "Created Qdrant collection");
            existed = false;
        }

        // Create keyword indexes for filterable fields
        try {
            if (col === COLLECTIONS.lessons) {
                await client.createPayloadIndex(col, { field_name: "role", field_schema: "keyword" });
                await client.createPayloadIndex(col, { field_name: "pinned", field_schema: "bool" });
            }
        } catch {
            // Index may already exist, ignore
        }
    }
}

export async function addLesson(lesson: Lesson, vector: number[]): Promise<void> {
    const client = getQdrantClient();
    await client.upsert(COLLECTIONS.lessons, {
        points: [{
            id: lesson.id,
            vector,
            payload: {
                text: lesson.text,
                role: lesson.role,
                pinned: lesson.pinned,
                tags: lesson.tags || [],
                created_at: lesson.createdAt,
            },
        }],
    });
    logger.info({ lessonId: lesson.id, role: lesson.role }, "Lesson saved");
}

export async function listLessons(
    role?: string,
    pinnedOnly: boolean = false,
    limit: number = 20
): Promise<Lesson[]> {
    const client = getQdrantClient();

    const filter: any = { must: [] };
    if (role) filter.must.push({ key: "role", match: { value: role } });
    if (pinnedOnly) filter.must.push({ key: "pinned", match: { value: true } });

    const result = await client.scroll(COLLECTIONS.lessons, {
        limit,
        filter: filter.must.length > 0 ? filter : undefined,
        with_payload: true,
    });

    return (result.points as any[]).map(toLesson);
}

export async function searchLessons(vector: number[], role?: string, limit: number = 5): Promise<Lesson[]> {
    const client = getQdrantClient();

    const filter: any = role ? { must: [{ key: "role", match: { value: role } }] } : undefined;

    const result = await client.search(COLLECTIONS.lessons, {
        vector,
        filter,
        limit,
        with_payload: true,
    });

    return (result as any[]).map(toLesson);
}

export async function pinLesson(lessonId: string): Promise<void> {
    const client = getQdrantClient();
    await client.setPayload(COLLECTIONS.lessons, {
        payload: { pinned: true },
        points: [lessonId],
    });
}

export async function unpinLesson(lessonId: string): Promise<void> {
    const client = getQdrantClient();
    await client.setPayload(COLLECTIONS.lessons, {
        payload: { pinned: false },
        points: [lessonId],
    });
}

function toLesson(point: any): Lesson {
    return {
        id: point.id as string,
        text: point.payload?.text || "",
        role: point.payload?.role || "",
        pinned: point.payload?.pinned || false,
        tags: point.payload?.tags || [],
        createdAt: point.payload?.created_at || "",
    };
}
