import { afterEach, describe, expect, it, vi } from "vitest";
import { startUploadRetentionWorker, uploadRetentionPolicy } from "./uploadRetention";
describe("upload retention worker", () => {
  afterEach(() => { vi.useRealTimers(); delete process.env.SHROOM_DATA_RETENTION_ENABLED; });
  it("keeps destructive scheduling disabled unless explicitly enabled", async () => {
    vi.useFakeTimers();
    const run = vi.fn(); const stop = startUploadRetentionWorker(run);
    await vi.advanceTimersByTimeAsync(7200000);
    expect(run).not.toHaveBeenCalled(); stop();
    expect(uploadRetentionPolicy()).toMatchObject({ chatDays: 180, usageDays: 90, enabled: false });
  });
  it("runs at most one bounded batch per hour and does not overlap a slow cleanup", async () => {
    vi.useFakeTimers(); process.env.SHROOM_DATA_RETENTION_ENABLED = "1";
    let finish!: () => void;
    const run = vi.fn(() => new Promise<any>(resolve => { finish = () => resolve({}); }));
    const stop = startUploadRetentionWorker(run);
    await vi.advanceTimersByTimeAsync(10800000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ dryRun: false, limit: 500 });
    finish(); await Promise.resolve(); stop();
    await vi.advanceTimersByTimeAsync(3600000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
