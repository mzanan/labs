# Task: position-independent size families for catalog items

Repository: fit-coach (Next.js 16, TypeScript, Drizzle, Vitest). You are working in a git worktree of it.

## Problem

Catalog items that are the same food at different sizes are grouped into a "size family" so the coach can offer a size picker. Today the family key is computed by `sizeVariantKey` in `src/lib/catalogMeal.ts`, which only strips a size written at the very start of the name. Real names break it:

- `100G/200G Sweet Potato` and `200G Sweet Potato` do not group, because only `100G` is stripped and `/200g sweet potato` is left behind.
- `Sweet Potato 100g` groups with nothing, because the size is at the end.
- A name with no size at all, like `Rice`, gets the key `rice`, so it can be mistaken for a family member of `100g Rice` in `src/lib/ai/coachCatalogSearch.ts`.

## What to build

1. A new pure module `src/lib/catalogName.ts` (no `server-only`, no database import) exporting:

   ```ts
   export function sizeFamilyKey(name: string): string | null
   ```

   - Returns the name normalized with the existing `normalizeSearch` from `src/lib/search.ts`, with every size token removed, runs of whitespace collapsed to one space, and trimmed.
   - Returns `null` when the name contains no size token, or when nothing but size tokens is left.
   - A size token is a number (integer or decimal, `.` or `,` as separator), optionally followed by a space, followed by a unit: `g`, `gr`, `grs`, `gram`, `grams`, `kg`, `ml`, `l`, `oz` (any case). A slash-joined list of sizes is one token: `100G/200G`, `100/200g`, `140 g/210 g`. The token can appear anywhere in the name, but only as a whole word: `7up`, `V8 juice` and `2 eggs` contain no size token.
   - Punctuation left dangling by the removal (a leading or trailing `-`, `,`, `(`, `)`, `/`) is removed too, so `Chicken (140g)` and `140g Chicken` share a key.

2. `sizeVariantsOf` in `src/lib/catalogMeal.ts` and the same-family check in `src/lib/ai/coachCatalogSearch.ts` must use `sizeFamilyKey`. An item whose key is `null` is never part of a family. Remove `sizeVariantKey` once nothing uses it.

3. Unit tests for `sizeFamilyKey` in `src/lib/__tests__/catalogName.test.ts`.

## Constraints

- Keep every other exported signature unchanged.
- No code comments. No `eslint-disable`.
- `npx tsc --noEmit`, `npx eslint src/lib` and `npx vitest run` must all pass.
- Do not run a dev server, do not touch the database, do not commit.
