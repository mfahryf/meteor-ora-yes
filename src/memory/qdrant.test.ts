// src/memory/qdrant.test.ts
import { expect, test } from "bun:test";
import { getQdrantClient } from "./qdrant";

test("initializes Qdrant client", () => {
  process.env.QDRANT_URL =
    "https://ec0bbf4c-f8eb-4f2c-906e-6941d661d9a1.eu-central-1-0.aws.cloud.qdrant.io";
  process.env.QDRANT_API_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIn0.-w04sauPbmVd9zyEItMIoUGwrCaIorjNWIW96DHrAm0";
  const client = getQdrantClient();

  expect(client).toBeDefined();
});
