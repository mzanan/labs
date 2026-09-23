"""Track 3 (decision) runner. Jev answers through /v1/systemone in three variants: choice (a
'choice' question for kind plus a 'noul' for is_transfer, the default), score (choice for kind plus an
ordinal 'score' over three criteria for is_transfer, threshold 1.0) and noul (four 'noul' questions,
argmax for kind). All three question types were verified live on 2026-09-22. Every other LLM answers through a forced tool call
(answer_decision) so the JSON shape is enforced by the provider's own tool-calling machinery
instead of parsed out of free text, on both provider shapes. Laya has no runner (stub, NOT RUN)."""

from __future__ import annotations

import time
from typing import Any

from providers import CallResult, Providers

DECISION_TOOL_ANTHROPIC = {
    "name": "answer_decision",
    "description": "Classify the transaction.",
    "input_schema": {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": ["income", "expense", "transfer"]},
            "is_transfer": {"type": "boolean"},
        },
        "required": ["kind", "is_transfer"],
        "additionalProperties": False,
    },
}
DECISION_TOOL_OPENAI = {
    "type": "function",
    "function": {
        "name": "answer_decision",
        "description": "Classify the transaction.",
        "parameters": DECISION_TOOL_ANTHROPIC["input_schema"],
    },
}
DECISION_SYSTEM = (
    "You classify a personal-finance transaction line given the user's owned accounts. "
    "kind is exactly one of income, expense, transfer. is_transfer is true only when both "
    "sides of the movement are accounts the user owns (including cash withdrawals from an "
    "owned bank account and card-autopay from an owned checking account), even if one side is "
    "not shown on this line. A payment to another person, a fee, a refund or a salary deposit "
    "is never a transfer. Always answer by calling answer_decision."
)


async def _run_llm(providers: Providers, model_cfg: dict, scenario: dict) -> dict[str, Any]:
    prompt = scenario["state"]
    if model_cfg["provider"] == "explabs":
        result: CallResult = await providers.explabs_messages(
            model_cfg["key"], model_cfg["id"],
            messages=[{"role": "user", "content": prompt}],
            tools=[DECISION_TOOL_ANTHROPIC],
            tool_choice={"type": "tool", "name": "answer_decision"},
            system=DECISION_SYSTEM, max_tokens=512, temperature=0,
        )
        answer = None
        if result.ok:
            tool_use = next((b for b in result.content if b["type"] == "tool_use"), None)
            answer = tool_use["input"] if tool_use else None
    else:
        result = await providers.openrouter_chat(
            model_cfg["key"], model_cfg["id"],
            messages=[{"role": "system", "content": DECISION_SYSTEM}, {"role": "user", "content": prompt}],
            tools=[DECISION_TOOL_OPENAI], max_tokens=512, temperature=0,
        )
        answer = None
        if result.ok:
            tool_use = next((b for b in result.content if b["type"] == "tool_use"), None)
            answer = tool_use["input"] if tool_use else None
    return {
        "scenario_id": scenario["id"], "ok": result.ok, "answer": answer, "error": result.error,
        "cost_usd": result.cost_usd, "latency_ms": result.latency_ms,
    }


_KIND_OPTIONS = ("income", "expense", "transfer")

_TRANSFER_RULE = (
    "A transfer moves money between two accounts the user owns, including a cash withdrawal "
    "from an owned bank account or a card autopay from an owned checking account. A payment to "
    "another person, a fee, a refund or a salary deposit is never a transfer."
)

_KIND_CRITERIA = {
    "income": "money received from a third party",
    "expense": "money paid to a third party or a fee",
    "transfer": "movement between two accounts the user owns",
}

_SCORE_CRITERIA = [
    "certainly not a transfer between the user's own accounts",
    "unsure",
    "certainly a transfer between the user's own accounts",
]


def _kind_question(label: str) -> dict[str, Any]:
    return {
        "type": "noul",
        "instructions": f"0 to 1 probability that this transaction's kind is '{label}'. {_TRANSFER_RULE}",
    }


def _questions_for(variant: str) -> dict[str, Any]:
    if variant == "noul":
        return {
            "is_income": _kind_question("income"),
            "is_expense": _kind_question("expense"),
            "is_transfer_kind": _kind_question("transfer"),
            "is_transfer": {"type": "noul", "instructions": f"Probability this transaction is a transfer. {_TRANSFER_RULE}"},
        }
    kind_q = {"type": "choice", "instructions": f"Classify the transaction. {_TRANSFER_RULE}", "criteria": _KIND_CRITERIA}
    if variant == "score":
        return {
            "kind": kind_q,
            "transfer_score": {"type": "score", "instructions": f"Is this a transfer? {_TRANSFER_RULE}", "criteria": _SCORE_CRITERIA},
        }
    return {
        "kind": kind_q,
        "is_transfer": {"type": "noul", "instructions": f"Probability this transaction is a transfer. {_TRANSFER_RULE}"},
    }


def _num(raw: Any, field: str) -> float | None:
    val = raw.get(field) if isinstance(raw, dict) else raw
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _parse_jev(variant: str, answers: dict[str, Any]) -> dict[str, Any] | None:
    if variant == "noul":
        scores = {k: _num(answers.get(q), "noul") for k, q in (("income", "is_income"), ("expense", "is_expense"), ("transfer", "is_transfer_kind"))}
        p = _num(answers.get("is_transfer"), "noul")
        if any(v is None for v in scores.values()) or p is None:
            return None
        return {"kind": max(scores, key=lambda k: scores[k]), "is_transfer": p >= 0.5, "raw_scores": scores, "is_transfer_p": p}
    kind_raw = answers.get("kind") or {}
    kind = kind_raw.get("choice") if isinstance(kind_raw, dict) else None
    if kind not in _KIND_OPTIONS:
        return None
    if variant == "score":
        score = _num(answers.get("transfer_score"), "score")
        if score is None:
            return None
        return {"kind": kind, "is_transfer": score >= 1.0, "transfer_score": score, "kind_probabilities": kind_raw.get("probabilities")}
    p = _num(answers.get("is_transfer"), "noul")
    if p is None:
        return None
    return {"kind": kind, "is_transfer": p >= 0.5, "is_transfer_p": p, "kind_probabilities": kind_raw.get("probabilities")}


async def _run_jev(providers: Providers, model_cfg: dict, scenario: dict) -> dict[str, Any]:
    variant = model_cfg.get("systemone_variant", "choice")
    started = time.monotonic()
    result: CallResult = await providers.explabs_systemone(
        model_cfg["key"], model_cfg["id"], state=scenario["state"], questions=_questions_for(variant),
    )
    latency_ms = round((time.monotonic() - started) * 1000, 1)
    answer = None
    if result.ok and result.raw_answer:
        answer = _parse_jev(variant, result.raw_answer.get("answers") or {})
    return {
        "scenario_id": scenario["id"], "ok": result.ok and answer is not None,
        "answer": answer, "error": result.error or (None if answer else f"unparseable answers: {result.raw_answer}"),
        "cost_usd": result.cost_usd, "latency_ms": result.latency_ms or latency_ms,
    }


async def run(providers: Providers, model_cfg: dict, scenarios: list[dict], reps: int) -> list[dict]:
    reps = model_cfg.get("reps_override", reps)
    cell_results = []
    for scenario in scenarios:
        for rep in range(1, reps + 1):
            if model_cfg.get("kind") == "systemone":
                cell = await _run_jev(providers, model_cfg, scenario)
            else:
                cell = await _run_llm(providers, model_cfg, scenario)
            cell["model_key"] = model_cfg.get("report_key", model_cfg["key"])
            cell["rep"] = rep
            cell["gold"] = scenario["gold"]
            if cell["ok"] and cell["answer"]:
                cell["kind_correct"] = cell["answer"].get("kind") == scenario["gold"]["kind"]
                cell["is_transfer_correct"] = bool(cell["answer"].get("is_transfer")) == scenario["gold"]["is_transfer"]
            else:
                cell["kind_correct"] = False
                cell["is_transfer_correct"] = False
            cell_results.append(cell)
    return cell_results
