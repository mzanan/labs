"""Track 4 (vision) runner. Capability check only: sends each fixture image as base64 in the
provider-appropriate content block to the vision-capable models (qwen3.8-27b, mimo-2.6-flash,
deepseek-4.1-flash) and grades amount/currency/date/merchant extraction. Returns NOT RUN with the
raw reason when fixtures/vision/ is empty, which it is in phase 1: Matias has not supplied the 3
images yet."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

from providers import Providers
from tracks.vision.grader import grade

ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = ROOT / "fixtures" / "vision"

VISION_TOOL_ANTHROPIC = {
    "name": "answer_receipt",
    "description": "Extracted receipt fields.",
    "input_schema": {
        "type": "object",
        "properties": {
            "amount": {"type": "number"},
            "currency": {"type": "string"},
            "date": {"type": "string"},
            "merchant": {"type": "string"},
        },
        "required": ["amount", "currency", "date", "merchant"],
        "additionalProperties": False,
    },
}
VISION_TOOL_OPENAI = {
    "type": "function",
    "function": {"name": "answer_receipt", "description": "Extracted receipt fields.",
                 "parameters": VISION_TOOL_ANTHROPIC["input_schema"]},
}


def fixtures_available(images_cfg: list[dict]) -> tuple[bool, str]:
    if not FIXTURES_DIR.exists() or not any(FIXTURES_DIR.iterdir()):
        return False, f"fixtures/vision/ is empty, no images supplied (looked in {FIXTURES_DIR})"
    missing = [img["file"] for img in images_cfg if not (FIXTURES_DIR / img["file"]).exists()]
    if missing:
        return False, f"missing fixture files: {missing}"
    return True, ""


def _media_type(path: Path) -> str:
    return "image/png" if path.suffix.lower() == ".png" else "image/jpeg"


async def run(providers: Providers, model_cfg: dict, images_cfg: list[dict], reps: int) -> dict[str, Any]:
    available, reason = fixtures_available(images_cfg)
    if not available:
        return {"model_key": model_cfg["key"], "status": "NOT RUN", "reason": reason, "cells": []}

    cells = []
    for img in images_cfg:
        path = FIXTURES_DIR / img["file"]
        b64 = base64.b64encode(path.read_bytes()).decode()
        for rep in range(1, reps + 1):
            if model_cfg["provider"] == "explabs":
                result = await providers.explabs_messages(
                    model_cfg["key"], model_cfg["id"],
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "image", "source": {"type": "base64", "media_type": _media_type(path), "data": b64}},
                            {"type": "text", "text": "Extract amount, currency, date, merchant from this receipt."},
                        ],
                    }],
                    tools=[VISION_TOOL_ANTHROPIC], tool_choice={"type": "tool", "name": "answer_receipt"},
                    max_tokens=512,
                )
                answer = None
                if result.ok:
                    tu = next((b for b in result.content if b["type"] == "tool_use"), None)
                    answer = tu["input"] if tu else None
            else:
                result = await providers.openrouter_chat(
                    model_cfg["key"], model_cfg["id"],
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Extract amount, currency, date, merchant from this receipt."},
                            {"type": "image_url", "image_url": {"url": f"data:{_media_type(path)};base64,{b64}"}},
                        ],
                    }],
                    tools=[VISION_TOOL_OPENAI], max_tokens=512,
                )
                answer = None
                if result.ok:
                    tu = next((b for b in result.content if b["type"] == "tool_use"), None)
                    answer = tu["input"] if tu else None
            grade_result = grade(img["expected"], answer) if answer else {"passed": False}
            cells.append({
                "image_id": img["id"], "rep": rep, "ok": result.ok, "answer": answer,
                "error": result.error, "cost_usd": result.cost_usd, "latency_ms": result.latency_ms,
                **grade_result,
            })
    return {"model_key": model_cfg["key"], "status": "RUN", "cells": cells}
