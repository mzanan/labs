"""Wires env (ANTHROPIC_BASE_URL, the Gateway key, a model from models.json) and
SqliteMerchantBackend into the real Messages API merchant-agent runtime, runs Phase 0's
tool-use gate, then the 6 scenarios in scenarios.json as one continuous session, and
prints a results table. Writes report.json with the full detail (gitignored).

Run: source .venv/bin/activate && python3 run_lab.py
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / "adapter"))

load_dotenv(ROOT / ".env")

from anthropic import AsyncAnthropic  # noqa: E402
from merchant_agent import MerchantAgentConfig, MerchantSessionContext, MerchantSessionState  # noqa: E402
from merchant_agent_runtime.orchestrator import MerchantAgent  # noqa: E402
from sqlite_merchant import SqliteMerchantBackend  # noqa: E402

GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh"
SKILLS_DIR = ROOT / "upstream" / "merchant-agent" / "skills"
DB_PATH = os.environ.get("NOIR_DB_PATH", str(ROOT / "db" / "noir.sqlite"))
NOIR_TABLES = ("products", "product_variants", "orders", "order_items", "stock_movements")


def noir_tables_checksum(db_path: str) -> str:
    """A hash of the 5 real NOIR tables' contents, so Phase B can prove nothing but
    lab_staged_changes moved. Any difference before vs after is an automatic fail."""
    conn = sqlite3.connect(db_path)
    try:
        digest = hashlib.sha256()
        for table in NOIR_TABLES:
            for row in conn.execute(f"SELECT * FROM {table} ORDER BY rowid"):
                digest.update(repr(row).encode())
        return digest.hexdigest()
    finally:
        conn.close()


async def try_model(client: AsyncAnthropic, model: str) -> dict:
    """One Phase 0 check: does /v1/messages emit tool_use for this model id through the
    Gateway, and does it then accept a tool_result and finish the turn."""
    entry: dict = {"model": model, "tool_use": False, "tool_result_accepted": False, "error": None}
    tool = {
        "name": "get_lab_time",
        "description": "Return the current lab reference time.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    }
    try:
        first = await client.messages.create(
            model=model,
            max_tokens=256,
            tools=[tool],
            tool_choice={"type": "tool", "name": "get_lab_time"},
            messages=[{"role": "user", "content": "What time is it? Use the tool."}],
        )
        tool_use = next((b for b in first.content if b.type == "tool_use"), None)
        if tool_use is None:
            entry["error"] = f"no tool_use block, stop_reason={first.stop_reason}"
            return entry
        entry["tool_use"] = True
        follow = await client.messages.create(
            model=model,
            max_tokens=256,
            tools=[tool],
            messages=[
                {"role": "user", "content": "What time is it? Use the tool."},
                {"role": "assistant", "content": first.content},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use.id,
                            "content": "2026-09-08T00:00:00Z",
                        }
                    ],
                },
            ],
        )
        entry["tool_result_accepted"] = follow.stop_reason in ("end_turn", "max_tokens")
        if not entry["tool_result_accepted"]:
            entry["error"] = f"tool_result not accepted, stop_reason={follow.stop_reason}"
    except Exception as exc:  # Phase 0 records every model's failure verbatim and moves on
        entry["error"] = f"{type(exc).__name__}: {exc}"
    return entry


async def phase0(
    models: list[str], api_key: str, max_retries: int = 2, backoff_s: float = 70.0
) -> tuple[str | None, list[dict]]:
    client = AsyncAnthropic(api_key=api_key, base_url=GATEWAY_BASE_URL)
    results = []
    winner = None
    for model in models:
        entry = {}
        for attempt in range(max_retries + 1):
            entry = await try_model(client, model)
            rate_limited = entry["error"] and "RateLimitError" in entry["error"]
            if rate_limited and attempt < max_retries:
                wait = backoff_s * (attempt + 1)
                print(f"    {model} rate limited, waiting {wait:.0f}s "
                      f"before retry {attempt + 1}/{max_retries}")
                await asyncio.sleep(wait)
                continue
            break
        results.append(entry)
        print(
            f"  {model}: tool_use={entry['tool_use']} "
            f"tool_result_accepted={entry['tool_result_accepted']} error={entry['error']}"
        )
        if entry["tool_result_accepted"]:
            winner = model
            break
    return winner, results


async def _run_scenario_once(agent: MerchantAgent, session, state, messages: list, prompt: str) -> dict:
    messages.append({"role": "user", "content": [{"type": "text", "text": prompt}]})
    tool_calls: list[str] = []
    tool_results: list[dict] = []
    text = ""
    usage: dict = {}
    error = None
    started = time.monotonic()
    try:
        async for event in agent.stream_turn(messages, session, state):
            if event.type == "tool_call":
                tool_calls.append(event.data["tool"])
            elif event.type == "tool_result":
                tool_results.append(
                    {
                        "tool": event.data["tool"],
                        "status": event.data["status"],
                        "reason": event.data.get("reason"),
                    }
                )
            elif event.type == "text_delta":
                text += event.data["text"]
            elif event.type == "turn_complete":
                usage = event.data["usage"]
            elif event.type == "error":
                error = event.data["message"]
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    return {
        "prompt": prompt,
        "tool_calls": tool_calls,
        "tool_results": tool_results,
        "text": text,
        "usage": usage,
        "elapsed_s": round(time.monotonic() - started, 1),
        "error": error,
    }


async def run_scenario(
    agent: MerchantAgent, session, state, messages: list, prompt: str,
    max_retries: int = 2, backoff_s: float = 65.0,
) -> dict:
    """Retries on a free-tier rate limit with fixed spacing (p0-provider-layer measured
    60s spacing as enough to clear this Gateway's per-model free-tier limit). Any other
    failure is returned as is, no retry."""
    result: dict = {}
    snapshot_len = len(messages)
    for attempt in range(max_retries + 1):
        result = await _run_scenario_once(agent, session, state, messages, prompt)
        rate_limited = result["error"] and "RateLimitError" in result["error"]
        if rate_limited and attempt < max_retries:
            del messages[snapshot_len:]
            wait = backoff_s * (attempt + 1)
            print(f"    rate limited, waiting {wait:.0f}s before retry {attempt + 1}/{max_retries}")
            await asyncio.sleep(wait)
            continue
        if result["error"]:
            # Every retry exhausted (or a non-rate-limit error): drop the dangling user
            # message too, so a failed turn never bleeds into the next scenario's prompt.
            del messages[snapshot_len:]
        result["retries"] = attempt
        return result
    return result


def grounded_facts(db_path: str) -> dict:
    """Read straight from the SQLite file, no model involved: the numbers Phase B's
    scenarios are graded against."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT price, stock_quantity FROM products WHERE id = 'prod-15'").fetchone()
        return {"prod_15_price": row["price"], "prod_15_stock": row["stock_quantity"]}
    finally:
        conn.close()


async def phase_b(model: str, api_key: str) -> dict:
    before_hash = noir_tables_checksum(DB_PATH)
    facts_before = grounded_facts(DB_PATH)

    config = MerchantAgentConfig(
        brand_name="NOIR",
        model=model,
        thinking_effort=None,
        max_tool_iterations=6,
        enable_memory=False,
        enable_web_search=False,
        enable_analysis=False,
        enable_campaigns=False,
        require_host_approval=True,
    )
    client = AsyncAnthropic(api_key=api_key, base_url=GATEWAY_BASE_URL)
    backend = SqliteMerchantBackend(DB_PATH, config=config)
    agent = MerchantAgent(backend=backend, skills_dir=SKILLS_DIR, config=config, client=client)

    session = MerchantSessionContext(
        session_id="lab-session", merchant_id=backend.merchant_id, operator="lab-operator"
    )
    state = MerchantSessionState()
    messages: list = []

    scenarios = json.loads((ROOT / "scenarios.json").read_text())["scenarios"]
    turn_results = []
    for scenario in scenarios:
        result = await run_scenario(agent, session, state, messages, scenario["prompt"])
        result["scenario_id"] = scenario["id"]
        turn_results.append(result)
        print(f"scenario {scenario['id']}: tools={result['tool_calls']} "
              f"elapsed={result['elapsed_s']}s error={result['error']}")

    facts_after = grounded_facts(DB_PATH)
    after_hash = noir_tables_checksum(DB_PATH)
    pending = conn_pending_changes(DB_PATH)

    return {
        "model": model,
        "turns": turn_results,
        "noir_tables_unchanged": before_hash == after_hash,
        "facts_before": facts_before,
        "facts_after": facts_after,
        "lab_staged_changes_rows": pending,
    }


def conn_pending_changes(db_path: str) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT change_id, kind, status, summary FROM lab_staged_changes").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


async def main() -> None:
    api_key = os.environ.get("AI_GATEWAY_API_KEY")
    if not api_key:
        print("AI_GATEWAY_API_KEY not set in .env, stopping.")
        return
    models = json.loads((ROOT / "models.json").read_text())["try_in_order"]

    print("Phase 0: tool-use gate through the Gateway")
    winner, phase0_results = await phase0(models, api_key)
    report: dict = {"phase0": phase0_results, "phase0_winner": winner}
    if winner is None:
        print("\nNo model in models.json emitted a usable tool_use through /v1/messages.")
        print('Verdict: "not runnable on the free path." Stopping, no Phase B.')
        (ROOT / "report.json").write_text(json.dumps(report, indent=2))
        return
    print(f"\nPhase 0 winner: {winner}\n")

    print(f"Phase B: 6 scenarios against noir.sqlite, model={winner}")
    report["phase_b"] = await phase_b(winner, api_key)
    (ROOT / "report.json").write_text(json.dumps(report, indent=2, default=str))
    print("\nWrote report.json")


if __name__ == "__main__":
    asyncio.run(main())
