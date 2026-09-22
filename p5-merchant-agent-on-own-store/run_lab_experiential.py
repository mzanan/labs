"""Drives lab #1's Phase 0 gate and 6 Phase B scenarios against
api.experientiallabs.ai, reusing run_lab.py's phase0/phase_b/run_scenario functions
completely unmodified: this script imports run_lab as a module and monkeypatches its
GATEWAY_BASE_URL and AsyncAnthropic module globals at runtime before calling them, so
the adapter, scenarios.json, the grading, run_lab.py itself and db/seed.py all stay
byte-for-byte as they were for the original Vercel AI Gateway run. Writes
report-experiential.json, never touches report.json.

Reseeds db/noir.sqlite (same ANCHOR_DATE/SEED as the original) before every model's
run, so all three are independent, comparable, and start from the same deterministic
state; run_lab.phase_b's own SHA-256 checksum of products/product_variants/orders/
order_items/stock_movements still runs unmodified inside that reused function.

Cost is read from each raw HTTP response's usage.cost field via an httpx response
hook wrapping the Anthropic client (the official SDK drops unknown usage fields when
aggregating turn usage, so this is the only way to total spend without touching
vendor code). A circuit breaker stops the run before the $0.50 ceiling is reached.

Run: source .venv/bin/activate && python3 run_lab_experiential.py
"""

from __future__ import annotations

import asyncio
import json
import os
import statistics
import subprocess
import sys
from pathlib import Path

import httpx
from anthropic import AsyncAnthropic

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

import run_lab

EXPERIENTIAL_BASE_URL = "https://api.experientiallabs.ai"
MODELS = ["deepseek-v4-flash", "gpt-5.6-luna", "qwen3.8-27b"]
COST_CEILING_USD = 0.50
COST_STOP_AT_USD = 0.45
OUTPUT_PATH = ROOT / "report-experiential.json"

cost_log: list[float] = []


async def _cost_hook(response: httpx.Response) -> None:
    try:
        await response.aread()
        data = json.loads(response.content)
    except Exception:
        return
    usage = data.get("usage") or {}
    cost = usage.get("cost")
    if isinstance(cost, (int, float)):
        cost_log.append(float(cost))


class CostTrackingAsyncAnthropic(AsyncAnthropic):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault(
            "http_client",
            httpx.AsyncClient(event_hooks={"response": [_cost_hook]}),
        )
        super().__init__(*args, **kwargs)


def total_cost() -> float:
    return sum(cost_log)


def reseed() -> None:
    python_bin = ROOT / ".venv" / "bin" / "python3"
    subprocess.run([str(python_bin), str(ROOT / "db" / "seed.py")], cwd=str(ROOT), check=True)


async def run_one_model(model: str, api_key: str) -> dict:
    reseed()
    print(f"\n=== {model} ===")

    winner, phase0_results = await run_lab.phase0([model], api_key)
    phase0_entry = phase0_results[0] if phase0_results else {
        "model": model, "tool_use": False, "tool_result_accepted": False, "error": "no attempt",
    }

    phase_b_result = await run_lab.phase_b(model, api_key)

    turns = phase_b_result["turns"]
    completed = [t for t in turns if not t["error"]]
    latencies = [t["elapsed_s"] for t in completed]
    retry_or_ratelimit_scenarios = [
        t["scenario_id"] for t in turns
        if t.get("retries", 0) > 0 or (t["error"] and "RateLimitError" in t["error"])
    ]

    return {
        "model": model,
        "phase0": phase0_entry,
        "phase_b": phase_b_result,
        "completed_turns": len(completed),
        "median_latency_s_completed_turns": statistics.median(latencies) if latencies else None,
        "scenarios_with_retry_or_rate_limit": retry_or_ratelimit_scenarios,
        "cumulative_cost_usd_after_this_model": total_cost(),
    }


async def main() -> None:
    api_key = os.environ.get("EXPLABS_API_KEY")
    if not api_key:
        print("EXPLABS_API_KEY not set in the shell env, stopping.")
        return

    run_lab.GATEWAY_BASE_URL = EXPERIENTIAL_BASE_URL
    run_lab.AsyncAnthropic = CostTrackingAsyncAnthropic

    report: dict = {"base_url": EXPERIENTIAL_BASE_URL, "cost_ceiling_usd": COST_CEILING_USD, "models": []}
    for model in MODELS:
        if total_cost() >= COST_STOP_AT_USD:
            print(f"Cost circuit breaker hit (${total_cost():.4f}), stopping before {model}.")
            report["stopped_early_before_model"] = model
            break
        result = await run_one_model(model, api_key)
        report["models"].append(result)
        print(f"  cumulative cost: ${total_cost():.6f}")

    report["total_cost_usd"] = total_cost()
    OUTPUT_PATH.write_text(json.dumps(report, indent=2, default=str))
    print(f"\nWrote {OUTPUT_PATH.name}, total cost ${total_cost():.6f}")


if __name__ == "__main__":
    asyncio.run(main())
