import { AsyncLocalStorage } from "node:async_hooks";

import type { XplCall } from "./xplParse";

type Deferred = () => unknown;

export interface TurnTrace {
  calls: XplCall[];
  toolResults: Map<string, string>;
  deferred: Deferred[];
  parsing: Promise<void>[];
}

const storage = new AsyncLocalStorage<TurnTrace>();

export function newTrace(): TurnTrace {
  return { calls: [], toolResults: new Map(), deferred: [], parsing: [] };
}

export function runInTrace<T>(trace: TurnTrace, fn: () => Promise<T>): Promise<T> {
  return storage.run(trace, fn);
}

export function currentTrace(): TurnTrace | undefined {
  return storage.getStore();
}

export function deferToTrace(task: Deferred | Promise<unknown>): void {
  const run: Deferred = typeof task === "function" ? task : () => task;
  const trace = currentTrace();
  if (trace) {
    trace.deferred.push(run);
    return;
  }
  void Promise.resolve().then(run).catch(() => undefined);
}

export async function settleTrace(trace: TurnTrace): Promise<void> {
  while (trace.deferred.length) {
    const task = trace.deferred.shift();
    try {
      await task?.();
    } catch (error) {
      console.error("eval: deferred task failed", error instanceof Error ? error.message : error);
    }
  }
  await Promise.allSettled(trace.parsing);
}
