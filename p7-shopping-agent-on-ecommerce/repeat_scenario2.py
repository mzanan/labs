from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import run_lab as rl

N_RUNS = 3

DENIAL_RE = re.compile(
    r"not in our catalog|not in the catalog|isn'?t in our catalog|aren'?t in our catalog|"
    r"didn'?t return results|did not return results|don'?t carry|doesn'?t carry|"
    r"not something we carry|not carried|no results for|not found in our catalog",
    re.IGNORECASE,
)


def detect_contradiction(turn_results: list[dict]) -> bool:
    successful_ids = set()
    for turn in turn_results:
        for call, result in zip(turn["tool_calls"], turn["tool_results"]):
            if call["tool"] == "get_product_details" and result["status"] == "ok":
                pid = call["input"].get("product_id")
                if pid:
                    successful_ids.add(pid)
    if not successful_ids:
        return False
    final_text = turn_results[-1]["text"]
    return bool(DENIAL_RE.search(final_text))


async def run_once(client, model: str, run_idx: int, scenario: dict, session_cfg: dict, cost_sink: list[float]) -> dict:
    before = len(cost_sink)
    run_session_cfg = {
        "session_id": f"{session_cfg['session_id']}-repeat2-run{run_idx}",
        "user_id": session_cfg["user_id"],
    }
    report = await rl.run_phase_b(model, client, [scenario], run_session_cfg)
    scenario_result = report["scenarios"][0]
    turn_results = scenario_result["turns"]

    all_ok = all(t["error"] is None for t in turn_results) and all(
        r["status"] == "ok" for t in turn_results for r in t["tool_results"]
    )

    flat_tool_calls = [
        {"turn_index": i, "tool": c["tool"], "input": c["input"]}
        for i, t in enumerate(turn_results)
        for c in t["tool_calls"]
    ]

    run_cost = round(sum(cost_sink[before:]), 6)

    return {
        "model": model,
        "run_index": run_idx,
        "tool_calls": flat_tool_calls,
        "all_tool_calls_ok": all_ok,
        "final_assistant_text": turn_results[-1]["text"],
        "grader_passed": scenario_result["passed"],
        "grader_reason": scenario_result["reason"],
        "contradicts_own_tool_result": detect_contradiction(turn_results),
        "cost_usd": run_cost,
    }


async def main() -> None:
    if not os.environ.get("EXPLABS_API_KEY"):
        print("EXPLABS_API_KEY not set, stopping.")
        return

    models_cfg = json.loads((rl.ROOT / "models.json").read_text())
    scenarios_cfg = json.loads((rl.ROOT / "scenarios.json").read_text())
    models = models_cfg["try_all"]
    scenario2 = next(s for s in scenarios_cfg["scenarios"] if s["id"] == 2)
    session_cfg = scenarios_cfg["session"]

    before_hash = rl.real_tables_checksum(rl.DB_PATH)
    print(f"Real tables checksum before: {before_hash}")

    cost_sink: list[float] = []
    client = rl.make_client(cost_sink)

    all_runs: list[dict] = []
    for model in models:
        for run_idx in range(1, N_RUNS + 1):
            print(f"\n--- model={model} run={run_idx} ---")
            result = await run_once(client, model, run_idx, scenario2, session_cfg, cost_sink)
            all_runs.append(result)
            print(
                f"  passed={result['grader_passed']} all_ok={result['all_tool_calls_ok']} "
                f"contradicts={result['contradicts_own_tool_result']} cost=${result['cost_usd']}"
            )

    after_hash = rl.real_tables_checksum(rl.DB_PATH)
    print(f"\nReal tables checksum after: {after_hash}")

    output = {
        "scenario_id": 2,
        "runs_per_model": N_RUNS,
        "models": models,
        "runs": all_runs,
        "real_tables_unchanged": before_hash == after_hash,
        "real_tables_checksum_before": before_hash,
        "real_tables_checksum_after": after_hash,
        "total_cost_usd": round(sum(cost_sink), 6),
        "total_api_calls_with_cost_recorded": len(cost_sink),
    }
    (rl.ROOT / "repeat-scenario2.json").write_text(json.dumps(output, indent=2, default=str))
    print(
        f"\nWrote repeat-scenario2.json. Total cost: ${output['total_cost_usd']} "
        f"Real tables unchanged: {output['real_tables_unchanged']}"
    )


if __name__ == "__main__":
    asyncio.run(main())
