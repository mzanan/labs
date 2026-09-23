"""Track 1 (tool_call) runner: one tool-calling loop implementation per provider shape (Anthropic
Messages for explabs, OpenAI chat completions for openrouter), both driving the same
EcommerceStorefrontBackend and the same log_meal approval-gate stub, so the 7 scenarios are graded
identically regardless of which API shape produced the transcript."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from providers import CallResult, Providers
from tracks.tool_call.grader import grade_scenario
from tracks.tool_call.tools import MEAL_LOG_TOOLS, SHOPPING_TOOLS, translate_to_openai

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "db" / "ecommerce_mirror.sqlite"
MAX_ITERATIONS = 6

SYSTEM_PROMPT = (
    "You are a shopping assistant for a demo store. Use the tools to look up real data; never "
    "invent product ids, prices, or order details, and never present a product you have not "
    "retrieved through a tool this conversation. Call present_products or present_comparison "
    "once you have specific products to show, with a clear recommendation. "
    "For log_meal, a write tool, call it once per distinct action named in the request; the "
    "action is approved automatically the first time, so never call it again for something "
    "already logged this conversation."
)


def _openai_tool_call_result(backend, session_id: str, user_id: str, name: str, args: dict[str, Any],
                              approved_writes: set[str]) -> dict[str, Any]:
    if name == "search_products":
        return {"results": backend.search_products(args.get("query", ""), args.get("filters"), args.get("limit", 8))}
    if name == "get_product_details":
        return backend.get_product_details(args["product_id"]) or {"error": "not found"}
    if name == "get_cart":
        return backend.get_cart(session_id)
    if name == "add_to_cart":
        return backend.add_to_cart(session_id, args["product_id"], args.get("quantity", 1))
    if name == "update_cart_item":
        return backend.update_cart_item(session_id, args["product_id"], args["quantity"])
    if name == "remove_from_cart":
        return backend.remove_from_cart(session_id, args["product_id"])
    if name == "get_order":
        return backend.get_order(user_id, args["order_id"]) or {"error": "not found"}
    if name == "search_policies":
        return {"results": backend.search_policies(args.get("query", ""))}
    if name in ("present_products", "present_comparison"):
        return {"ok": True}
    if name == "log_meal":
        meal_name = (args.get("name") or "").lower()
        if meal_name in approved_writes:
            return {"error": f"'{meal_name}' was already approved and logged this conversation, no action taken"}
        approved_writes.add(meal_name)
        return {"status": "approved", "logged": True, "name": args.get("name")}
    return {"error": f"unknown tool {name}"}


async def _run_turn_explabs(
    providers: Providers, model_key: str, model_id: str, backend, session_id: str, user_id: str,
    tools: list[dict], messages: list[dict], prompt: str, approved_writes: set[str],
) -> dict[str, Any]:
    messages.append({"role": "user", "content": prompt})
    tool_calls: list[dict] = []
    tool_results: list[dict] = []
    text = ""
    total_cost = 0.0
    total_latency = 0.0
    error = None

    for _ in range(MAX_ITERATIONS):
        result: CallResult = await providers.explabs_messages(
            model_key, model_id, messages, tools=tools, system=SYSTEM_PROMPT, max_tokens=1024, temperature=0.2,
        )
        total_cost += result.cost_usd
        total_latency += result.latency_ms
        if not result.ok:
            error = result.error
            break
        echoable = []
        for b in result.content:
            if b["type"] == "text":
                echoable.append({"type": "text", "text": b["text"]})
            elif b["type"] == "tool_use":
                echoable.append({"type": "tool_use", "id": b["id"], "name": b["name"], "input": b["input"]})
        messages.append({"role": "assistant", "content": echoable or [{"type": "text", "text": ""}]})
        tool_uses = [b for b in result.content if b["type"] == "tool_use"]
        for b in result.content:
            if b["type"] == "text":
                text += b["text"]
        if not tool_uses:
            break
        tool_result_blocks = []
        for tu in tool_uses:
            tool_calls.append({"tool": tu["name"], "input": tu["input"]})
            output = _openai_tool_call_result(backend, session_id, user_id, tu["name"], tu["input"], approved_writes)
            tool_results.append({"tool": tu["name"], "output": output})
            tool_result_blocks.append(
                {"type": "tool_result", "tool_use_id": tu["id"], "content": json.dumps(output, default=str)}
            )
        messages.append({"role": "user", "content": tool_result_blocks})

    return {
        "prompt": prompt, "tool_calls": tool_calls, "tool_results": tool_results, "text": text,
        "cost_usd": round(total_cost, 6), "latency_ms": round(total_latency, 1), "error": error,
    }


async def _run_turn_openrouter(
    providers: Providers, model_key: str, model_id: str, backend, session_id: str, user_id: str,
    tools: list[dict], messages: list[dict], prompt: str, approved_writes: set[str],
) -> dict[str, Any]:
    messages.append({"role": "user", "content": prompt})
    if not any(m.get("role") == "system" for m in messages):
        messages.insert(0, {"role": "system", "content": SYSTEM_PROMPT})
    tool_calls: list[dict] = []
    tool_results: list[dict] = []
    text = ""
    total_cost = 0.0
    total_latency = 0.0
    error = None

    for _ in range(MAX_ITERATIONS):
        result: CallResult = await providers.openrouter_chat(
            model_key, model_id, messages, tools=tools, max_tokens=1024, temperature=0.2,
        )
        total_cost += result.cost_usd
        total_latency += result.latency_ms
        if not result.ok:
            error = result.error
            break
        tool_uses = [b for b in result.content if b["type"] == "tool_use"]
        msg_text = "".join(b["text"] for b in result.content if b["type"] == "text")
        text += msg_text
        assistant_msg: dict[str, Any] = {"role": "assistant", "content": msg_text or None}
        if tool_uses:
            assistant_msg["tool_calls"] = [
                {"id": tu["id"], "type": "function",
                 "function": {"name": tu["name"], "arguments": json.dumps(tu["input"])}}
                for tu in tool_uses
            ]
        messages.append(assistant_msg)
        if not tool_uses:
            break
        for tu in tool_uses:
            tool_calls.append({"tool": tu["name"], "input": tu["input"]})
            output = _openai_tool_call_result(backend, session_id, user_id, tu["name"], tu["input"], approved_writes)
            tool_results.append({"tool": tu["name"], "output": output})
            messages.append({"role": "tool", "tool_call_id": tu["id"], "content": json.dumps(output, default=str)})

    return {
        "prompt": prompt, "tool_calls": tool_calls, "tool_results": tool_results, "text": text,
        "cost_usd": round(total_cost, 6), "latency_ms": round(total_latency, 1), "error": error,
    }


async def run(providers: Providers, model_cfg: dict, scenarios: list[dict], session_cfg: dict, reps: int) -> list[dict]:
    from adapter.ecommerce_storefront import EcommerceStorefrontBackend

    model_key, model_id, provider = model_cfg["key"], model_cfg["id"], model_cfg["provider"]
    cell_results = []

    for scenario in scenarios:
        tools = SHOPPING_TOOLS + (MEAL_LOG_TOOLS if scenario["kind"] == "approval_gate" else [])
        openai_tools = translate_to_openai(tools)
        for rep in range(1, reps + 1):
            backend = EcommerceStorefrontBackend(str(DB_PATH))
            session_id = f"{session_cfg['session_id']}-{model_key}-s{scenario['id']}-r{rep}"
            user_id = session_cfg["user_id"]
            messages: list[dict] = []
            turn_results = []
            search_log_before = len(backend.search_log)
            approved_writes: set[str] = set()

            for prompt in scenario["turns"]:
                if provider == "explabs":
                    turn = await _run_turn_explabs(
                        providers, model_key, model_id, backend, session_id, user_id,
                        tools, messages, prompt, approved_writes,
                    )
                else:
                    turn = await _run_turn_openrouter(
                        providers, model_key, model_id, backend, session_id, user_id,
                        openai_tools, messages, prompt, approved_writes,
                    )
                turn_results.append(turn)

            search_log_new = backend.search_log[search_log_before:]
            grade = grade_scenario(scenario, turn_results, search_log_new, backend.conn, session_id)
            backend.conn.close()

            cell_results.append({
                "model_key": model_key, "provider": provider, "scenario_id": scenario["id"],
                "rep": rep, "passed": grade["passed"], "reason": grade["reason"],
                "turns": turn_results,
                "cost_usd": round(sum(t["cost_usd"] for t in turn_results), 6),
                "latency_ms": round(sum(t["latency_ms"] for t in turn_results), 1),
                "error": next((t["error"] for t in turn_results if t["error"]), None),
            })
    return cell_results
