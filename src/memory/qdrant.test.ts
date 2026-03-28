// src/memory/qdrant.test.ts
import { expect, test } from "bun:test";
import { getQdrantClient, resetQdrantClient } from "./qdrant";

test("initializes Qdrant client with env vars", () => {
  resetQdrantClient();
  process.env.QDRANT_URL = "https://example.qdrant.io:6333";
  process.env.QDRANT_API_KEY = "test-key";
  const client = getQdrantClient();
  expect(client).toBeDefined();
});

test("defaults to localhost when env vars not set", () => {
  resetQdrantClient();
  delete process.env.QDRANT_URL;
  delete process.env.QDRANT_API_KEY;
  const client = getQdrantClient();
  expect(client).toBeDefined();
});
