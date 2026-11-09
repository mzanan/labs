from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from langdetect import DetectorFactory, detect

from openrouter import Call, OpenRouter

DetectorFactory.seed = 0
FIXTURES = Path(__file__).parent / "fixtures"
CONTEXT = json.loads((FIXTURES / "context.json").read_text())
INTENTS = ["private_request", "change_request", "cancellation", "resend_confirmation", "question", "late_or_lost", "other"]
LANGUAGES = ["en", "de", "fr", "es", "nl", "no", "it", "pt", "other"]

CLASSIFY_TOOL = {
    "name": "classify_message",
    "description": "Classify one inbound customer message.",
    "parameters": {
        "type": "object",
        "properties": {
            "intent": {"type": "string", "enum": INTENTS},
            "language": {"type": "string", "enum": LANGUAGES},
        },
        "required": ["intent", "language"],
        "additionalProperties": False,
    },
}

EXTRACT_TOOL = {
    "name": "extract_private_request",
    "description": "Extract the fields of a private tour request. Use null for anything the customer did not state.",
    "parameters": {
        "type": "object",
        "properties": {
            "city": {"type": ["string", "null"]},
            "date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
            "time": {"type": ["string", "null"], "description": "HH:MM, 24 h; an approximate time such as around 11am counts; null when no time is given"},
            "pax": {"type": ["integer", "null"], "description": "number of people who walk the tour, babies excluded"},
            "language": {"type": ["string", "null"], "description": "tour language in English, e.g. German; the first choice if several"},
        },
        "required": ["city", "date", "time", "pax", "language"],
        "additionalProperties": False,
    },
}

CLASSIFY_SYSTEM = (
    f"{CONTEXT['company']} You triage inbound customer messages. Intents: private_request (asks for a new private or group tour or an offer), "
    "change_request (changes date, time or group size of an existing booking), cancellation (cancels a booking or asks for a refund), "
    "resend_confirmation (lost or missing booking confirmation), question (general question about tours), late_or_lost "
    "(customer is on the way, late or cannot find the group right now), other (spam, thanks, anything else). "
    "language is the language the customer wrote in. Always answer by calling classify_message."
)

EXTRACT_SYSTEM = (
    f"{CONTEXT['company']} Today is {CONTEXT['today']}. Extract the private tour request. Resolve relative dates against today. "
    "Always answer by calling extract_private_request."
)

DRAFT_SYSTEM = (
    f"{CONTEXT['company']} You draft a short reply to a customer message, for a human coordinator to approve. "
    "Reply in the customer's language. Use only these facts; never invent prices, availability or facts that are not listed. "
    "If the answer is not in the facts, say the team will check and get back. Facts:\n- " + "\n- ".join(CONTEXT["faq"])
)


def _cell(call: Call, **extra: Any) -> dict[str, Any]:
    return {"ok": call.ok, "error": call.error, "cost_usd": call.cost_usd, "latency_ms": call.latency_ms, "provider": call.provider, "finish_reason": call.finish_reason, "output_tokens": call.usage.get("completion_tokens"), **extra}


async def classify(client: OpenRouter, model: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    call = await client.chat(
        model["id"],
        [{"role": "system", "content": CLASSIFY_SYSTEM}, {"role": "user", "content": f"Channel: {scenario['channel']}\n\n{scenario['text']}"}],
        tool=CLASSIFY_TOOL,
        max_tokens=4000,
        temperature=model.get("temperature", 0),
        force_tool=model.get("force_tool", True),
    )
    answer = call.tool_input or {}
    gold = scenario["gold"]
    return _cell(call, answer=answer, intent_ok=answer.get("intent") == gold["intent"], language_ok=answer.get("language") == gold["language"])


def _normalize_time(value: Any) -> str | None:
    match = re.match(r"^(\d{1,2}):(\d{2})", str(value or ""))
    return f"{int(match.group(1)):02d}:{match.group(2)}" if match else None


def _same(field: str, got: Any, want: Any) -> bool:
    if isinstance(got, str) and got.strip().lower() in ("null", "none"):
        got = None
    if want is None:
        return got in (None, "")
    if field == "time":
        return _normalize_time(got) == want
    if field in ("city", "language"):
        return str(got or "").strip().lower() == str(want).lower()
    return got == want


async def extract(client: OpenRouter, model: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    call = await client.chat(
        model["id"],
        [{"role": "system", "content": EXTRACT_SYSTEM}, {"role": "user", "content": scenario["text"]}],
        tool=EXTRACT_TOOL,
        max_tokens=4000,
        temperature=model.get("temperature", 0),
        force_tool=model.get("force_tool", True),
    )
    answer = call.tool_input or {}
    fields = {name: _same(name, answer.get(name), want) for name, want in scenario["gold"].items()}
    return _cell(call, answer=answer, fields=fields, all_ok=call.ok and all(fields.values()))


def _language(text: str) -> str | None:
    try:
        return detect(text)
    except Exception:
        return None


async def draft(client: OpenRouter, model: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    call = await client.chat(
        model["id"],
        [{"role": "system", "content": DRAFT_SYSTEM}, {"role": "user", "content": scenario["text"]}],
        max_tokens=4000,
        temperature=model.get("temperature", 0),
        force_tool=model.get("force_tool", True),
    )
    text = call.text.strip()
    lowered = text.lower()
    language = _language(text) if text else None
    checks = {
        "language": language == scenario["language"],
        "facts": all(any(word.lower() in lowered for word in group) for group in scenario["must_include_any"]),
        "no_invention": not any(re.search(pattern, text, re.IGNORECASE) for pattern in scenario["must_not_match"]),
        "not_empty": bool(text),
    }
    return _cell(call, reply=text, detected_language=language, checks=checks, all_ok=call.ok and all(checks.values()))


TRACKS = {
    "classify": (classify, "classify.json"),
    "extract": (extract, "extract.json"),
    "draft": (draft, "draft.json"),
}


def load(track: str) -> list[dict[str, Any]]:
    return json.loads((FIXTURES / TRACKS[track][1]).read_text())
