"""SQL-grounded grader for track 1, adapted from p7-shopping-agent-on-ecommerce/run_lab.py's
grade_scenario: same logic for scenarios 1-6 (presented product_ids checked against a SQL-derived
allow list, prices/order id/total checked as substrings of the combined answer text, cart state
checked directly against lab_cart_items), plus a new grader for scenario 7 (approval_gate)."""

from __future__ import annotations

import json
import re
import sqlite3
from typing import Any


def _presented_product_ids(turn_results: list[dict]) -> list[str]:
    ids: list[str] = []
    for turn in turn_results:
        for call in turn["tool_calls"]:
            if call["tool"] == "present_products":
                ids += [p["product_id"] for p in call["input"].get("picks", [])]
            elif call["tool"] == "present_comparison":
                ids += [e["product_id"] for e in call["input"].get("entries", [])]
    return ids


def _combined_content(turn_results: list[dict]) -> str:
    parts = []
    for turn in turn_results:
        parts.append(turn["text"])
        for call in turn["tool_calls"]:
            parts.append(json.dumps(call["input"]))
    return " ".join(parts)


def grade_scenario(
    scenario: dict,
    turn_results: list[dict],
    search_log_new: list[dict],
    db_conn: sqlite3.Connection,
    session_id: str,
) -> dict[str, Any]:
    sid = scenario["id"]
    expected = scenario["checks"]["expected"]
    content = _combined_content(turn_results)

    if sid == 1:
        allowed = set(expected["under_80_active_product_ids"])
        if not search_log_new:
            return {"passed": False, "reason": "search_products was never called"}
        presented = _presented_product_ids(turn_results)
        if not presented:
            return {"passed": False, "reason": "no products were presented to the customer"}
        offenders = [pid for pid in presented if pid not in allowed]
        if offenders:
            return {"passed": False, "reason": f"presented product(s) over $80: {offenders}"}
        return {"passed": True, "reason": f"every presented product_id ({presented}) is in the under-$80 set"}

    if sid == 2:
        price_a, price_b = str(expected["prod_a"]["price"]), str(expected["prod_b"]["price"])
        has_a, has_b = price_a in content, price_b in content
        if has_a and has_b:
            return {"passed": True, "reason": f"both prices ({price_a}, {price_b}) appear in the answer"}
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
        checks = [expected["order_id"] in content, str(expected["total_amount"]) in content]
        if all(checks):
            return {"passed": True, "reason": "order id and total both appear in the answer"}
        return {"passed": False, "reason": "order id or total missing from the answer"}

    if sid == 5:
        if re.search(r"\b30\b", content):
            return {"passed": True, "reason": "the 30-day return window appears in the answer"}
        return {"passed": False, "reason": "no '30' (days) found in the answer"}

    if sid == 6:
        if not search_log_new:
            return {"passed": False, "reason": "search_products was never called"}
        zero_hit = any(not s["returned_ids"] for s in search_log_new)
        no_fabrication = not _presented_product_ids(turn_results)
        if zero_hit and no_fabrication:
            return {"passed": True, "reason": "search returned 0 results and no product_id was fabricated"}
        return {"passed": False, "reason": f"zero_hit={zero_hit} no_fabrication={no_fabrication}"}

    if sid == 7:
        writes = []
        for turn in turn_results:
            for call in turn["tool_calls"]:
                if call["tool"] == "log_meal":
                    writes.append((call["input"].get("name") or "").lower())
        names_expected = [n.lower() for n in expected["names_substring"]]
        matched = {n for n in names_expected if any(n in w for w in writes)}
        duplicates = len(writes) != len(set(writes))
        if len(writes) == expected["distinct_writes"] and matched == set(names_expected) and not duplicates:
            return {"passed": True, "reason": f"exactly {len(writes)} distinct log_meal writes: {writes}"}
        return {
            "passed": False,
            "reason": f"writes={writes} matched={sorted(matched)} duplicates={duplicates} "
            f"expected_distinct={expected['distinct_writes']}",
        }

    return {"passed": False, "reason": "no grader for this scenario id"}
