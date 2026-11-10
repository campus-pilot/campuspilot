import * as restate from '@restatedev/restate-sdk';

import type { RunContext } from '../runtime/conversation';

/**
 * A fake of the part of Restate a turn uses (`RunContext`: durable steps and
 * awakeables), so tests can drive `processRun` without a Restate server and
 * still exercise what makes it durable: retries, terminal errors, and replay
 * from a journal after a crash.
 *
 * What it reproduces from Restate:
 * - `run(name, fn, options)` executes `fn` and records its result. The
 *   result passes through JSON, as it does through Restate's journal, so a
 *   step cannot return something that would not survive a replay.
 * - A thrown `restate.TerminalError` is recorded and rethrown without a
 *   retry, as a new error carrying only the message (Restate keeps nothing
 *   else of it).
 * - Any other thrown error is retried up to `maxRetryAttempts` attempts, the
 *   first one included. When they are used up the step fails with a
 *   `restate.TerminalError` carrying the last error's message.
 * - Replay: a context created with a `journal` answers each call from it, in
 *   order, without running the step's function; calls past the end of the
 *   journal execute normally and extend it. A call that does not line up
 *   with the journal (another name or kind) fails, as Restate's journal
 *   mismatch does.
 * - `awakeable()` is journaled too: on replay it keeps its id, and resolves
 *   at once when its resolution was recorded.
 *
 * What it leaves out: retry delays (retries run immediately), `maxRetryDuration`,
 * and every other context method.
 */

export type JournalEntry =
  | {
      kind: 'run';
      name: string;
      outcome: { status: 'ok'; value: unknown } | { status: 'terminal'; message: string };
    }
  /** `resolution` is null while nothing has resolved the awakeable. */
  | { kind: 'awakeable'; id: string; resolution: { value: unknown } | null };

/**
 * The invocation died: thrown by a step set up with `crashAfter`, and by
 * every later use of the same context. Not a `TerminalError`, so the handler
 * lets it through, as it must for Restate to retry the invocation.
 */
export class SimulatedCrash extends Error {
  constructor(stepName: string) {
    super(`Simulated crash after step "${stepName}" ran and before its result was recorded.`);
    this.name = 'SimulatedCrash';
  }
}

/** Attempts of a step that sets no `maxRetryAttempts`; Restate retries without limit. */
const UNLIMITED_RETRY_SAFETY_CAP = 25;

export type FakeRunContext = RunContext & {
  /** The journal so far: replayed entries, then those this invocation added. */
  readonly journal: readonly JournalEntry[];
  /** Names of steps answered from the journal, in order. */
  readonly replayed: readonly string[];
  /** Names of steps whose function ran in this invocation, once per attempt, in order. */
  readonly executed: readonly string[];
  /** How often the named step's function ran in this invocation. */
  attempts: (name: string) => number;
  /** Ids of awakeables nothing has resolved yet. */
  pendingAwakeables: () => string[];
  /** Resolves an awakeable, as Restate's ingress does for the service. */
  resolveAwakeable: (id: string, value: unknown) => void;
  /**
   * Makes the invocation die right after the named step's function returns
   * and before its result is journaled: the window in which Restate runs a
   * step a second time on replay.
   */
  crashAfter: (name: string) => void;
};

/** A plain promise with the two extra methods `RestatePromise` declares. */
function asRestatePromise<T>(promise: Promise<T>): restate.RestatePromise<T> {
  return Object.assign(promise, {
    orTimeout: (): restate.RestatePromise<T> => {
      throw new Error('orTimeout is not supported by the fake run context.');
    },
    map: <U>(mapper: (value?: T, failure?: restate.TerminalError) => U): restate.RestatePromise<U> =>
      asRestatePromise(
        promise.then(
          (value) => mapper(value, undefined),
          (failure: unknown) => {
            if (failure instanceof restate.TerminalError) return mapper(undefined, failure);
            throw failure;
          },
        ),
      ),
  });
}

/** A value as it comes back from Restate's journal. */
function throughJournal<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createFakeRunContext({
  journal: recorded = [],
}: {
  /** A journal to replay, usually an earlier context's `journal`. Copied. */
  journal?: readonly JournalEntry[];
} = {}): FakeRunContext {
  const journal: JournalEntry[] = structuredClone(recorded) as JournalEntry[];
  const replayLength = journal.length;
  /** Position of the next context call in the journal. */
  let cursor = 0;
  let crashed: SimulatedCrash | null = null;
  const crashAfterSteps = new Set<string>();
  const replayed: string[] = [];
  const executed: string[] = [];
  const waiting = new Map<string, (value: unknown) => void>();
  let awakeableCount = 0;

  /** The recorded entry for this call when replaying, or null to execute it. */
  function nextRecorded(kind: JournalEntry['kind'], name: string | null): JournalEntry | null {
    if (crashed) throw crashed;
    const index = cursor++;
    if (index >= replayLength) return null;
    const entry = journal[index]!;
    if (entry.kind !== kind || (entry.kind === 'run' && entry.name !== name)) {
      const found = entry.kind === 'run' ? `run "${entry.name}"` : 'an awakeable';
      const asked = kind === 'run' ? `run "${name}"` : 'an awakeable';
      throw new Error(`Journal mismatch at entry ${index}: the journal holds ${found}, the handler asked for ${asked}.`);
    }
    return entry;
  }

  async function runStep<T>(name: string, action: restate.RunAction<T>, options?: restate.RunOptions<T>): Promise<T> {
    const entry = nextRecorded('run', name);
    if (entry?.kind === 'run') {
      replayed.push(name);
      if (entry.outcome.status === 'terminal') throw new restate.TerminalError(entry.outcome.message);
      return entry.outcome.value as T;
    }

    const maxAttempts = options?.maxRetryAttempts ?? UNLIMITED_RETRY_SAFETY_CAP;
    for (let attempt = 1; ; attempt++) {
      executed.push(name);
      let value: T;
      try {
        value = await action();
      } catch (error) {
        if (error instanceof restate.TerminalError) {
          journal.push({ kind: 'run', name, outcome: { status: 'terminal', message: error.message } });
          throw new restate.TerminalError(error.message);
        }
        if (attempt < maxAttempts) continue;
        if (options?.maxRetryAttempts === undefined) {
          throw new Error(
            `Step "${name}" still failed after ${UNLIMITED_RETRY_SAFETY_CAP} attempts; Restate would retry it forever. Last error: ${errorMessage(error)}`,
          );
        }
        journal.push({ kind: 'run', name, outcome: { status: 'terminal', message: errorMessage(error) } });
        throw new restate.TerminalError(errorMessage(error));
      }
      if (crashAfterSteps.has(name)) {
        crashed = new SimulatedCrash(name);
        throw crashed;
      }
      const stored = throughJournal(value);
      journal.push({ kind: 'run', name, outcome: { status: 'ok', value: stored } });
      return stored;
    }
  }

  function run<T>(...args: [restate.RunAction<T>] | [string, restate.RunAction<T>, restate.RunOptions<T>?]) {
    const [name, action, options] = typeof args[0] === 'string' ? args : (['', args[0]] as const);
    return asRestatePromise(runStep(name as string, action as restate.RunAction<T>, options));
  }

  function awakeable<T>() {
    const entry = nextRecorded('awakeable', null);
    const live: Extract<JournalEntry, { kind: 'awakeable' }> =
      entry?.kind === 'awakeable'
        ? entry
        : { kind: 'awakeable', id: `fake-awakeable-${replayLength}-${++awakeableCount}`, resolution: null };
    if (!entry) journal.push(live);

    const promise = live.resolution
      ? Promise.resolve(live.resolution.value as T)
      : new Promise<T>((resolve) => {
          waiting.set(live.id, (value) => {
            live.resolution = { value: throughJournal(value) };
            resolve(live.resolution.value as T);
          });
        });
    return { id: live.id, promise: asRestatePromise(promise) };
  }

  return {
    run: run as RunContext['run'],
    awakeable: awakeable as RunContext['awakeable'],
    journal,
    replayed,
    executed,
    attempts: (name) => executed.filter((step) => step === name).length,
    pendingAwakeables: () => [...waiting.keys()],
    resolveAwakeable(id, value) {
      const resolve = waiting.get(id);
      if (!resolve) throw new Error(`No awakeable ${id} is waiting in this run context.`);
      waiting.delete(id);
      resolve(value);
    },
    crashAfter: (name) => void crashAfterSteps.add(name),
  };
}
