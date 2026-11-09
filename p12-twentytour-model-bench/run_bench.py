from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from conversation import SCENARIOS, run_scenario
from openrouter import OpenRouter
from tracks import TRACKS, load

ROOT = Path(__file__).parent


def summarize(model: dict[str, Any], cells: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    all_cells = [
        {"ok": c["ok"], "cost_usd": c.get("cost_usd", c.get("agent_cost_usd", 0.0)), "latency_ms": c.get("latency_ms", c.get("agent_latency_ms", 0)), "provider": c.get("provider")}
        for track in cells.values()
        for c in track
    ]
    summary: dict[str, Any] = {
        "key": model["key"],
        "id": model["id"],
        "failed_calls": sum(1 for c in all_cells if not c["ok"]),
        "cost_usd": round(sum(c["cost_usd"] for c in all_cells), 6),
        "mean_latency_ms": round(sum(c["latency_ms"] for c in all_cells) / max(len(all_cells), 1)),
        "providers": sorted({c["provider"] for c in all_cells if c["provider"]}),
    }
    if "classify" in cells:
        summary["intent"] = f"{sum(c['intent_ok'] for c in cells['classify'])}/{len(cells['classify'])}"
        summary["language"] = f"{sum(c['language_ok'] for c in cells['classify'])}/{len(cells['classify'])}"
    if "extract" in cells:
        summary["extract"] = f"{sum(c['all_ok'] for c in cells['extract'])}/{len(cells['extract'])}"
    if "conversation" in cells:
        summary["conversation"] = f"{sum(c['all_ok'] for c in cells['conversation'])}/{len(cells['conversation'])}"
    if "draft" in cells:
        summary["draft"] = f"{sum(c['all_ok'] for c in cells['draft'])}/{len(cells['draft'])}"
    return summary


async def run_model(client: OpenRouter, model: dict[str, Any], tracks: list[str], reps: int) -> dict[str, Any]:
    cells: dict[str, list[dict[str, Any]]] = {}
    for track in tracks:
        cells[track] = []
        if track == "conversation":
            for scenario in SCENARIOS:
                for rep in range(1, reps + 1):
                    cell = await run_scenario(client, model, scenario)
                    cells[track].append({"rep": rep, **cell})
            continue
        fn = TRACKS[track][0]
        for scenario in load(track):
            for rep in range(1, reps + 1):
                cell = await fn(client, model, scenario)
                cells[track].append({"scenario": scenario["id"], "rep": rep, **cell})
    return {"summary": summarize(model, cells), "cells": cells}


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", default="all")
    parser.add_argument("--tracks", default="classify,extract,draft")
    parser.add_argument("--reps", type=int, default=3)
    parser.add_argument("--out")
    parser.add_argument("--config", default="models.json")
    args = parser.parse_args()

    config = json.loads((ROOT / args.config).read_text())
    wanted = None if args.models == "all" else set(args.models.split(","))
    models = [m for m in config["models"] if m.get("enabled", True) and (wanted is None or m["key"] in wanted)]
    tracks = args.tracks.split(",")
    out = Path(args.out) if args.out else ROOT / "runs" / f"report-{datetime.now(timezone.utc):%Y-%m-%d}.json"
    out.parent.mkdir(exist_ok=True)

    client = OpenRouter(config["provider_prefs"])
    report: dict[str, Any] = {"provider_prefs": config["provider_prefs"], "reps": args.reps, "models": {}}
    try:
        for model in models:
            result = await run_model(client, model, tracks, args.reps)
            report["models"][model["key"]] = result
            out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
            print(json.dumps(result["summary"], ensure_ascii=False), flush=True)
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
