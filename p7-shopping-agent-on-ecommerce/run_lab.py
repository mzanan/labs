"""Wires env (EXPLABS_API_KEY, the 4 models the spec allows) and EcommerceStorefrontBackend
into the real Messages API shopping-agent runtime, over a local SQLite mirror of
personal/ecommerce's real schema (never the Neon production database), runs Phase 0's
tool-use gate for every model, then the 6 scenarios (scenario 3 is 4 turns of the same
conversation) once per model as one continuous session each, and writes report.json.

A thin httpx transport (_CostTransport/_TeeStream) tees every response's raw bytes to
recover the gateway's usage.cost field. This was necessary because the anthropic SDK's
streaming accumulator drops it: verified empirically that a streamed call's
message_delta event carries {"cost": ..., "is_byok": ...} as pydantic extras on its
usage object, but the final accumulated Message.usage the SDK hands back after the
stream closes does not carry either field. Phase 0's plain (non-streaming) calls also
go through the same client, so one code path covers both. The gateway also gzips every
response body regardless of streaming, transparently to httpx (whose own gzip decoding
happens one layer above the transport, after this tee already ran), so the tee
decompresses its buffered copy before scanning it for the cost field.

Run: source .venv/bin/activate && python3 run_lab.py
"""

from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / "adapter"))

load_dotenv(ROOT / ".env")

import httpx
from anthropic import AsyncAnthropic
from shopping_agent import ShoppingAgentConfig, ShoppingSessionContext, ShoppingSessionState
from shopping_agent_runtime.orchestrator import ShoppingAgent
from ecommerce_storefront import EcommerceStorefrontBackend

BASE_URL = "https://api.experientiallabs.ai"
SKILLS_DIR = ROOT / "upstream" / "shopping-agent" / "skills"
DB_PATH = os.environ.get("ECOMMERCE_MIRROR_DB_PATH", str(ROOT / "db" / "ecommerce_mirror.sqlite"))
REAL_TABLES = (
    "user", "product_categories", "category_sizes", "products", "product_images",
    "product_variants", "sets", "set_products", "orders", "order_items", "pending_orders",
    "country_shipping_prices", "app_settings",
)
COST_CEILING_USD = 0.50
COST_RE = re.compile(rb'"cost"\s*:\s*(-?[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)')


def real_tables_checksum(db_path: str) -> str:
    """A hash of every mirrored real-schema table's contents (the 13 tables
    src/db/schema.ts defines that this lab mirrors), so Phase B can prove nothing but
    the lab_* tables moved. Any difference before vs after is an automatic fail."""
    conn = sqlite3.connect(db_path)
    try:
        digest = hashlib.sha256()
        for table in REAL_TABLES:
            for row in conn.execute(f"SELECT * FROM {table} ORDER BY rowid"):
                digest.update(repr(row).encode())
        return digest.hexdigest()
    finally:
        conn.close()


class _TeeStream(httpx.AsyncByteStream):
    """Wraps the real response stream: yields every chunk on as it arrives, and once
    fully consumed, scans the whole body for usage.cost. httpx asserts
    ``isinstance(response.stream, AsyncByteStream)``, so this must subclass it rather
    than being a bare async generator."""

    def __init__(self, wrapped: httpx.AsyncByteStream, sink: list[float]) -> None:
        self._wrapped = wrapped
        self._sink = sink

    async def __aiter__(self):
        buf = bytearray()
        async for chunk in self._wrapped:
            buf.extend(chunk)
            yield chunk
        raw = bytes(buf)
        if raw[:2] == b"\x1f\x8b":
            try:
                raw = gzip.decompress(raw)
            except OSError:
                pass
        for match in COST_RE.finditer(raw):
            self._sink.append(float(match.group(1)))

    async def aclose(self) -> None:
        await self._wrapped.aclose()


class _CostTransport(httpx.AsyncBaseTransport):
    """Tees every response's bytes past the real transport to recover usage.cost; see
    module docstring for why the SDK's own accumulation does not preserve it."""

    def __init__(self, wrapped: httpx.AsyncBaseTransport, sink: list[float]) -> None:
        self._wrapped = wrapped
        self._sink = sink

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self._wrapped.handle_async_request(request)
        response.stream = _TeeStream(response.stream, self._sink)
        return response

    async def aclose(self) -> None:
        await self._wrapped.aclose()


def make_client(cost_sink: list[float]) -> AsyncAnthropic:
    api_key = os.environ["EXPLABS_API_KEY"]
    http_client = httpx.AsyncClient(
        transport=_CostTransport(httpx.AsyncHTTPTransport(), cost_sink)
    )
    return AsyncAnthropic(api_key=api_key, base_url=BASE_URL, http_client=http_client)


async def try_model(client: AsyncAnthropic, model: str) -> dict:
    """One /v1/messages call with one tool defined, checking for a tool_use block, then a
    follow-up with a tool_result, checking the turn completes."""
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
                            "content": "2026-09-13T00:00:00Z",
                        }
                    ],
                },
            ],
        )
        entry["tool_result_accepted"] = follow.stop_reason in ("end_turn", "max_tokens")
        if not entry["tool_result_accepted"]:
            entry["error"] = f"tool_result not accepted, stop_reason={follow.stop_reason}"
    except Exception as exc:
        entry["error"] = f"{type(exc).__name__}: {exc}"
    return entry


async def phase0(models: list[str], client: AsyncAnthropic) -> list[dict]:
    results = []
    for model in models:
        entry = await try_model(client, model)
        results.append(entry)
        print(
            f"  {model}: tool_use={entry['tool_use']} "
            f"tool_result_accepted={entry['tool_result_accepted']} error={entry['error']}"
        )
    return results


async def _run_turn(agent: ShoppingAgent, session, state, messages: list, prompt: str) -> dict:
    messages.append({"role": "user", "content": [{"type": "text", "text": prompt}]})
    tool_calls: list[dict] = []
    tool_results: list[dict] = []
    text = ""
    usage: dict = {}
    error = None
    started = time.monotonic()
    try:
        async for event in agent.stream_turn(messages, session, state):
            if event.type == "tool_call":
                tool_calls.append({"tool": event.data["tool"], "input": event.data.get("input", {})})
            elif event.type == "tool_result":
                tool_results.append(
                    {
                        "tool": event.data["tool"],
                        "status": event.data["status"],
                        "summary": event.data.get("summary"),
                        "excerpt": event.data.get("excerpt"),
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


def _presented_product_ids(turn_results: list[dict]) -> list[str]:
    """product_ids the agent actually showed the customer as a pick or a comparison
    entry, across every turn: what a search_products call surfaces internally and what
    the agent recommends are different things (the model may search broadly, then
    narrow), so grading recommendations against raw search hits would punish a model
    for a wider internal search it correctly filtered before presenting."""
    ids: list[str] = []
    for turn in turn_results:
        for call in turn["tool_calls"]:
            if call["tool"] == "present_products":
                ids += [p["product_id"] for p in call["input"].get("picks", [])]
            elif call["tool"] == "present_comparison":
                ids += [e["product_id"] for e in call["input"].get("entries", [])]
    return ids


def _combined_content(turn_results: list[dict]) -> str:
    """Every turn's reply text plus every tool call's input, concatenated: the
    substantive content of a shopping-agent answer often lives in a presentation tool's
    input (present_comparison, present_order_status), not in text_delta alone."""
    parts = []
    for turn in turn_results:
        parts.append(turn["text"])
        for call in turn["tool_calls"]:
            parts.append(json.dumps(call["input"]))
    return " ".join(parts)


def grade_scenario(scenario: dict, turn_results: list[dict], backend, search_log_before: int, db_conn: sqlite3.Connection, session_id: str) -> dict:
    sid = scenario["id"]
    expected = scenario["checks"]["expected"]
    content = _combined_content(turn_results)
    new_searches = backend.search_log[search_log_before:]

    if sid == 1:
        allowed = set(expected["under_80_active_product_ids"])
        if not new_searches:
            return {"passed": False, "reason": "search_products was never called"}
        presented = _presented_product_ids(turn_results)
        if not presented:
            return {"passed": False, "reason": "no products were presented to the customer"}
        offenders = [pid for pid in presented if pid not in allowed]
        if offenders:
            return {"passed": False, "reason": f"presented product(s) over $80: {offenders}"}
        return {
            "passed": True,
            "reason": f"every presented product_id ({presented}) is in the SQL-checked under-$80 set; "
            "a wider internal search_products call is fine as long as what got presented respects the ceiling",
        }

    if sid == 2:
        price_a = str(expected["prod_a"]["price"])
        price_b = str(expected["prod_b"]["price"])
        has_a, has_b = price_a in content, price_b in content
        if has_a and has_b:
            return {
                "passed": True,
                "reason": f"both products' real prices ({price_a}, {price_b}) appear in the answer",
            }
        missing = [p for p, ok in ((price_a, has_a), (price_b, has_b)) if not ok]
        return {"passed": False, "reason": f"price(s) missing from the answer: {missing}"}

    if sid == 3:
        rows = db_conn.execute(
            "SELECT product_id, title, price, quantity FROM lab_cart_items WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()
        actual = [dict(r) for r in rows]
        expected_items = expected["final_cart_items"]
        if actual == expected_items:
            return {"passed": True, "reason": f"lab_cart_items matches expected state exactly: {actual}"}
        return {"passed": False, "reason": f"lab_cart_items is {actual}, expected {expected_items}"}

    if sid == 4:
        checks = [
            expected["order_id"] in content,
            str(expected["total_amount"]) in content,
        ]
        if all(checks):
            return {"passed": True, "reason": "order id and total both appear in the answer"}
        return {"passed": False, "reason": "order id or total missing from the answer"}

    if sid == 5:
        if re.search(r"\b30\b", content):
            return {"passed": True, "reason": "the 30-day return window appears in the answer"}
        return {"passed": False, "reason": "no '30' (days) found in the answer"}

    if sid == 6:
        if not new_searches:
            return {"passed": False, "reason": "search_products was never called"}
        zero_hit = any(not s["returned_ids"] for s in new_searches)
        no_fabrication = not _presented_product_ids(turn_results)
        if zero_hit and no_fabrication:
            return {"passed": True, "reason": "search returned 0 results and no product_id was fabricated in the answer"}
        return {
            "passed": False,
            "reason": f"zero_hit={zero_hit} no_fabrication={no_fabrication} searches={new_searches}",
        }

    return {"passed": False, "reason": "no grader for this scenario id"}


async def run_phase_b(model: str, client: AsyncAnthropic, scenarios: list[dict], session_cfg: dict) -> dict:
    config = ShoppingAgentConfig(
        brand_name="the demo store",
        assistant_name="the shopping assistant",
        model=model,
        thinking_effort=None,
        max_tool_iterations=6,
        enable_memory=False,
        enable_web_search=False,
    )
    backend = EcommerceStorefrontBackend(DB_PATH)
    agent = ShoppingAgent(backend=backend, skills_dir=SKILLS_DIR, config=config, client=client)

    session_id = f"{session_cfg['session_id']}-{model}"
    session = ShoppingSessionContext(session_id=session_id, user_id=session_cfg["user_id"])
    state = ShoppingSessionState()
    messages: list = []

    scenario_results = []
    for scenario in scenarios:
        search_log_before = len(backend.search_log)
        turn_results = []
        for prompt in scenario["turns"]:
            result = await _run_turn(agent, session, state, messages, prompt)
            turn_results.append(result)
            print(
                f"  [{model}] scenario {scenario['id']} turn: tools="
                f"{[c['tool'] for c in result['tool_calls']]} elapsed={result['elapsed_s']}s "
                f"error={result['error']}"
            )
        grade = grade_scenario(scenario, turn_results, backend, search_log_before, backend.conn, session_id)
        scenario_results.append(
            {
                "scenario_id": scenario["id"],
                "turns": turn_results,
                "passed": grade["passed"],
                "reason": grade["reason"],
            }
        )
        print(f"  [{model}] scenario {scenario['id']}: {'PASS' if grade['passed'] else 'FAIL'} ({grade['reason']})")

    backend.conn.close()
    return {"model": model, "scenarios": scenario_results}


async def main() -> None:
    if not os.environ.get("EXPLABS_API_KEY"):
        print("EXPLABS_API_KEY not set, stopping.")
        return

    models_cfg = json.loads((ROOT / "models.json").read_text())
    scenarios_cfg = json.loads((ROOT / "scenarios.json").read_text())
    models = models_cfg["try_all"]
    scenarios = scenarios_cfg["scenarios"]
    session_cfg = scenarios_cfg["session"]

    cost_sink: list[float] = []
    client = make_client(cost_sink)

    print("Phase 0: tool-use gate, one model at a time")
    phase0_results = await phase0(models, client)
    report: dict = {"phase0": phase0_results}

    if not any(r["tool_result_accepted"] for r in phase0_results):
        print("\nAll three models failed Phase 0. Stopping, no Phase B.")
        report["phase_b"] = []
        report["total_cost_usd"] = round(sum(cost_sink), 6)
        (ROOT / "report.json").write_text(json.dumps(report, indent=2, default=str))
        return

    before_hash = real_tables_checksum(DB_PATH)
    print(f"\nReal tables checksum before Phase B: {before_hash}")

    passed = {r["model"] for r in phase0_results if r["tool_result_accepted"]}
    order_to_run = [m for m in models if m in passed]
    dropped = [m for m in models if m not in passed]
    if dropped:
        print(f"Dropped from Phase B (failed Phase 0): {dropped}")

    phase_b_reports = []
    for model in order_to_run:
        if sum(cost_sink) >= COST_CEILING_USD:
            print(f"\nCost ceiling (${COST_CEILING_USD}) reached, skipping remaining models.")
            break
        print(f"\nPhase B: 6 scenarios (9 turns) against ecommerce_mirror.sqlite, model={model}")
        phase_b_reports.append(await run_phase_b(model, client, scenarios, session_cfg))

    after_hash = real_tables_checksum(DB_PATH)
    print(f"\nReal tables checksum after Phase B: {after_hash}")

    report["phase_b"] = phase_b_reports
    report["real_tables_unchanged"] = before_hash == after_hash
    report["real_tables_checksum_before"] = before_hash
    report["real_tables_checksum_after"] = after_hash
    report["total_cost_usd"] = round(sum(cost_sink), 6)
    report["total_api_calls_with_cost_recorded"] = len(cost_sink)

    (ROOT / "report.json").write_text(json.dumps(report, indent=2, default=str))
    print(f"\nWrote report.json. Total cost: ${report['total_cost_usd']} across {len(cost_sink)} calls. "
          f"Real tables unchanged: {report['real_tables_unchanged']}")


if __name__ == "__main__":
    asyncio.run(main())
