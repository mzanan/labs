export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntil(check: () => Promise<boolean>, timeoutMs: number, intervalMs: number, label: string): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check().catch(() => false)) return Date.now() - started;
    await sleep(intervalMs);
  }
  throw new Error(`${label} not ready after ${timeoutMs}ms`);
}
