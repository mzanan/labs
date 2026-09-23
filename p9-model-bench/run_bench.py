"""Orchestrator: run_bench.py --tracks tool_call,decision,vision --models all --reps 3
--out report-<date>.json

Phase 0 gates every enabled model first (one trivial forced tool call for a chat model, one
systemone call for jev, a local predict call for laya), then runs the requested tracks
only against the models that passed. Track 3 (decision) additionally restricts itself to jev plus
the single cheapest chat model that passed Phase 0, per the spec's phase-1 budget scoping. Stops
and reports as soon as cumulative cost crosses cost_ceiling_usd from models.json.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")
sys.path.insert(0, str(ROOT))

from providers import Providers  # noqa: E402
from tracks.decision import grader as decision_grader  # noqa: E402
from tracks.decision import runner as decision_runner  # noqa: E402
from tracks.tool_call import runner as tool_call_runner  # noqa: E402
from tracks.vision import runner as vision_runner  # noqa: E402

PHASE0_TOOL_ANTHROPIC = {
    "name": "get_lab_time",
    "description": "Return the current lab reference time.",
    "input_schema": {"type": "object", "properties": {}, "required": []},
}
PHASE0_TOOL_OPENAI = {
    "type": "function",
    "function": {"name": "get_lab_time", "description": "Return the current lab reference time.",
                 "parameters": {"type": "object", "properties": {}, "required": []}},
}


async def phase0_gate(providers: Providers, model_cfg: dict, phase0_max_tokens: int = 512) -> dict:
    key, provider, model_id, kind = model_cfg["key"], model_cfg["provider"], model_cfg["id"], model_cfg.get("kind", "chat")
    entry = {"model_key": key, "provider": provider, "model_id": model_id, "passed": False, "error": None}


    if kind == "systemone":
        result = await providers.systemone(
            model_cfg["provider"], key, model_id, state="Accounts: Checking.\nTransaction: Checking -5.00 \"Coffee\"",
            questions={"kind": {"type": "choice", "instructions": "income, expense, or transfer?",
                                 "criteria": {"income": "money received", "expense": "money paid out", "transfer": "movement between own accounts"}}},
        )
        entry["passed"] = result.ok and bool(result.raw_answer)
        entry["error"] = result.error
        entry["cost_usd"] = result.cost_usd
        entry["raw"] = result.raw_answer if not entry["passed"] else None
        return entry

    if provider == "explabs":
        result = await providers.explabs_messages(
            key, model_id,
            messages=[{"role": "user", "content": "What time is it? Use the tool."}],
            tools=[PHASE0_TOOL_ANTHROPIC], tool_choice={"type": "tool", "name": "get_lab_time"},
            max_tokens=phase0_max_tokens,
        )
        tool_use = next((b for b in result.content if b["type"] == "tool_use"), None) if result.ok else None
        entry["passed"] = result.ok and tool_use is not None
        entry["error"] = result.error or (None if tool_use else f"no tool_use block, stop_reason={result.stop_reason}, content={result.content}")
        entry["cost_usd"] = result.cost_usd
        return entry

    result = await providers.openrouter_chat(
        key, model_id,
        messages=[{"role": "user", "content": "What time is it? Use the tool."}],
        tools=[PHASE0_TOOL_OPENAI], max_tokens=phase0_max_tokens,
    )
    tool_use = next((b for b in result.content if b["type"] == "tool_use"), None) if result.ok else None
    entry["passed"] = result.ok and tool_use is not None
    entry["error"] = result.error or (None if tool_use else f"no tool_use block, finish_reason={result.stop_reason}, content={result.content}")
    entry["cost_usd"] = result.cost_usd
    return entry


def _cheapest(phase0_results: list[dict], models_cfg: list[dict]) -> str | None:
    chat_passed = [r for r in phase0_results if r["passed"] and r["provider"] != "laya"
                    and next(m for m in models_cfg if m["key"] == r["model_key"]).get("kind") != "systemone"]
    priced = [r for r in chat_passed if r.get("cost_usd")]
    pool = priced or chat_passed
    if not pool:
        return None
    return min(pool, key=lambda r: r.get("cost_usd") or 0.0)["model_key"]


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tracks", default="tool_call,decision,vision")
    parser.add_argument("--models", default="all")
    parser.add_argument("--reps", type=int, default=3)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    models_cfg_all = json.loads((ROOT / "models.json").read_text())
    models = [m for m in models_cfg_all["models"] if m["enabled"]]
    if args.models != "all":
        wanted = set(args.models.split(","))
        models = [m for m in models if m["key"] in wanted]

    providers = Providers(
        timeout_s=models_cfg_all["timeout_s"],
        retry_max=models_cfg_all["retry"]["max"],
        backoff_s=models_cfg_all["retry"]["backoff_s"],
        hard_timeout_s=models_cfg_all.get("hard_timeout_s", 180),
    )
    cost_ceiling = models_cfg_all["cost_ceiling_usd"]
    report: dict = {"phase0": [], "tool_call": [], "decision": [], "vision": [], "total_cost_usd": 0.0}
    total_cost = 0.0
    out_name = args.out or f"report-{time.strftime('%Y-%m-%d')}.json"

    def flush() -> None:
        report["total_cost_usd"] = round(total_cost, 6)
        (ROOT / out_name).write_text(json.dumps(report, indent=2, default=str))

    print("Phase 0: gate every enabled model")
    for model_cfg in models:
        entry = await phase0_gate(providers, model_cfg)
        report["phase0"].append(entry)
        total_cost += entry.get("cost_usd") or 0.0
        print(f"  {model_cfg['key']} ({model_cfg['provider']}/{model_cfg['id']}): "
              f"{'PASS' if entry['passed'] else 'BLOCKED'} error={entry['error']}")

    passed_keys = {r["model_key"] for r in report["phase0"] if r["passed"]}
    passed_models = [m for m in models if m["key"] in passed_keys]

    tracks = set(args.tracks.split(","))

    if "decision" in tracks:
        scenarios = json.loads((ROOT / "tracks" / "decision" / "scenarios.json").read_text())["scenarios"]
        cheapest_key = _cheapest(report["phase0"], models)
        free_chat_passed = [m for m in passed_models if m.get("kind") != "systemone" and m.get("free")]
        decision_models = [
            m for m in passed_models
            if (m.get("kind") == "systemone") or m["key"] == cheapest_key or m in free_chat_passed
        ]
        jev_models = [m for m in decision_models if m.get("kind") == "systemone"]
        for jev_cfg in list(jev_models):
            for variant in ("score", "noul"):
                extra = dict(jev_cfg)
                extra["systemone_variant"] = variant
                extra["report_key"] = f"{jev_cfg['key']}-{variant}"
                decision_models.append(extra)
        print(f"\nTrack 3 (decision): cheapest paid chat model = {cheapest_key}, "
              f"free chat models = {[m['key'] for m in free_chat_passed]}, "
              f"running {[m.get('report_key', m['key']) for m in decision_models]}")
        all_cells = []
        for model_cfg in decision_models:
            if total_cost >= cost_ceiling:
                print(f"Cost ceiling ${cost_ceiling} reached, stopping decision track.")
                break
            cells = await decision_runner.run(providers, model_cfg, scenarios, args.reps)
            total_cost += sum(c.get("cost_usd") or 0.0 for c in cells)
            all_cells.extend(cells)
            report_key = model_cfg.get("report_key", model_cfg["key"])
            print(f"  {report_key}: {decision_grader.summarize(report_key, cells)}")
            report["decision"] = {"cells": all_cells}
            flush()
        report["decision"] = {
            "cheapest_model": cheapest_key,
            "cells": all_cells,
            "summary": [
                decision_grader.summarize(m.get("report_key", m["key"]), all_cells) for m in decision_models
            ],
        }

    if "tool_call" in tracks:
        scenarios_cfg = json.loads((ROOT / "tracks" / "tool_call" / "scenarios.json").read_text())
        scenarios, session_cfg = scenarios_cfg["scenarios"], scenarios_cfg["session"]
        chat_models = [m for m in passed_models if m.get("kind") != "systemone"]
        print(f"\nTrack 1 (tool_call): {[m['key'] for m in chat_models]}")
        all_cells = []
        for model_cfg in chat_models:
            if total_cost >= cost_ceiling:
                print(f"Cost ceiling ${cost_ceiling} reached, stopping tool_call track.")
                break
            cells = await tool_call_runner.run(providers, model_cfg, scenarios, session_cfg, args.reps)
            total_cost += sum(c.get("cost_usd") or 0.0 for c in cells)
            all_cells.extend(cells)
            passed_n = sum(1 for c in cells if c["passed"])
            print(f"  {model_cfg['key']}: {passed_n}/{len(cells)} cells passed")
            report["tool_call"] = all_cells
            flush()
        report["tool_call"] = all_cells

    if "vision" in tracks:
        images_cfg = json.loads((ROOT / "tracks" / "vision" / "scenarios.json").read_text())["images"]
        vision_models = [m for m in passed_models if m.get("supports_vision")]
        print(f"\nTrack 4 (vision): capability check only, models={[m['key'] for m in vision_models]}")
        vision_results = []
        for model_cfg in vision_models:
            result = await vision_runner.run(providers, model_cfg, images_cfg, args.reps)
            vision_results.append(result)
            print(f"  {model_cfg['key']}: {result['status']} {result.get('reason', '')}")
        report["vision"] = vision_results

    flush()
    print(f"\nWrote {out_name}. Total cost: ${report['total_cost_usd']}")


if __name__ == "__main__":
    asyncio.run(main())
