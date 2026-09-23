"""Builds fixture/ from a pinned fit-coach commit: copies a fixed set of real files, plants known
vulnerabilities by exact text replacement, and writes fixture/manifest.json with the planted line
ranges computed from the result. Deterministic: the same commit gives the same fixture.

Run: python3 build_fixture.py [--repo PATH] [--ref SHA]"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).parent
FIXTURE = HERE / "fixture"

FILES = [
    "src/lib/session.ts",
    "src/app/api/cron/maintenance/route.ts",
    "src/app/api/whoop/connect/route.ts",
    "src/app/api/whoop/callback/route.ts",
    "src/app/api/push/subscribe/route.ts",
    "src/app/api/coach/approve/route.ts",
    "src/lib/data/pushSubscriptions.ts",
    "src/lib/actions/meals.ts",
    "src/lib/actions/profile.ts",
    "src/lib/actions/aiSettings.ts",
    "src/components/ui/Markdown.tsx",
]

PLANTS = [
    {
        "id": "V1",
        "region": ('export async function GET(req: Request)', '  const facts = await expireStaleFacts();'),
        "category": "authentication",
        "file": "src/app/api/cron/maintenance/route.ts",
        "find": "if (!cronSecret || auth !== `Bearer ${cronSecret}`) {",
        "replace": "if (cronSecret && auth !== `Bearer ${cronSecret}`) {",
        "anchor": "if (cronSecret && auth !==",
        "summary": "Cron endpoint is open to anyone when CRON_SECRET is unset.",
    },
    {
        "id": "V2",
        "region": ('export async function GET(request: NextRequest)', '    await connectWhoop(user.id, code);'),
        "category": "csrf",
        "file": "src/app/api/whoop/callback/route.ts",
        "find": "if (!code || !state || !expected || state !== expected) {",
        "replace": "if (!code || (expected && state !== expected)) {",
        "anchor": "if (!code || (expected && state !== expected)) {",
        "summary": "OAuth state check is skipped when the state cookie is missing, so a forged callback links an attacker's Whoop account.",
    },
    {
        "id": "V3",
        "region": ('export async function deleteSubscription(', 'export async function deleteSubscriptionByEndpoint('),
        "category": "authorization",
        "file": "src/lib/data/pushSubscriptions.ts",
        "find": "      and(\n        eq(push_subscriptions.endpoint, endpoint),\n        eq(push_subscriptions.user_id, userId),\n      ),\n    );\n}\n\nexport async function deleteSubscriptionByEndpoint(",
        "replace": "      eq(push_subscriptions.endpoint, endpoint),\n    );\n}\n\nexport async function deleteSubscriptionByEndpoint(",
        "anchor": "      eq(push_subscriptions.endpoint, endpoint),\n    );",
        "summary": "deleteSubscription ignores userId, so any signed-in user can delete another user's push subscription by endpoint.",
    },
    {
        "id": "V4",
        "region": ('export async function repeatMeal(', '  const id = newId();'),
        "category": "authorization",
        "file": "src/lib/actions/meals.ts",
        "find": "    .from(meals)\n    .where(and(eq(meals.id, mealId), eq(meals.user_id, user.id)))\n    .limit(1);\n  if (!source[0]) throw new Error(\"Meal not found\");",
        "replace": "    .from(meals)\n    .where(eq(meals.id, mealId))\n    .limit(1);\n  if (!source[0]) throw new Error(\"Meal not found\");",
        "anchor": "    .where(eq(meals.id, mealId))",
        "summary": "repeatMeal reads the source meal by id only, so a user can copy any other user's meal into their own log.",
    },
    {
        "id": "V5",
        "region": ('const settingsSchema = z.object({', '  revalidatePath("/settings/profile");'),
        "category": "mass-assignment",
        "file": "src/lib/actions/profile.ts",
        "find": "  day_cutoff_hour: z.number().int().min(0).max(12),\n});",
        "replace": "  day_cutoff_hour: z.number().int().min(0).max(12),\n}).passthrough();",
        "anchor": "}).passthrough();",
        "summary": "settingsSchema passes unknown keys through and the result is spread into the update, so a client can overwrite any profiles column, user_id included.",
    },
    {
        "id": "V6",
        "region": ('export async function storedAiKeyAction(', 'export async function removeAiSettingsAction('),
        "category": "secret-exposure",
        "file": "src/lib/actions/aiSettings.ts",
        "find": "export async function removeAiSettingsAction(",
        "replace": "export async function storedAiKeyAction(\n  input: unknown,\n): Promise<{ apiKey?: string; error?: string }> {\n  const user = await requireUser();\n  const parsed = providerSchema.safeParse(input);\n  if (!parsed.success) return { error: \"Unknown provider.\" };\n  const apiKey = await providerApiKey(user.id, parsed.data);\n  return apiKey ? { apiKey } : { error: \"No key saved.\" };\n}\n\nexport async function removeAiSettingsAction(",
        "anchor": "export async function storedAiKeyAction(",
        "span": 9,
        "summary": "A server action returns the decrypted provider API key to the browser.",
    },
    {
        "id": "V7",
        "region": ('import rehypeRaw from "rehype-raw";', '      </ReactMarkdown>'),
        "category": "xss",
        "file": "src/components/ui/Markdown.tsx",
        "find": "      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>",
        "replace": "      <ReactMarkdown\n        remarkPlugins={[remarkGfm]}\n        rehypePlugins={[rehypeRaw]}\n        components={COMPONENTS}\n      >",
        "anchor": "        rehypePlugins={[rehypeRaw]}",
        "extra": [
            ("import remarkGfm from \"remark-gfm\";", "import rehypeRaw from \"rehype-raw\";\nimport remarkGfm from \"remark-gfm\";"),
        ],
        "summary": "Coach replies are model output rendered with rehype-raw, so HTML in a reply (or injected into one) executes in the page.",
    },
    {
        "id": "V8",
        "region": ('export async function GET(request: Request)', '  const state = randomUUID();'),
        "category": "open-redirect",
        "file": "src/app/api/whoop/connect/route.ts",
        "find": "  if (!hasWhoopEnv()) {\n    return NextResponse.redirect(new URL(\"/settings?whoop=env\", request.url));\n  }",
        "replace": "  if (!hasWhoopEnv()) {\n    const next = new URL(request.url).searchParams.get(\"next\");\n    return NextResponse.redirect(new URL(next ?? \"/settings?whoop=env\", request.url));\n  }",
        "anchor": "    const next = new URL(request.url).searchParams.get(\"next\");",
        "span": 2,
        "summary": "The next query parameter is used as a redirect target, and an absolute URL sends the user to any external site.",
    },
]


def line_of(text: str, anchor: str) -> int:
    index = text.index(anchor)
    return text[:index].count("\n") + 1


def build(repo: Path, ref: str) -> dict:
    if FIXTURE.exists():
        shutil.rmtree(FIXTURE)
    for rel in FILES:
        content = subprocess.run(
            ["git", "show", f"{ref}:{rel}"], cwd=repo, capture_output=True, text=True, check=True
        ).stdout
        target = FIXTURE / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    planted = []
    for plant in PLANTS:
        path = FIXTURE / plant["file"]
        text = path.read_text()
        if text.count(plant["find"]) != 1:
            raise SystemExit(f"{plant['id']}: find text must occur exactly once in {plant['file']}")
        text = text.replace(plant["find"], plant["replace"])
        for old, new in plant.get("extra", []):
            if text.count(old) != 1:
                raise SystemExit(f"{plant['id']}: extra text must occur exactly once")
            text = text.replace(old, new)
        path.write_text(text)
        planted.append(plant)

    manifest = []
    for plant in planted:
        text = (FIXTURE / plant["file"]).read_text()
        start = line_of(text, plant["anchor"])
        span = plant.get("span", plant["anchor"].count("\n") + 1)
        region_start = line_of(text, plant["region"][0])
        region_end = line_of(text, plant["region"][1])
        manifest.append({
            "id": plant["id"],
            "category": plant["category"],
            "file": plant["file"],
            "line_start": start,
            "line_end": start + span - 1,
            "match_start": region_start,
            "match_end": region_end,
            "summary": plant["summary"],
        })
    result = {"source_repo": "fit-coach", "source_ref": ref, "files": FILES, "planted": manifest}
    (FIXTURE / "manifest.json").write_text(json.dumps(result, indent=2))
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default="/Users/zanan/Documents/projects/personal/fit-coach")
    parser.add_argument("--ref", default="ebe3235")
    args = parser.parse_args()
    result = build(Path(args.repo), args.ref)
    for p in result["planted"]:
        print(f"{p['id']} {p['category']:16} {p['file']}:{p['line_start']}-{p['line_end']} region {p['match_start']}-{p['match_end']}")


if __name__ == "__main__":
    main()
