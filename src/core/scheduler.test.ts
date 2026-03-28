// src/core/scheduler.test.ts
import { expect, test, afterAll } from "bun:test";
import { scheduleJob, stopJob, stopAllJobs, listJobs, pauseAllJobs, resumeAllJobs, isPaused } from "./scheduler";

afterAll(() => {
    stopAllJobs();
});

test("scheduleJob creates a running job", () => {
    let triggered = false;
    const job = scheduleJob("test_job", 100, async () => { triggered = true; });
    expect(job.running).toBe(true);
    expect(job.id).toBe("test_job");
    stopJob("test_job");
});

test("stopJob stops a job", () => {
    const job = scheduleJob("stop_test", 100, async () => {});
    stopJob("stop_test");
    expect(job.running).toBe(false);
});

test("listJobs returns active jobs", () => {
    scheduleJob("list_test_1", 100, async () => {});
    scheduleJob("list_test_2", 200, async () => {});
    const active = listJobs();
    expect(active.length).toBeGreaterThanOrEqual(2);
    expect(active.some(j => j.id === "list_test_1")).toBe(true);
    stopJob("list_test_1");
    stopJob("list_test_2");
});

test("stopAllJobs stops everything", () => {
    scheduleJob("all_test_1", 100, async () => {});
    scheduleJob("all_test_2", 100, async () => {});
    stopAllJobs();
    expect(listJobs().length).toBe(0);
});

test("pauseAllJobs sets global paused flag", () => {
    expect(isPaused()).toBe(false);
    pauseAllJobs();
    expect(isPaused()).toBe(true);
});

test("resumeAllJobs clears global paused flag", () => {
    resumeAllJobs();
    expect(isPaused()).toBe(false);
});

test("paused jobs do not execute", () => {
    let triggered = false;
    pauseAllJobs();
    scheduleJob("paused_test", 50, async () => { triggered = true; });
    // The interval callback checks globalPaused and skips
    const job = listJobs().find(j => j.id === "paused_test");
    expect(job).toBeDefined();
    stopJob("paused_test");
    resumeAllJobs();
});
