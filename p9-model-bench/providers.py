"""Two provider backends behind one interface: explabs (Anthropic-compatible /v1/messages and
/v1/systemone) and openrouter (OpenAI-compatible chat completions with tools). Every call has a
timeout, retries with backoff on 429/5xx, and returns a CallResult recording model id, provider,
latency ms, input/output tokens, cost, and the raw error on failure, so a call never fails
silently.

explabs's gateway does not preserve usage.cost through the anthropic SDK's own response
accumulation (confirmed in p7-shopping-agent-on-ecommerce/run_lab.py's module docstring), so this
module tees the raw response bytes past a custom transport and recovers usage.cost with a regex
scan, exactly as p7 does. openrouter returns cost directly on response.usage when the request
body sets usage.include=true.

The anthropic SDK pinned here (1.7.0) moved off the httpx package onto its own httpx2 fork, so
the tee transport below is built on httpx2, not httpx; the openai SDK (openrouter) still uses
plain httpx, so both imports are kept. That same SDK version's messages.create() has no
top-level temperature parameter any more (confirmed via inspect.signature), so
explabs_messages() accepts and ignores it; only openrouter_chat() actually sends temperature.
/v1/systemone needs Authorization: Bearer <key>, not X-Api-Key (the default the SDK sends on
/v1/messages), confirmed by probing both header shapes live.
"""

from __future__ import annotations

import asyncio
import gzip
import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
import httpx2
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

EXPLABS_BASE_URL = "https://api.experientiallabs.ai"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
COST_RE = re.compile(rb'"cost"\s*:\s*(-?[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)')
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


@dataclass
class CallResult:
    ok: bool
    model_key: str
    provider: str
    model_id: str
    content: list[dict[str, Any]] = field(default_factory=list)
    stop_reason: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: float = 0.0
    error: str | None = None
    raw_answer: dict[str, Any] | None = None


class _TeeStream(httpx2.AsyncByteStream):
    def __init__(self, wrapped: httpx2.AsyncByteStream, sink: list[float]) -> None:
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


class _CostTransport(httpx2.AsyncBaseTransport):
    def __init__(self, wrapped: httpx2.AsyncBaseTransport, sink: list[float]) -> None:
        self._wrapped = wrapped
        self._sink = sink

    async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
        response = await self._wrapped.handle_async_request(request)
        response.stream = _TeeStream(response.stream, self._sink)
        return response

    async def aclose(self) -> None:
        await self._wrapped.aclose()


class CostTracker:
    def __init__(self, ceiling_usd: float) -> None:
        self.ceiling_usd = ceiling_usd
        self.total = 0.0
        self.calls = 0

    def add(self, amount: float) -> None:
        self.total += amount
        self.calls += 1

    def over_ceiling(self) -> bool:
        return self.total >= self.ceiling_usd


class Providers:
    def __init__(
        self, timeout_s: float = 60.0, retry_max: int = 3, backoff_s: list[float] | None = None,
        hard_timeout_s: float = 180.0,
    ) -> None:
        self.timeout_s = timeout_s
        self.hard_timeout_s = hard_timeout_s
        self.retry_max = retry_max
        self.backoff_s = backoff_s or [5, 15, 45]
        self._explabs_cost_sink: list[float] = []
        explabs_key = os.environ.get("EXPLABS_API_KEY")
        if explabs_key:
            http_client = httpx2.AsyncClient(
                transport=_CostTransport(httpx2.AsyncHTTPTransport(), self._explabs_cost_sink),
                base_url=EXPLABS_BASE_URL,
                timeout=timeout_s,
            )
            self.explabs = AsyncAnthropic(api_key=explabs_key, base_url=EXPLABS_BASE_URL, http_client=http_client, max_retries=0)
        else:
            self.explabs = None
        openrouter_key = os.environ.get("OPENROUTER_API_KEY")
        self.openrouter = (
            AsyncOpenAI(api_key=openrouter_key, base_url=OPENROUTER_BASE_URL, timeout=timeout_s, max_retries=0)
            if openrouter_key
            else None
        )

    async def _with_retry(self, fn, label: str) -> Any:
        last_exc: Exception | None = None
        for attempt in range(self.retry_max):
            try:
                return await asyncio.wait_for(fn(), timeout=self.hard_timeout_s)
            except Exception as exc:  # noqa: BLE001
                status = getattr(exc, "status_code", None)
                retryable = status in RETRYABLE_STATUS or status is None
                last_exc = exc
                if not retryable or attempt == self.retry_max - 1:
                    raise
                delay = self.backoff_s[min(attempt, len(self.backoff_s) - 1)]
                await asyncio.sleep(delay)
        raise last_exc  # pragma: no cover

    async def explabs_messages(
        self,
        model_key: str,
        model_id: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        tool_choice: dict[str, Any] | None = None,
        system: str | None = None,
        max_tokens: int = 1024,
        temperature: float | None = None,
    ) -> CallResult:
        if self.explabs is None:
            return CallResult(False, model_key, "explabs", model_id, error="EXPLABS_API_KEY not set")
        started = time.monotonic()
        before = len(self._explabs_cost_sink)
        kwargs: dict[str, Any] = {"model": model_id, "max_tokens": max_tokens, "messages": messages}
        if system:
            kwargs["system"] = system
        if tools:
            kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice
        try:
            resp = await self._with_retry(lambda: self.explabs.messages.create(**kwargs), model_key)
        except Exception as exc:  # noqa: BLE001
            return CallResult(
                False, model_key, "explabs", model_id,
                error=f"{type(exc).__name__}: {exc}",
                latency_ms=round((time.monotonic() - started) * 1000, 1),
            )
        latency_ms = round((time.monotonic() - started) * 1000, 1)
        content = [block.model_dump() for block in resp.content]
        new_costs = self._explabs_cost_sink[before:]
        cost = sum(new_costs) if new_costs else 0.0
        return CallResult(
            True, model_key, "explabs", model_id,
            content=content,
            stop_reason=resp.stop_reason,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
            cost_usd=cost,
            latency_ms=latency_ms,
            raw_answer=None,
        )

    async def explabs_systemone(
        self, model_key: str, model_id: str, state: str, questions: dict[str, Any]
    ) -> CallResult:
        if self.explabs is None:
            return CallResult(False, model_key, "explabs", model_id, error="EXPLABS_API_KEY not set")
        started = time.monotonic()
        before = len(self._explabs_cost_sink)
        payload = {"model": model_id, "state": state, "questions": questions}

        async def _call() -> httpx2.Response:
            response = await self.explabs._client.post(  # type: ignore[attr-defined]
                "/v1/systemone",
                json=payload,
                headers={
                    "Authorization": f"Bearer {os.environ['EXPLABS_API_KEY']}",
                    "content-type": "application/json",
                },
            )
            response.raise_for_status()
            return response

        try:
            resp = await self._with_retry(_call, model_key)
        except Exception as exc:  # noqa: BLE001
            return CallResult(
                False, model_key, "explabs", model_id,
                error=f"{type(exc).__name__}: {exc}",
                latency_ms=round((time.monotonic() - started) * 1000, 1),
            )
        latency_ms = round((time.monotonic() - started) * 1000, 1)
        data = resp.json()
        new_costs = self._explabs_cost_sink[before:]
        cost = sum(new_costs) if new_costs else float(((data.get("usage") or {}).get("cost")) or 0.0)
        return CallResult(
            True, model_key, "explabs", model_id,
            stop_reason="end_turn",
            cost_usd=cost,
            latency_ms=latency_ms,
            raw_answer=data,
        )

    async def openrouter_systemone(
        self, model_key: str, model_id: str, state: str, questions: dict[str, Any]
    ) -> CallResult:
        key = os.environ.get("OPENROUTER_API_KEY")
        if not key:
            return CallResult(False, model_key, "openrouter", model_id, error="OPENROUTER_API_KEY not set")
        started = time.monotonic()
        payload = {"model": model_id, "state": state, "questions": questions}

        async def _call() -> httpx2.Response:
            async with httpx2.AsyncClient(base_url=OPENROUTER_BASE_URL, timeout=self.timeout_s) as client:
                response = await client.post(
                    "/systemone",
                    json=payload,
                    headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
                )
                response.raise_for_status()
                return response

        try:
            resp = await self._with_retry(_call, model_key)
        except Exception as exc:  # noqa: BLE001
            return CallResult(
                False, model_key, "openrouter", model_id,
                error=f"{type(exc).__name__}: {exc}",
                latency_ms=round((time.monotonic() - started) * 1000, 1),
            )
        data = resp.json()
        return CallResult(
            True, model_key, "openrouter", model_id,
            stop_reason="end_turn",
            cost_usd=float(((data.get("usage") or {}).get("cost")) or 0.0),
            latency_ms=round((time.monotonic() - started) * 1000, 1),
            raw_answer=data,
        )

    async def laya_systemone(
        self, model_key: str, model_id: str, state: str, questions: dict[str, Any]
    ) -> CallResult:
        started = time.monotonic()
        try:
            if not hasattr(self, "_laya_agents"):
                self._laya_agents: dict[str, Any] = {}
            if model_id not in self._laya_agents:
                os.environ.setdefault("USE_TF", "0")
                import laya
                self._laya_agents[model_id] = await asyncio.to_thread(laya.load, model_id)
            agent = self._laya_agents[model_id]
            started = time.monotonic()
            data = await asyncio.to_thread(agent.predict, state, questions)
        except Exception as exc:  # noqa: BLE001
            return CallResult(
                False, model_key, "laya", model_id,
                error=f"{type(exc).__name__}: {exc}",
                latency_ms=round((time.monotonic() - started) * 1000, 1),
            )
        return CallResult(
            True, model_key, "laya", model_id,
            stop_reason="end_turn",
            cost_usd=0.0,
            latency_ms=round((time.monotonic() - started) * 1000, 1),
            raw_answer=data,
        )

    async def systemone(
        self, provider: str, model_key: str, model_id: str, state: str, questions: dict[str, Any]
    ) -> CallResult:
        if provider == "laya":
            return await self.laya_systemone(model_key, model_id, state, questions)
        if provider == "openrouter":
            return await self.openrouter_systemone(model_key, model_id, state, questions)
        return await self.explabs_systemone(model_key, model_id, state, questions)

    async def openrouter_chat(
        self,
        model_key: str,
        model_id: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 1024,
        temperature: float | None = None,
        response_format: dict[str, Any] | None = None,
    ) -> CallResult:
        if self.openrouter is None:
            return CallResult(False, model_key, "openrouter", model_id, error="OPENROUTER_API_KEY not set")
        started = time.monotonic()
        kwargs: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "max_tokens": max_tokens,
            "extra_body": {"usage": {"include": True}},
        }
        if tools:
            kwargs["tools"] = tools
        if temperature is not None:
            kwargs["temperature"] = temperature
        if response_format:
            kwargs["response_format"] = response_format
        try:
            resp = await self._with_retry(lambda: self.openrouter.chat.completions.create(**kwargs), model_key)
        except Exception as exc:  # noqa: BLE001
            return CallResult(
                False, model_key, "openrouter", model_id,
                error=f"{type(exc).__name__}: {exc}",
                latency_ms=round((time.monotonic() - started) * 1000, 1),
            )
        latency_ms = round((time.monotonic() - started) * 1000, 1)
        dumped = resp.model_dump()
        choice = dumped["choices"][0]
        msg = choice["message"]
        content: list[dict[str, Any]] = []
        if msg.get("content"):
            content.append({"type": "text", "text": msg["content"]})
        for call in msg.get("tool_calls") or []:
            try:
                args = json.loads(call["function"]["arguments"])
            except (json.JSONDecodeError, TypeError):
                args = {}
            content.append({"type": "tool_use", "id": call["id"], "name": call["function"]["name"], "input": args})
        usage = dumped.get("usage") or {}
        cost = float(usage.get("cost") or 0.0)
        return CallResult(
            True, model_key, "openrouter", model_id,
            content=content,
            stop_reason=choice.get("finish_reason"),
            input_tokens=usage.get("prompt_tokens", 0) or 0,
            output_tokens=usage.get("completion_tokens", 0) or 0,
            cost_usd=cost,
            latency_ms=latency_ms,
            raw_answer=dumped,
        )
