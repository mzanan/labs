import { effect, frame, init, target, timer } from "vgpu/node";

export interface Resolution {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

export interface RenderConfig {
  readonly resolutions: readonly Resolution[];
  readonly warmupFrames: number;
  readonly measuredFrames: number;
}

export interface ShaderScenario {
  readonly id: string;
  readonly note: string;
  readonly source: readonly string[];
}

export interface Stat {
  readonly medianMs: number;
  readonly p95Ms: number;
}

export interface ShaderRenderMeasurement {
  readonly shaderId: string;
  readonly resolutionId: string;
  readonly cpu: Stat;
  readonly gpu?: Stat;
  readonly gpuSamples: number;
}

export interface RenderMeasurement {
  readonly ran: boolean;
  readonly adapter?: string;
  readonly adapterType?: string;
  readonly timestampQuery?: boolean;
  readonly measurements?: readonly ShaderRenderMeasurement[];
  readonly reason?: string;
}

function stat(samples: readonly number[]): Stat {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { medianMs: at(0.5), p95Ms: at(0.95) };
}

export async function measureRender(
  shaders: readonly ShaderScenario[],
  config: RenderConfig,
): Promise<RenderMeasurement> {
  let gpu: Awaited<ReturnType<typeof init>>;
  let timestampQuery = true;

  try {
    gpu = await init({ requiredFeatures: ["timestamp-query"] });
  } catch {
    try {
      gpu = await init();
      timestampQuery = false;
    } catch (error) {
      return { ran: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  try {
    const spans = timestampQuery ? timer(gpu) : undefined;
    const results: ShaderRenderMeasurement[] = [];

    for (const resolution of config.resolutions) {
      const view = target(gpu, { size: [resolution.width, resolution.height], format: "rgba8unorm" });

      for (const shader of shaders) {
        const spanName = `${shader.id}@${resolution.id}`;
        const gpuSamples: number[] = [];
        const unsubscribe = spans?.onResults((s) => {
          const value = s[spanName];
          if (typeof value === "number") gpuSamples.push(value);
        });

        const aspect = resolution.width / resolution.height;
        const pass = effect(gpu, shader.source.join("\n"), { set: { params: { time: 0, aspect } } });
        await pass.compile(view);

        for (let i = 0; i < config.warmupFrames; i += 1) {
          pass.set({ params: { time: i / 60, aspect } });
          frame(gpu, (f) => f.pass(view, pass));
        }
        await gpu.gpu.queue.onSubmittedWorkDone();

        const cpuSamples: number[] = [];
        for (let i = 0; i < config.measuredFrames; i += 1) {
          const started = performance.now();
          pass.set({ params: { time: i / 60, aspect } });
          frame(gpu, (f) => {
            if (spans) f.pass({ target: view, timer: spans.span(spanName) }, pass);
            else f.pass(view, pass);
          });
          cpuSamples.push(performance.now() - started);
          await gpu.gpu.queue.onSubmittedWorkDone();
        }

        await gpu.settled();
        unsubscribe?.();

        results.push({
          shaderId: shader.id,
          resolutionId: resolution.id,
          cpu: stat(cpuSamples),
          gpu: gpuSamples.length > 0 ? stat(gpuSamples) : undefined,
          gpuSamples: gpuSamples.length,
        });
      }
    }

    spans?.dispose();

    return {
      ran: true,
      adapter: gpu.adapter.name,
      adapterType: gpu.adapter.type,
      timestampQuery,
      measurements: results,
    };
  } catch (error) {
    return { ran: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    gpu.dispose();
  }
}
