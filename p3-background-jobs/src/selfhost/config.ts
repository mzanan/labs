import raw from "../../fixtures/selfhost.json";

export type StackName = "memory" | "redis";

export interface RequestSpec {
  key: string;
  guide: string;
  timeout: string;
  sendTimes?: number;
}

export type Action =
  | { type: "wait"; ms: number }
  | { type: "reply"; key: string; answer: "yes" | "no" }
  | { type: "stopWorker" }
  | { type: "startWorker" }
  | { type: "restartServer" }
  | { type: "killServer" };

export interface Expectation {
  status: "confirmed" | "declined" | "escalated";
  notifyCount: number;
  runCount?: number;
}

export interface Scenario {
  id: string;
  requests: RequestSpec[];
  actions: Action[];
  expect: Record<string, Expectation>;
  deadlineMs: number;
}

export interface SelfhostConfig {
  appId: string;
  inngestTag: string;
  inngestPort: number;
  workerPort: number;
  servePath: string;
  stepLogPath: string;
  pollIntervalMs: number;
  readyTimeoutMs: number;
  events: { requested: string; replied: string };
  stacks: Record<StackName, string[]>;
  scenarios: Scenario[];
}

export const config = raw as SelfhostConfig;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set in .env`);
  return value;
}

export function inngestBaseUrl(): string {
  return `http://localhost:${config.inngestPort}`;
}
