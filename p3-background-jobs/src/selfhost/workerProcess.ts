import { spawn, type ChildProcess } from "node:child_process";
import { config, inngestBaseUrl } from "./config";
import { waitUntil } from "./wait";

const workerUrl = `http://localhost:${config.workerPort}`;

export function createWorkerProcess() {
  let child: ChildProcess | null = null;

  return {
    async start() {
      child = spawn(process.execPath, ["--import", "tsx", "src/selfhost/worker.ts"], {
        stdio: ["ignore", "inherit", "inherit"],
        env: {
          ...process.env,
          INNGEST_DEV: "0",
          INNGEST_BASE_URL: inngestBaseUrl(),
          INNGEST_SERVE_ORIGIN: `http://host.docker.internal:${config.workerPort}`,
        },
      });
      return waitUntil(async () => (await fetch(`${workerUrl}/ready`)).ok, config.readyTimeoutMs, config.pollIntervalMs, "worker");
    },
    async sync() {
      const res = await fetch(`${workerUrl}${config.servePath}`, { method: "PUT" });
      return { status: res.status, body: await res.text() };
    },
    async stop() {
      if (!child) return;
      const exited = new Promise((resolve) => child?.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
      child = null;
    },
  };
}
