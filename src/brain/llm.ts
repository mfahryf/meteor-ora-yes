// src/brain/llm.ts
import OpenAI from "openai";

let client: OpenAI | null = null;

export function getLLMClient(baseUrl: string, apiKey: string): OpenAI {
    if (!client) {
        client = new OpenAI({ baseURL: baseUrl, apiKey });
    }
    return client;
}

export function resetLLMClient(): void {
    client = null;
}
