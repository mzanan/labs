"use client";

import { useEffect, useRef, useState } from "react";

export interface StageShader {
  readonly id: string;
  readonly note: string;
  readonly source: readonly string[];
}

export interface StageStats {
  readonly fps: number;
  readonly rafP50: number;
  readonly rafP95: number;
  readonly gpuP50?: number;
  readonly gpuP95?: number;
  readonly pixels: string;
  readonly dpr: number;
}

export interface StageState {
  readonly status: "starting" | "running" | "unsupported";
  readonly reason?: string;
  readonly adapter?: string;
  readonly timestampQuery: boolean;
  readonly stats?: StageStats;
}

const SAMPLE_WINDOW = 180;

function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function push(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > SAMPLE_WINDOW) samples.shift();
}

export function useShaderStage(shader: StageShader, dprCap: number) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<StageState>({ status: "starting", timestampQuery: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let teardown: (() => void) | undefined;

    void (async () => {
      if (typeof navigator === "undefined" || !("gpu" in navigator)) {
        setState({ status: "unsupported", timestampQuery: false, reason: "navigator.gpu is not available in this browser." });
        return;
      }

      const { clock, effect, frameLoop, init, surface, timer } = await import("vgpu");

      let gpu: Awaited<ReturnType<typeof init>>;
      let timestampQuery = true;
      try {
        gpu = await init({ requiredFeatures: ["timestamp-query"] });
      } catch {
        try {
          gpu = await init();
          timestampQuery = false;
        } catch (error) {
          setState({
            status: "unsupported",
            timestampQuery: false,
            reason: error instanceof Error ? error.message : String(error),
          });
          return;
        }
      }

      if (disposed) {
        gpu.dispose();
        return;
      }

      const view = surface(gpu, canvas, { dpr: [1, dprCap] });
      const aspect = view.size[0] / view.size[1];
      const pass = effect(gpu, shader.source.join("\n"), { set: { params: { time: 0, aspect } } });
      const time = clock(gpu);

      const spans = timestampQuery ? timer(gpu) : undefined;
      const gpuSamples: number[] = [];
      spans?.onResults((results) => {
        const value = results[shader.id];
        if (typeof value === "number") push(gpuSamples, value);
      });

      const rafSamples: number[] = [];
      let previous = performance.now();
      let lastReport = previous;

      const loop = frameLoop(gpu, (f) => {
        const now = performance.now();
        push(rafSamples, now - previous);
        previous = now;

        pass.set({ params: { time: time.time, aspect: view.size[0] / view.size[1] } });
        if (spans) f.pass({ target: view, timer: spans.span(shader.id) }, pass);
        else f.pass(view, pass);

        if (now - lastReport < 400) return;
        lastReport = now;
        const rafP50 = percentile(rafSamples, 0.5);
        setState({
          status: "running",
          timestampQuery,
          adapter: gpu.device.adapterInfo?.description || gpu.device.adapterInfo?.vendor || "unknown",
          stats: {
            fps: rafP50 > 0 ? 1000 / rafP50 : 0,
            rafP50,
            rafP95: percentile(rafSamples, 0.95),
            gpuP50: gpuSamples.length > 0 ? percentile(gpuSamples, 0.5) : undefined,
            gpuP95: gpuSamples.length > 0 ? percentile(gpuSamples, 0.95) : undefined,
            pixels: `${view.size[0]}x${view.size[1]}`,
            dpr: view.dpr,
          },
        });
      });

      teardown = () => {
        loop.stop();
        gpu.dispose();
      };
    })();

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [shader, dprCap]);

  return { canvasRef, state };
}
