// src/memory/lessons.test.ts
import { expect, test } from "bun:test";
import { COLLECTIONS, type Lesson } from "./lessons";

test("COLLECTIONS has all required collection names", () => {
    expect(COLLECTIONS.poolOutcomes).toBe("pool_outcomes");
    expect(COLLECTIONS.lessons).toBe("lessons");
    expect(COLLECTIONS.strategyOutcomes).toBe("strategy_outcomes");
    expect(COLLECTIONS.chatArchives).toBe("chat_archives");
});

test("Lesson interface shape is correct", () => {
    const lesson: Lesson = {
        id: "test-id",
        text: "Always check TVL before deploying",
        role: "SCREENER",
        pinned: false,
        tags: ["tvl", "safety"],
        createdAt: new Date().toISOString(),
    };
    expect(lesson.id).toBe("test-id");
    expect(lesson.role).toBe("SCREENER");
    expect(lesson.pinned).toBe(false);
});
