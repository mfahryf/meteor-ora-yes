// src/tui/log-capture.ts
import { EventEmitter } from "events";

export interface LogEntry {
    time: number;
    text: string;
}

const MAX_ENTRIES = 2000;

export class LogRingBuffer {
    private entries: LogEntry[] = [];
    private emitter = new EventEmitter();

    writeRaw(text: string): void {
        const entry: LogEntry = {
            time: Date.now(),
            text: text.replace(/\n$/, ""),
        };
        this.entries.push(entry);
        if (this.entries.length > MAX_ENTRIES) {
            this.entries = this.entries.slice(-MAX_ENTRIES);
        }
        this.emitter.emit("log", entry);
    }

    onLog(listener: (entry: LogEntry) => void): () => void {
        this.emitter.on("log", listener);
        return () => { this.emitter.off("log", listener); };
    }

    getEntries(): LogEntry[] {
        return [...this.entries];
    }

    clear(): void {
        this.entries = [];
    }
}
