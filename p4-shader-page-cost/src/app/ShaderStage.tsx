"use client";

import { useState } from "react";

import { useShaderStage, type StageShader } from "./useShaderStage.ts";

const DPR_CAPS = [1, 1.5, 2, 3];
const FRAME_BUDGET_MS = 16.67;

export function ShaderStage({ shaders }: { shaders: readonly StageShader[] }) {
  const [shaderId, setShaderId] = useState(shaders[shaders.length - 1].id);
  const [dprCap, setDprCap] = useState(2);
  const shader = shaders.find((s) => s.id === shaderId) ?? shaders[0];
  const { canvasRef, state } = useShaderStage(shader, dprCap);

  const stats = state.stats;
  const share = stats?.gpuP95 !== undefined ? (stats.gpuP95 / FRAME_BUDGET_MS) * 100 : undefined;

  return (
    <main className="stage">
      <canvas ref={canvasRef} />

      <section className="panel">
        <h2>shader</h2>
        <div className="controls">
          {shaders.map((s) => (
            <button key={s.id} type="button" aria-pressed={s.id === shaderId} onClick={() => setShaderId(s.id)}>
              {s.id}
            </button>
          ))}
        </div>

        <h2>dpr cap</h2>
        <div className="controls">
          {DPR_CAPS.map((cap) => (
            <button key={cap} type="button" aria-pressed={cap === dprCap} onClick={() => setDprCap(cap)}>
              {cap}x
            </button>
          ))}
        </div>

        <div className="hr" />

        {state.status === "unsupported" ? (
          <div className="row">
            <span className="over">no webgpu</span>
            <span>{state.reason}</span>
          </div>
        ) : !stats ? (
          <div className="row">
            <span>starting</span>
            <span>acquiring adapter</span>
          </div>
        ) : (
          <>
            <div className="row">
              <span>fps</span>
              <span>{stats.fps.toFixed(1)}</span>
            </div>
            <div className="row">
              <span>raf delta p50 / p95</span>
              <span>
                {stats.rafP50.toFixed(2)} / {stats.rafP95.toFixed(2)} ms
              </span>
            </div>
            <div className="row">
              <span>gpu pass p50 / p95</span>
              <span>
                {state.timestampQuery && stats.gpuP95 !== undefined
                  ? `${stats.gpuP50?.toFixed(3)} / ${stats.gpuP95.toFixed(3)} ms`
                  : "timestamp-query off"}
              </span>
            </div>
            <div className="row">
              <span>gpu share of 16.67 ms</span>
              <span className={share !== undefined && share > 50 ? "over" : undefined}>
                {share !== undefined ? `${share.toFixed(1)}%` : "n/a"}
              </span>
            </div>
            <div className="hr" />
            <div className="row">
              <span>backbuffer</span>
              <span>
                {stats.pixels} @ {stats.dpr.toFixed(2)}x
              </span>
            </div>
            <div className="row">
              <span>adapter</span>
              <span>{state.adapter}</span>
            </div>
          </>
        )}
      </section>

      <div className="hero">
        <h1>Shader background, priced</h1>
        <p>{shader.note}</p>
      </div>
    </main>
  );
}
