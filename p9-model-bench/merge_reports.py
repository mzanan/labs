"""Merges the per-model reports under runs/ into one dated report plus a markdown summary table."""

from __future__ import annotations

import argparse
import glob
import json
from pathlib import Path

ROOT = Path(__file__).parent


def summarize(date: str) -> dict:
    rows = []
    for path in sorted(glob.glob(str(ROOT / "runs" / f"report-{date}-*.json"))):
        data = json.loads(Path(path).read_text())
        key = Path(path).stem.replace(f"report-{date}-", "")
        gate = next((g for g in data["phase0"] if g["model_key"] == key), {})
        dec = [c for c in (data.get("decision") or {}).get("cells", []) if c.get("model_key") == key]
        tc = [c for c in data.get("tool_call", []) if c.get("model_key") == key]
        lat = sorted(c["latency_ms"] for c in dec if c.get("latency_ms"))
        by_scenario: dict[str, list[bool]] = {}
        for c in tc:
            by_scenario.setdefault(str(c["scenario_id"]), []).append(bool(c["passed"]))
        rows.append({
            "model": key,
            "gate": "PASS" if gate.get("passed") else f"BLOCKED: {str(gate.get('error'))[:80]}",
            "decision_cells": len(dec),
            "decision_kind_acc": round(sum(c["kind_correct"] for c in dec) / len(dec), 3) if dec else None,
            "decision_transfer_acc": round(sum(c["is_transfer_correct"] for c in dec) / len(dec), 3) if dec else None,
            "decision_mean_ms": round(sum(lat) / len(lat)) if lat else None,
            "tool_call_passed": sum(c["passed"] for c in tc),
            "tool_call_cells": len(tc),
            "tool_call_failed_scenarios": {s: v.count(False) for s, v in by_scenario.items() if False in v},
            "cost_usd": data.get("total_cost_usd"),
        })
    return {"date": date, "rows": rows, "total_cost_usd": round(sum(r["cost_usd"] or 0 for r in rows), 6)}


def to_markdown(summary: dict) -> str:
    head = "| Model | Gate | Decision kind acc | Decision transfer acc | Decision mean ms | Tool call | Failed scenarios (fails/3) | Cost USD |\n|---|---|---|---|---|---|---|---|\n"
    lines = []
    for r in summary["rows"]:
        failed = ", ".join(f"s{s}: {n}" for s, n in sorted(r["tool_call_failed_scenarios"].items())) or "none"
        tc = f"{r['tool_call_passed']}/{r['tool_call_cells']}" if r["tool_call_cells"] else "not run"
        lines.append(f"| `{r['model']}` | {r['gate']} | {r['decision_kind_acc']} | {r['decision_transfer_acc']} | {r['decision_mean_ms']} | {tc} | {failed} | {r['cost_usd']} |")
    return head + "\n".join(lines) + f"\n\nTotal cost: USD {summary['total_cost_usd']}\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True)
    args = parser.parse_args()
    summary = summarize(args.date)
    (ROOT / f"report-{args.date}.json").write_text(json.dumps(summary, indent=2))
    print(to_markdown(summary))


if __name__ == "__main__":
    main()
