// src/core/scheduler.ts
import { logger } from "../utils/logger";

export interface ScheduledJob {
    id: string;
    timer: ReturnType<typeof setInterval>;
    intervalMs: number;
    jobFn: () => Promise<void>;
    running: boolean;
}

const jobs = new Map<string, ScheduledJob>();
let globalPaused = false;

export function scheduleJob(id: string, intervalMs: number, jobFn: () => Promise<void>): ScheduledJob {
    // Clear existing job with same id
    stopJob(id);

    const timer = setInterval(async () => {
        const job = jobs.get(id);
        if (!job || !job.running || globalPaused) return;

        try {
            await jobFn();
        } catch (error: any) {
            logger.error({ jobId: id, error: error.message }, "Scheduled job failed");
        }
    }, intervalMs);

    const job: ScheduledJob = { id, timer, intervalMs, jobFn, running: true };
    jobs.set(id, job);
    logger.info({ jobId: id, intervalMs }, "Job scheduled");
    return job;
}

export function stopJob(id: string): void {
    const job = jobs.get(id);
    if (job) {
        clearInterval(job.timer);
        job.running = false;
        jobs.delete(id);
        logger.info({ jobId: id }, "Job stopped");
    }
}

export function stopAllJobs(): void {
    for (const id of jobs.keys()) {
        stopJob(id);
    }
    logger.info("All jobs stopped");
}

export function pauseAllJobs(): void {
    globalPaused = true;
    logger.info("All jobs paused");
}

export function resumeAllJobs(): void {
    globalPaused = false;
    logger.info("All jobs resumed");
}

export function isPaused(): boolean {
    return globalPaused;
}

export function listJobs(): Array<{ id: string; intervalMs: number; running: boolean }> {
    return Array.from(jobs.values()).map(j => ({
        id: j.id,
        intervalMs: j.intervalMs,
        running: j.running,
    }));
}
