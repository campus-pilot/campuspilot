import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { Logger } from 'pino';

import { logger as rootLogger } from './node';

/**
 * Performance logging (node only). See docs/performance-logs.md for the
 * events and how to read them.
 *
 * Three layers, each answering a different question:
 * - **Steps** ({@link measure}): where the time of one request or job went.
 *   Steps are collected in the current {@link TimingScope} (one per HTTP
 *   request, opened by the Hono `pinoLogger` middleware, or one per job step
 *   through {@link withTimingScope}) and printed with the scope's end line. A
 *   single step slower than {@link SLOW_STEP_MS} also logs `perf.step.slow`
 *   on its own, so it is visible even outside a scope.
 * - **Requests**: `http.request.end` carries the steps, `loopBusy` and a
 *   `slow` flag (see `hono.ts`).
 * - **Runtime** ({@link startRuntimeMonitor}): event loop delay, CPU use,
 *   memory and the container's CPU throttling every
 *   {@link RUNTIME_STATS_INTERVAL_MS}, plus `runtime.eventloop.blocked` with
 *   the requests in flight whenever the loop stalls.
 *
 * Only names, ids, sizes and durations are logged here, never content.
 */

/** A single step at least this slow (wall time) logs `perf.step.slow` immediately. */
export const SLOW_STEP_MS = 250;
/** A request or scope at least this slow ends with `slow: true` at warn level. */
export const SLOW_REQUEST_MS = 1_000;
/** A probe timer firing at least this late logs `runtime.eventloop.blocked`. */
export const BLOCKED_LOOP_MS = 300;
/** How often the blocked-loop probe is scheduled. Cheap: one timer callback. */
const BLOCK_PROBE_INTERVAL_MS = 100;
/** How often `runtime.stats` is logged. */
export const RUNTIME_STATS_INTERVAL_MS = 30_000;
/** At most this many in-flight requests are listed on a blocked-loop line (the longest running first). */
const MAX_IN_FLIGHT_LISTED = 10;

type StepTotal = { ms: number; calls: number };

/** The timings of one unit of work (an HTTP request, a job step), collected while it runs. */
export type TimingScope = {
  log: Logger;
  steps: Map<string, StepTotal>;
  fields: Record<string, unknown>;
};

const scopes = new AsyncLocalStorage<TimingScope>();

export function createTimingScope(log: Logger): TimingScope {
  return { log, steps: new Map(), fields: {} };
}

/** Runs `fn` with `scope` as the current scope; every {@link measure} inside it, however deep, records into it. */
export function runInTimingScope<T>(scope: TimingScope, fn: () => T): T {
  return scopes.run(scope, fn);
}

const roundMs = (ms: number) => Math.round(ms * 10) / 10;

function record(name: string, started: number, blocking: boolean) {
  const ms = performance.now() - started;
  const scope = scopes.getStore();
  if (scope) {
    const total = scope.steps.get(name) ?? { ms: 0, calls: 0 };
    total.ms += ms;
    total.calls += 1;
    scope.steps.set(name, total);
  }
  if (ms >= SLOW_STEP_MS) {
    (scope?.log ?? rootLogger).warn({ step: name, durationMs: Math.round(ms), blocking }, 'perf.step.slow');
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === 'function';
}

/**
 * Times `fn` as the step `name` and returns its result unchanged (a thrown
 * error or rejection is timed too, then passed on).
 *
 * A synchronous `fn` is recorded with `blocking: true`: for that long the
 * event loop could serve nothing else, so it is CPU work. A `fn` that returns
 * a promise is timed until it settles (`blocking: false`): wall time, which
 * includes waiting for I/O and for other work queued on the same loop.
 *
 * Steps with the same name add up (`stepCalls` says how many). Nested steps
 * are recorded separately, so a parent's time includes its children's.
 */
export function measure<T>(name: string, fn: () => T): T {
  const started = performance.now();
  let result: T;
  try {
    result = fn();
  } catch (error) {
    record(name, started, true);
    throw error;
  }
  if (isPromiseLike(result)) {
    return Promise.resolve(result).finally(() => record(name, started, false)) as T;
  }
  record(name, started, true);
  return result;
}

/** Adds facts (sizes, counts, ids; never content) to the current scope's end line. No-op outside a scope. */
export function annotateTiming(fields: Record<string, unknown>): void {
  const scope = scopes.getStore();
  if (scope) Object.assign(scope.fields, fields);
}

/** The scope's steps (`steps`: name to total ms, `stepCalls` for names timed more than once) and annotations. */
export function summarizeTiming(scope: TimingScope): Record<string, unknown> {
  if (scope.steps.size === 0) return { ...scope.fields };
  const steps: Record<string, number> = {};
  const stepCalls: Record<string, number> = {};
  for (const [name, total] of scope.steps) {
    steps[name] = roundMs(total.ms);
    if (total.calls > 1) stepCalls[name] = total.calls;
  }
  return { ...scope.fields, steps, ...(Object.keys(stepCalls).length > 0 ? { stepCalls } : {}) };
}

/**
 * Runs `fn` in a fresh scope and logs `event` when it ends, with `fields`,
 * `durationMs`, the steps and `slow`. For work outside an HTTP request (a
 * worker job step), where no middleware opens a scope. A failure is logged
 * with `failed: true` and rethrown.
 */
export async function withTimingScope<T>(
  log: Logger,
  event: string,
  fields: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const scope = createTimingScope(log);
  const started = performance.now();
  let failed = false;
  try {
    return await runInTimingScope(scope, fn);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const durationMs = Math.round(performance.now() - started);
    const slow = durationMs >= SLOW_REQUEST_MS;
    const line = { ...fields, durationMs, ...summarizeTiming(scope), ...(slow ? { slow } : {}), ...(failed ? { failed } : {}) };
    if (slow || failed) log.warn(line, event);
    else log.info(line, event);
  }
}

type InFlight = { reqId: string; method: string; path: string; started: number };

const inFlight = new Set<InFlight>();

/**
 * Registers a request as running until the returned function is called, so a
 * blocked-loop line can name what was running. The culprit of a stall is
 * usually among them: a synchronous step finishes before the probe can fire,
 * but its request is still open.
 */
export function trackInFlight(request: { reqId: string; method: string; path: string }): () => void {
  const entry = { ...request, started: performance.now() };
  inFlight.add(entry);
  return () => {
    inFlight.delete(entry);
  };
}

function inFlightSnapshot() {
  const now = performance.now();
  return [...inFlight]
    .map((entry) => ({ reqId: entry.reqId, method: entry.method, path: entry.path, elapsedMs: Math.round(now - entry.started) }))
    .sort((a, b) => b.elapsedMs - a.elapsedMs)
    .slice(0, MAX_IN_FLIGHT_LISTED);
}

/** Cumulative CPU throttling counters of this container's cgroup. */
export type CpuThrottling = { periods: number; throttledPeriods: number; throttledUs: number };

/**
 * Parses a cgroup `cpu.stat`: v2 (`throttled_usec`) or v1 (`throttled_time`,
 * nanoseconds). Null when the cgroup has no CPU limit (no `nr_periods`), so
 * nothing can be throttled.
 */
export function parseCpuStat(text: string): CpuThrottling | null {
  const values = new Map<string, number>();
  for (const line of text.split('\n')) {
    const [key, value] = line.trim().split(/\s+/);
    if (key && value !== undefined && /^\d+$/.test(value)) values.set(key, Number(value));
  }
  const periods = values.get('nr_periods');
  const throttledPeriods = values.get('nr_throttled');
  if (periods === undefined || throttledPeriods === undefined) return null;
  const usec = values.get('throttled_usec');
  const nsec = values.get('throttled_time');
  const throttledUs = usec ?? (nsec === undefined ? undefined : nsec / 1000);
  if (throttledUs === undefined) return null;
  return { periods, throttledPeriods, throttledUs };
}

/**
 * The CPU limit in cores from a cgroup v2 `cpu.max` (`"100000 100000"` is one
 * core); null for `max` (no limit) or anything unreadable.
 */
export function parseCpuMax(text: string): number | null {
  const [quota, period] = text.trim().split(/\s+/);
  if (!quota || !period || quota === 'max') return null;
  const cores = Number(quota) / Number(period);
  return Number.isFinite(cores) && cores > 0 ? cores : null;
}

const CPU_STAT_PATHS = ['/sys/fs/cgroup/cpu.stat', '/sys/fs/cgroup/cpu,cpuacct/cpu.stat', '/sys/fs/cgroup/cpu/cpu.stat'];

function readOptional(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function readCpuThrottling(): CpuThrottling | null {
  for (const path of CPU_STAT_PATHS) {
    const text = readOptional(path);
    if (text !== null) return parseCpuStat(text);
  }
  return null;
}

const toMs = (ns: number) => roundMs(ns / 1e6);
const toMb = (bytes: number) => Math.round(bytes / 1024 / 1024);

/**
 * Starts the runtime monitor of this process and returns its stop function.
 * Both timers are `unref`ed, so they never keep the process alive.
 *
 * - `runtime.stats` every {@link RUNTIME_STATS_INTERVAL_MS}: event loop delay
 *   percentiles, `loopBusy` (event loop utilisation, 0 to 1), CPU time used in
 *   cores (1 is one full core), memory, requests in flight and, inside a
 *   container with a CPU limit, the throttling in that interval. Warn level
 *   when the loop's p99 delay reaches {@link BLOCKED_LOOP_MS} or the
 *   container was throttled for at least 100 ms.
 * - `runtime.eventloop.blocked` whenever a 100 ms probe timer fires at least
 *   {@link BLOCKED_LOOP_MS} late, with the requests in flight. A stall is
 *   either synchronous CPU work in this process or the container being
 *   paused by its CPU limit; `throttledMs` on the next stats line tells the
 *   two apart.
 */
export function startRuntimeMonitor(log: Logger, options: { statsIntervalMs?: number } = {}): () => void {
  const intervalMs = options.statsIntervalMs ?? RUNTIME_STATS_INTERVAL_MS;
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  const cpuLimitCores = parseCpuMax(readOptional('/sys/fs/cgroup/cpu.max') ?? 'max');
  let lastElu = performance.eventLoopUtilization();
  let lastCpu = process.cpuUsage();
  let lastAt = performance.now();
  let lastThrottling = readCpuThrottling();

  const stats = setInterval(() => {
    const now = performance.now();
    const elapsedMs = now - lastAt;
    const elu = performance.eventLoopUtilization(lastElu);
    const cpu = process.cpuUsage(lastCpu);
    const throttling = readCpuThrottling();
    const memory = process.memoryUsage();
    const throttle =
      throttling && lastThrottling
        ? {
            throttledPeriods: throttling.throttledPeriods - lastThrottling.throttledPeriods,
            periods: throttling.periods - lastThrottling.periods,
            throttledMs: roundMs((throttling.throttledUs - lastThrottling.throttledUs) / 1000),
          }
        : null;
    const loopDelayMs = { p50: toMs(delay.percentile(50)), p99: toMs(delay.percentile(99)), max: toMs(delay.max) };
    const line = {
      intervalMs: Math.round(elapsedMs),
      loopDelayMs,
      loopBusy: Math.round(elu.utilization * 100) / 100,
      cpuCores: Math.round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 100) / 100,
      ...(cpuLimitCores !== null ? { cpuLimitCores } : {}),
      ...(throttle ? throttle : {}),
      rssMb: toMb(memory.rss),
      heapUsedMb: toMb(memory.heapUsed),
      inFlight: inFlight.size,
    };
    if (loopDelayMs.p99 >= BLOCKED_LOOP_MS || (throttle?.throttledMs ?? 0) >= 100) log.warn(line, 'runtime.stats');
    else log.info(line, 'runtime.stats');
    delay.reset();
    lastElu = performance.eventLoopUtilization();
    lastCpu = process.cpuUsage();
    lastAt = now;
    lastThrottling = throttling;
  }, intervalMs);
  stats.unref();

  let due = performance.now() + BLOCK_PROBE_INTERVAL_MS;
  const probe = setInterval(() => {
    const now = performance.now();
    const lateMs = now - due;
    due = now + BLOCK_PROBE_INTERVAL_MS;
    if (lateMs >= BLOCKED_LOOP_MS) {
      log.warn({ blockedMs: Math.round(lateMs), inFlight: inFlightSnapshot() }, 'runtime.eventloop.blocked');
    }
  }, BLOCK_PROBE_INTERVAL_MS);
  probe.unref();

  return () => {
    clearInterval(stats);
    clearInterval(probe);
    delay.disable();
  };
}
