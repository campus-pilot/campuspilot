import { performance } from "node:perf_hooks";
import { Hono } from "hono";
import type { Logger } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { logger as rootLogger } from "../node";
import { pinoLogger } from "../hono";
import {
  annotateTiming,
  createTimingScope,
  measure,
  parseCpuMax,
  parseCpuStat,
  runInTimingScope,
  SLOW_STEP_MS,
  summarizeTiming,
  withTimingScope,
} from "../perf";

type Line = { level: string; obj: Record<string, unknown>; msg: string };

/** A logger double that records every line, so tests read what would be printed. */
function recordingLogger() {
  const lines: Line[] = [];
  const at = (level: string) => (obj: Record<string, unknown>, msg: string) => {
    lines.push({ level, obj, msg });
  };
  const log = { info: at("info"), warn: at("warn"), error: at("error"), debug: at("debug") } as unknown as Logger;
  return { log, lines };
}

/** Makes `performance.now()` advance by `stepMs` on every call, so durations are exact. */
function steppingClock(stepMs: number) {
  let now = 0;
  return vi.spyOn(performance, "now").mockImplementation(() => (now += stepMs));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("measure", () => {
  it("records sync and async steps in the current scope, adding up repeated names", async () => {
    steppingClock(10);
    const { log } = recordingLogger();
    const scope = createTimingScope(log);
    await runInTimingScope(scope, async () => {
      expect(measure("parse", () => 1)).toBe(1);
      expect(measure("parse", () => 2)).toBe(2);
      expect(await measure("read", async () => "bytes")).toBe("bytes");
      annotateTiming({ htmlBytes: 42 });
    });
    expect(summarizeTiming(scope)).toEqual({ htmlBytes: 42, steps: { parse: 20, read: 10 }, stepCalls: { parse: 2 } });
  });

  it("returns the value unchanged and records nothing outside a scope", () => {
    expect(measure("anything", () => "value")).toBe("value");
  });

  it("times a throw and a rejection, then passes them on", async () => {
    steppingClock(5);
    const { log } = recordingLogger();
    const scope = createTimingScope(log);
    await runInTimingScope(scope, async () => {
      expect(() => measure("sync", () => { throw new Error("boom"); })).toThrow("boom");
      await expect(measure("async", async () => { throw new Error("late"); })).rejects.toThrow("late");
    });
    expect(summarizeTiming(scope)).toEqual({ steps: { sync: 5, async: 5 } });
  });

  it("logs a slow step on its own, saying whether it blocked the event loop", async () => {
    steppingClock(SLOW_STEP_MS);
    const { log, lines } = recordingLogger();
    await runInTimingScope(createTimingScope(log), async () => {
      measure("render", () => undefined);
      await measure("fetch", async () => undefined);
    });
    expect(lines).toEqual([
      { level: "warn", obj: { step: "render", durationMs: SLOW_STEP_MS, blocking: true }, msg: "perf.step.slow" },
      { level: "warn", obj: { step: "fetch", durationMs: SLOW_STEP_MS, blocking: false }, msg: "perf.step.slow" },
    ]);
  });
});

describe("withTimingScope", () => {
  it("logs the event with its fields, duration and steps", async () => {
    steppingClock(1);
    const { log, lines } = recordingLogger();
    const result = await withTimingScope(log, "job.save.timing", { jobId: "j1" }, async () => measure("print", () => "ok"));
    expect(result).toBe("ok");
    expect(lines).toEqual([
      { level: "info", obj: { jobId: "j1", durationMs: 3, steps: { print: 1 } }, msg: "job.save.timing" },
    ]);
  });

  it("logs a failure at warn level and rethrows it", async () => {
    const { log, lines } = recordingLogger();
    await expect(withTimingScope(log, "job.save.timing", {}, async () => { throw new Error("nope"); })).rejects.toThrow("nope");
    expect(lines[0]).toMatchObject({ level: "warn", obj: { failed: true }, msg: "job.save.timing" });
  });
});

describe("pinoLogger", () => {
  it("puts the steps timed inside a request on its end line", async () => {
    const { log, lines } = recordingLogger();
    vi.spyOn(rootLogger, "child").mockReturnValue(log as unknown as ReturnType<typeof rootLogger.child>);
    const app = new Hono();
    app.use(pinoLogger());
    app.get("/", async (c) => {
      // Deep in a handler, with no logger passed down: the request's scope is found through async context.
      await measure("db.query", async () => undefined);
      annotateTiming({ rows: 3 });
      return c.text("ok");
    });
    await app.request("/");
    const end = lines.find((line) => line.msg === "http.request.end");
    expect(end?.obj).toMatchObject({ status: 200, path: "/", rows: 3, steps: { "db.query": expect.any(Number) } });
    expect(end?.obj.loopBusy).toEqual(expect.any(Number));
    expect(end?.obj.slow).toBeUndefined();
  });
});

describe("parseCpuStat", () => {
  it("reads cgroup v2 throttling in microseconds", () => {
    const text = "usage_usec 9000\nnr_periods 120\nnr_throttled 7\nthrottled_usec 350000\n";
    expect(parseCpuStat(text)).toEqual({ periods: 120, throttledPeriods: 7, throttledUs: 350000 });
  });

  it("reads cgroup v1 throttling in nanoseconds", () => {
    expect(parseCpuStat("nr_periods 10\nnr_throttled 2\nthrottled_time 5000000\n")).toEqual({
      periods: 10,
      throttledPeriods: 2,
      throttledUs: 5000,
    });
  });

  it("is null for a cgroup without a CPU limit", () => {
    expect(parseCpuStat("usage_usec 9000\nuser_usec 6000\nsystem_usec 3000\n")).toBeNull();
  });
});

describe("parseCpuMax", () => {
  it("turns quota and period into cores", () => {
    expect(parseCpuMax("100000 100000\n")).toBe(1);
    expect(parseCpuMax("200000 100000")).toBe(2);
  });

  it("is null without a limit", () => {
    expect(parseCpuMax("max 100000")).toBeNull();
  });
});
