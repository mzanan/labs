"""Track 4 grader: exact match on amount+currency, date match, merchant substring. Not exercised
in phase 1 (no fixtures); kept ready for when Matias supplies images."""

from __future__ import annotations

from typing import Any


def grade(expected: dict[str, Any], answer: dict[str, Any]) -> dict[str, Any]:
    amount_ok = answer.get("amount") == expected["amount"] and answer.get("currency") == expected["currency"]
    date_ok = answer.get("date") == expected["date"]
    merchant_ok = expected["merchant"].lower() in (answer.get("merchant") or "").lower()
    passed = amount_ok and date_ok and merchant_ok
    return {"passed": passed, "amount_ok": amount_ok, "date_ok": date_ok, "merchant_ok": merchant_ok}
