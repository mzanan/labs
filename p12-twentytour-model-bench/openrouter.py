from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

BASE_URL = os.environ.get("LLM_BASE_URL", "https://openrouter.ai/api/v1") + "/chat/completions"
RETRYABLE_STATUS = {402, 429, 500, 502, 503, 504}


@dataclass
class Call:
    ok: bool
    text: str = ""
    tool_input: dict[str, Any] | None = None
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    provider: str | None = None
    finish_reason: str | None = None
    cost_usd: float = 0.0
    latency_ms: float = 0.0
    error: str | None = None
    usage: dict[str, Any] = field(default_factory=dict)


class OpenRouter:
    def __init__(self, provider_prefs: dict[str, Any], hard_timeout_s: float = 120.0, retries: int = 3) -> None:
        key = os.environ.get("LLM_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
        if not key:
            raise SystemExit("LLM_API_KEY or OPENROUTER_API_KEY is not set")
        self.client = httpx.AsyncClient(headers={"Authorization": f"Bearer {key}"}, timeout=hard_timeout_s)
        self.provider_prefs = provider_prefs
        self.hard_timeout_s = hard_timeout_s
        self.retries = retries

    async def close(self) -> None:
        await self.client.aclose()

    async def chat(
        self,
        model_id: str,
        messages: list[dict[str, Any]],
        tool: dict[str, Any] | None = None,
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 1024,
        temperature: float | None = 0,
        force_tool: bool = True,
    ) -> Call:
        body: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "max_tokens": max_tokens,
        }
        if "openrouter.ai" in BASE_URL:
            body["usage"] = {"include": True}
        if self.provider_prefs:
            body["provider"] = self.provider_prefs
        if temperature is not None:
            body["temperature"] = temperature
        if tools:
            body["tools"] = [{"type": "function", "function": t} for t in tools]
        if tool:
            body["tools"] = [{"type": "function", "function": tool}]
            if force_tool:
                body["tool_choice"] = {"type": "function", "function": {"name": tool["name"]}}
        started = time.monotonic()
        last_error = "no attempt"
        for attempt in range(self.retries):
            try:
                response = await asyncio.wait_for(self.client.post(BASE_URL, json=body), timeout=self.hard_timeout_s)
            except (httpx.HTTPError, asyncio.TimeoutError) as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                await asyncio.sleep(5 * (attempt + 1))
                continue
            if response.status_code in RETRYABLE_STATUS:
                last_error = f"HTTP {response.status_code}: {response.text[:300]}"
                await asyncio.sleep(5 * (attempt + 1))
                continue
            latency_ms = round((time.monotonic() - started) * 1000, 1)
            data = response.json()
            if response.status_code != 200 or "choices" not in data:
                return Call(False, error=f"HTTP {response.status_code}: {json.dumps(data)[:500]}", latency_ms=latency_ms)
            return self._parse(data, latency_ms)
        return Call(False, error=last_error, latency_ms=round((time.monotonic() - started) * 1000, 1))

    @staticmethod
    def _parse(data: dict[str, Any], latency_ms: float) -> Call:
        message = data["choices"][0].get("message") or {}
        usage = data.get("usage") or {}
        tool_calls = [
            {"id": c.get("id"), "type": "function", "function": {"name": c["function"]["name"], "arguments": c["function"].get("arguments") or "{}"}}
            for c in message.get("tool_calls") or []
            if c.get("function", {}).get("name")
        ]
        tool_input = None
        for call in message.get("tool_calls") or []:
            try:
                tool_input = json.loads(call["function"]["arguments"])
            except (json.JSONDecodeError, TypeError, KeyError):
                tool_input = None
            break
        return Call(
            True,
            text=message.get("content") or "",
            tool_input=tool_input,
            tool_calls=tool_calls,
            provider=data.get("provider"),
            finish_reason=data["choices"][0].get("finish_reason"),
            cost_usd=float(usage.get("cost") or 0.0),
            latency_ms=latency_ms,
            usage=usage,
        )
