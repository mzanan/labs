import { vi } from "vitest";

import { installXplFetch } from "./capture/xplFetch";

delete process.env.JEV_API_KEY;

vi.mock("next/server", async (importOriginal) => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  const { deferToTrace } = await import("./capture/turnTrace");
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    after: (task: (() => unknown) | Promise<unknown>) => {
      const restore = AsyncLocalStorage.snapshot();
      deferToTrace(() => restore(() => (typeof task === "function" ? task() : task)));
    },
  };
});

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

installXplFetch();
