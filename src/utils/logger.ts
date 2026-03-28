// src/utils/logger.ts
import pino from 'pino';
import type { LogRingBuffer } from '../tui/log-capture';

let ringBuffer: LogRingBuffer | undefined;
let suppressStdout = false;

export function setRingBuffer(rb: LogRingBuffer): void {
    ringBuffer = rb;
}

export function suppressStdoutForTui(): void {
    suppressStdout = true;
}

const logStream = {
    write(chunk: string) {
        let text = chunk;
        try {
            const obj = JSON.parse(chunk);
            const time = new Date(obj.time || Date.now()).toLocaleTimeString('en-US', { hour12: false });
            const levelStr = obj.level === 50 ? 'ERROR' : obj.level === 40 ? 'WARN' : 'INFO';
            text = `${time} ${levelStr} ${obj.msg || ''}\n`;
        } catch {
            // Keep raw chunk if not JSON
        }
        if (ringBuffer) {
            ringBuffer.writeRaw(text);
        }
        if (!suppressStdout) {
            process.stdout.write(text);
        }
    }
};

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
}, logStream as any);