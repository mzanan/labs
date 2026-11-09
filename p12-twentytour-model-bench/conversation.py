from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from langdetect import detect

from openrouter import Call, OpenRouter
from world import AGENT_RULES, TOOLS, World

SCENARIOS = json.loads((Path(__file__).parent / "fixtures" / "conversations.json").read_text())
MAX_TURNS = 6
MAX_TOOL_STEPS = 6
END = "[END]"
PRICE = re.compile(r"(€\s?\d|\d\s?€|\bEUR\s?\d|\d+\s?(euros?|eur)\b|\bkr\s?\d)", re.IGNORECASE)
CUSTOMER_MODEL = {"id": "deepseek/deepseek-v4.1-flash"}


def _customer_system(scenario: dict[str, Any]) -> str:
    return (
        f"{scenario['persona']} You are chatting on WhatsApp with TwentyTour's assistant. Your goal: {scenario['goal']}. "
        f"Write one short message per turn in the language '{scenario['language']}', like a real customer. "
        f"When your goal is reached, or the assistant clearly cannot help, write your last message and end it with {END}."
    )


async def _customer_turn(client: OpenRouter, scenario: dict[str, Any], transcript: list[dict[str, str]]) -> Call:
    messages = [{"role": "system", "content": _customer_system(scenario)}]
    messages += [{"role": "assistant" if m["role"] == "customer" else "user", "content": m["text"]} for m in transcript]
    return await client.chat(CUSTOMER_MODEL["id"], messages, max_tokens=2000)


async def _agent_turn(client: OpenRouter, model: dict[str, Any], world: World, messages: list[dict[str, Any]]) -> tuple[str, list[Call]]:
    calls: list[Call] = []
    for _ in range(MAX_TOOL_STEPS):
        call = await client.chat(
            model["id"], messages, tools=TOOLS, max_tokens=4000, temperature=model.get("temperature", 0),
        )
        calls.append(call)
        if not call.ok:
            return "", calls
        if not call.tool_calls:
            messages.append({"role": "assistant", "content": call.text})
            return call.text, calls
        messages.append({"role": "assistant", "content": call.text or None, "tool_calls": call.tool_calls})
        for tool_call in call.tool_calls:
            try:
                args = json.loads(tool_call["function"]["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            result = world.call(tool_call["function"]["name"], args)
            messages.append({"role": "tool", "tool_call_id": tool_call["id"], "content": json.dumps(result, ensure_ascii=False)})
    return "", calls


def _matches(actual: dict[str, Any], expected: dict[str, Any]) -> bool:
    for key, want in expected.items():
        got = actual.get(key)
        if isinstance(want, str) and isinstance(got, str):
            if key == "time":
                got = re.sub(r"^(\d):", r"0\1:", got)[:5]
            if got.strip().lower() != want.lower():
                return False
        elif got != want:
            return False
    return True


def _language(text: str) -> str | None:
    try:
        return detect(text)
    except Exception:
        return None


def grade(scenario: dict[str, Any], world: World, agent_texts: list[str]) -> dict[str, bool]:
    expect = scenario["expect"]
    joined = "\n".join(agent_texts)
    expected_requests = expect.get("private_requests", [])
    expected_escalations = expect.get("escalations", [])
    allowed_reasons = set(expect.get("allow_escalation_reasons", []))
    escalations = [e for e in world.escalations if e.get("reason") not in allowed_reasons]
    checks = {
        "private_requests": len(world.private_requests) == len(expected_requests)
        and all(any(_matches(r, want) for r in world.private_requests) for want in expected_requests),
        "escalations": len(escalations) == len(expected_escalations)
        and all(any(_matches(e, want) for e in escalations) for want in expected_escalations),
        "confirmations": world.confirmations_sent == expect.get("confirmations", []),
        "no_price": not PRICE.search(joined),
        "mentions": all(any(word.lower() in joined.lower() for word in group) for group in expect.get("must_mention", [])),
        "no_forbidden": not any(re.search(p, joined, re.IGNORECASE) for p in expect.get("must_not_match", [])),
        "language": bool(agent_texts) and all(_language(t) == scenario["language"] for t in agent_texts if len(t) > 40),
    }
    return checks


async def run_scenario(client: OpenRouter, model: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    world = World()
    messages: list[dict[str, Any]] = [{"role": "system", "content": AGENT_RULES}]
    transcript: list[dict[str, str]] = []
    agent_texts: list[str] = []
    cost = 0.0
    latency = 0.0
    errors: list[str] = []
    customer_text = scenario["opening"]
    for _ in range(MAX_TURNS):
        transcript.append({"role": "customer", "text": customer_text})
        messages.append({"role": "user", "content": customer_text})
        reply, calls = await _agent_turn(client, model, world, messages)
        cost += sum(c.cost_usd for c in calls)
        latency += sum(c.latency_ms for c in calls)
        errors += [c.error for c in calls if c.error]
        if not reply:
            errors.append("agent produced no reply")
            break
        agent_texts.append(reply)
        transcript.append({"role": "agent", "text": reply})
        if END in customer_text:
            break
        customer = await _customer_turn(client, scenario, transcript)
        if not customer.ok or not customer.text.strip():
            errors.append(f"customer simulator: {customer.error or 'empty'}")
            break
        customer_text = customer.text.strip()
        if END in customer_text and customer_text.replace(END, "").strip() == "":
            break
    checks = grade(scenario, world, agent_texts)
    return {
        "scenario": scenario["id"],
        "ok": not errors,
        "errors": errors,
        "checks": checks,
        "all_ok": not errors and all(checks.values()),
        "agent_cost_usd": round(cost, 6),
        "agent_latency_ms": round(latency),
        "turns": len(agent_texts),
        "tool_log": world.tool_log,
        "transcript": transcript,
    }
