// src/brain/embeddings.ts
// Embedding generation for lesson vectors — real API or hash-based fallback
// Used by Qdrant for semantic search of relevant lessons

import { logger } from "../utils/logger";

/**
 * Generate an embedding vector for the given text.
 * Tries the LLM API's embedding endpoint first (OpenAI-compatible).
 * Falls back to deterministic hash-based pseudo-vector if unavailable.
 */
export async function getEmbedding(
    text: string,
    baseUrl?: string,
    apiKey?: string,
    model?: string,
): Promise<number[]> {
    // Try real embedding API if credentials are available
    if (baseUrl && apiKey) {
        try {
            const response = await fetch(`${baseUrl}/embeddings`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: model || "text-embedding-3-small",
                    input: text,
                }),
            });

            if (response.ok) {
                const json = await response.json() as any;
                const embedding = json?.data?.[0]?.embedding;
                if (Array.isArray(embedding) && embedding.length > 0) {
                    logger.debug({ dim: embedding.length }, "Real embedding generated");
                    return embedding;
                }
            }
        } catch (error) {
            logger.debug({ error: String(error) }, "Embedding API unavailable, using hash fallback");
        }
    }

    // Fallback: deterministic hash-based pseudo-vector
    return hashToVector(text, 1536);
}

/**
 * Generate a deterministic pseudo-vector from text using a hash function.
 * Not semantically meaningful, but provides differentiated vectors
 * so Qdrant can at least distinguish between different lessons.
 * 
 * Much better than `new Array(1536).fill(0)` (the old behavior where
 * all lessons had identical vectors = semantic search was useless).
 */
function hashToVector(text: string, dimensions: number): number[] {
    const vector = new Float64Array(dimensions);

    // Use multiple hash seeds for better distribution
    for (let d = 0; d < dimensions; d++) {
        let hash = d * 2654435761; // Knuth's multiplicative hash seed
        for (let i = 0; i < text.length; i++) {
            hash = Math.imul(hash ^ text.charCodeAt(i), 1597334677);
            hash ^= hash >>> 16;
        }
        // Normalize to [-1, 1] range
        vector[d] = (hash & 0x7fffffff) / 0x7fffffff * 2 - 1;
    }

    // L2-normalize the vector (required for cosine similarity in Qdrant)
    let norm = 0;
    for (let i = 0; i < dimensions; i++) {
        norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < dimensions; i++) {
            vector[i] /= norm;
        }
    }

    return Array.from(vector);
}
