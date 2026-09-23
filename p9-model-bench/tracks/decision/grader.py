"""Aggregates track 3 raw cell results into per-model accuracy, latency, cost and per-rep
agreement (how often the 3 reps of the same scenario landed on the same kind answer, so
determinism is visible alongside accuracy)."""

from __future__ import annotations

from typing import Any


def _p95(values: list[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    idx = min(len(s) - 1, int(round(0.95 * (len(s) - 1))))
    return s[idx]


def summarize(model_key: str, cells: list[dict]) -> dict[str, Any]:
    own = [c for c in cells if c["model_key"] == model_key]
    ok_cells = [c for c in own if c["ok"]]
    n = len(own)
    kind_acc = sum(1 for c in own if c["kind_correct"]) / n if n else 0.0
    transfer_acc = sum(1 for c in own if c["is_transfer_correct"]) / n if n else 0.0
    latencies = [c["latency_ms"] for c in ok_cells if c.get("latency_ms")]
    cost = sum(c.get("cost_usd") or 0.0 for c in own)

    by_scenario: dict[int, list[str | None]] = {}
    for c in own:
        by_scenario.setdefault(c["scenario_id"], []).append(
            (c.get("answer") or {}).get("kind") if c.get("answer") else None
        )
    agree = [1 for answers in by_scenario.values() if len(set(answers)) == 1]
    agreement_rate = len(agree) / len(by_scenario) if by_scenario else 0.0

    errors = [c["error"] for c in own if not c["ok"] and c["error"]]
    return {
        "model_key": model_key,
        "cells": n,
        "kind_accuracy": round(kind_acc, 3),
        "is_transfer_accuracy": round(transfer_acc, 3),
        "per_rep_agreement": round(agreement_rate, 3),
        "mean_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0.0,
        "p95_latency_ms": round(_p95(latencies), 1),
        "cost_usd": round(cost, 6),
        "errors_sample": errors[:3],
    }
