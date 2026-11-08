import { execFileSync } from "node:child_process";
import { config, inngestBaseUrl, type StackName } from "./config";
import { waitUntil } from "./wait";

function compose(stack: StackName, args: string[]): void {
  const files = config.stacks[stack].flatMap((file) => ["-f", file]);
  execFileSync("docker", ["compose", "-p", `p3-selfhost-${stack}`, ...files, ...args], {
    stdio: "inherit",
    env: {
      ...process.env,
      SELFHOST_INNGEST_TAG: config.inngestTag,
      SELFHOST_INNGEST_PORT: String(config.inngestPort),
      SELFHOST_WORKER_PORT: String(config.workerPort),
    },
  });
}

export async function waitServerHealthy(): Promise<number> {
  return waitUntil(
    async () => (await fetch(`${inngestBaseUrl()}/health`)).ok,
    config.readyTimeoutMs,
    config.pollIntervalMs,
    "inngest server",
  );
}

export function createStack(stack: StackName) {
  return {
    async up() {
      compose(stack, ["down", "-v", "--remove-orphans"]);
      compose(stack, ["up", "-d", "--wait-timeout", "90"]);
      return waitServerHealthy();
    },
    async restartServer() {
      compose(stack, ["restart", "inngest"]);
      return waitServerHealthy();
    },
    async killServer() {
      compose(stack, ["kill", "-s", "SIGKILL", "inngest"]);
      compose(stack, ["start", "inngest"]);
      return waitServerHealthy();
    },
    down() {
      compose(stack, ["down", "-v", "--remove-orphans"]);
    },
  };
}
