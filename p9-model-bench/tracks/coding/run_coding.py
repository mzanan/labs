"""Track 2 (coding fix). Each model gets a detached git worktree of the target repo and runs the
task in task.md as a headless Claude Code agent pointed at the model's gateway, with an isolated
config dir so no personal hooks or memory leak in. Grading is objective and happens after the agent
stops: the hidden test file is copied in, then tsc, eslint and vitest run, plus structural checks.

Run: python3 tracks/coding/run_coding.py --models deepseek-4.1-flash,glm-5.3 --date 2026-09-23"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
CONFIG = json.loads((HERE / "config.json").read_text())
PROVIDERS = {
    "explabs": {"base_url": "https://api.experientiallabs.ai", "key_env": "EXPLABS_API_KEY"},
    "openrouter": {"base_url": "https://openrouter.ai/api", "key_env": "OPENROUTER_API_KEY"},
}


def _sh(cmd: list[str], cwd: Path, timeout: int = 600, env: dict | None = None) -> dict:
    started = time.monotonic()
    try:
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)
        return {
            "ok": proc.returncode == 0,
            "code": proc.returncode,
            "out": (proc.stdout + proc.stderr)[-4000:],
            "seconds": round(time.monotonic() - started, 1),
        }
    except subprocess.TimeoutExpired as exc:
        return {"ok": False, "code": None, "out": f"timeout after {timeout}s: {str(exc)[-1500:]}", "seconds": timeout}


def _worktree(key: str) -> Path:
    base = Path(os.environ.get("CODING_WORKTREE_ROOT", "/tmp")) / f"wt-{key}"
    repo = Path(CONFIG["repo"])
    if base.exists():
        subprocess.run(["git", "worktree", "remove", "--force", str(base)], cwd=repo, capture_output=True)
        shutil.rmtree(base, ignore_errors=True)
    subprocess.run(["git", "worktree", "add", "-q", "--detach", str(base), CONFIG["base_ref"]], cwd=repo, check=True)
    (base / "node_modules").symlink_to(repo / "node_modules")
    return base


def _agent(model: dict, wt: Path) -> dict:
    provider = PROVIDERS[model["provider"]]
    config_dir = wt.parent / f"claude-config-{model['key']}"
    config_dir.mkdir(exist_ok=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith("ANTHROPIC_")}
    env.update({
        "CLAUDE_CONFIG_DIR": str(config_dir),
        "ANTHROPIC_BASE_URL": provider["base_url"],
        "ANTHROPIC_API_KEY": os.environ[provider["key_env"]],
    })
    prompt = (HERE / "task.md").read_text() + "\n\n" + CONFIG["agent_suffix"]
    cmd = [
        "claude", "-p", prompt,
        "--model", model["id"],
        "--output-format", "json",
        "--permission-mode", "acceptEdits",
        "--max-turns", str(CONFIG["max_turns"]),
        "--allowedTools", ",".join(CONFIG["allowed_tools"]),
    ]
    run = _sh(cmd, wt, timeout=CONFIG["agent_timeout_s"], env=env)
    parsed = None
    for line in reversed(run["out"].splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                parsed = json.loads(line)
                break
            except json.JSONDecodeError:
                continue
    usage = (parsed or {}).get("usage") or {}
    return {
        "ok": bool(parsed) and not parsed.get("is_error"),
        "seconds": run["seconds"],
        "num_turns": (parsed or {}).get("num_turns"),
        "stop_reason": (parsed or {}).get("subtype") or (parsed or {}).get("stop_reason"),
        "input_tokens": usage.get("input_tokens"),
        "cache_read_tokens": usage.get("cache_read_input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "final_message": ((parsed or {}).get("result") or "")[-1500:],
        "raw_tail": None if parsed else run["out"][-2000:],
    }


def _changed_files(wt: Path) -> list[str]:
    out = subprocess.run(["git", "status", "--porcelain"], cwd=wt, capture_output=True, text=True).stdout
    return [line[3:].strip() for line in out.splitlines() if line[3:].strip() != "node_modules"]


def _has_comments(wt: Path, files: list[str]) -> list[str]:
    hits = []
    for rel in files:
        path = wt / rel
        if path.is_dir():
            candidates = [p for p in path.rglob("*") if p.suffix in {".ts", ".tsx"}]
        else:
            candidates = [path] if path.suffix in {".ts", ".tsx"} else []
        for p in candidates:
            for n, line in enumerate(p.read_text(errors="ignore").splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("//") or stripped.startswith("/*") or re.search(r"\s//\s", line):
                    hits.append(f"{p.relative_to(wt)}:{n}")
    return hits[:20]


def grade(wt: Path) -> dict:
    files = _changed_files(wt)
    name_mod = wt / "src/lib/catalogName.ts"
    name_src = name_mod.read_text() if name_mod.exists() else ""
    own_test = wt / "src/lib/__tests__/catalogName.test.ts"
    src_text = "\n".join(p.read_text(errors="ignore") for p in (wt / "src").rglob("*.ts*"))
    catalog_meal = (wt / "src/lib/catalogMeal.ts").read_text()
    catalog_search = (wt / "src/lib/ai/coachCatalogSearch.ts").read_text()
    shutil.copy(HERE / "hidden.test.ts", wt / "src/lib/__tests__/zz_hidden_grader.test.ts")
    hidden = _sh(["npx", "vitest", "run", "src/lib/__tests__/zz_hidden_grader.test.ts"], wt)
    hidden_passed = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", hidden["out"])
    (wt / "src/lib/__tests__/zz_hidden_grader.test.ts").unlink()
    tsc = _sh(["npx", "tsc", "--noEmit"], wt)
    lint = _sh(["npx", "eslint", "src/lib"], wt)
    vitest = _sh(["npx", "vitest", "run"], wt)
    checks = {
        "module_exists": name_mod.exists(),
        "module_pure": bool(name_src) and "server-only" not in name_src and "@/lib/db" not in name_src,
        "own_tests_exist": own_test.exists(),
        "old_fn_removed": "sizeVariantKey" not in src_text,
        "catalog_meal_uses_new": "sizeFamilyKey" in catalog_meal,
        "catalog_search_uses_new": "sizeFamilyKey" in catalog_search,
        "tsc": tsc["ok"],
        "eslint": lint["ok"],
        "vitest_full": vitest["ok"],
    }
    hidden_total = 11
    passed = int(hidden_passed.group(2)) if hidden_passed else 0
    return {
        "hidden_passed": passed,
        "hidden_total": hidden_total,
        "checks": checks,
        "checks_passed": sum(checks.values()),
        "checks_total": len(checks),
        "comment_hits": _has_comments(wt, files),
        "changed_files": files,
        "diff_stat": subprocess.run(["git", "diff", "--stat"], cwd=wt, capture_output=True, text=True).stdout[-1500:],
        "logs": {"hidden": hidden["out"][-1500:], "tsc": tsc["out"][-1500:], "eslint": lint["out"][-1500:], "vitest": vitest["out"][-1500:]},
    }


def run_one(model: dict, date: str) -> dict:
    wt = _worktree(model["key"])
    agent = _agent(model, wt)
    graded = grade(wt)
    result = {"model": model["key"], "model_id": model["id"], "provider": model["provider"], "date": date, "worktree": str(wt), "agent": agent, "grade": graded}
    out = ROOT / "runs" / f"coding-{date}-{model['key']}.json"
    out.write_text(json.dumps(result, indent=2))
    print(f"{model['key']}: hidden {graded['hidden_passed']}/{graded['hidden_total']}, checks {graded['checks_passed']}/{graded['checks_total']}, comments {len(graded['comment_hits'])}, turns {agent['num_turns']}, {agent['seconds']}s", flush=True)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--parallel", type=int, default=3)
    args = parser.parse_args()
    all_models = {m["key"]: m for m in json.loads((ROOT / "models.json").read_text())["models"]}
    chosen = [all_models[k] for k in args.models.split(",")]
    with ThreadPoolExecutor(max_workers=args.parallel) as pool:
        list(pool.map(lambda m: run_one(m, args.date), chosen))


if __name__ == "__main__":
    main()
