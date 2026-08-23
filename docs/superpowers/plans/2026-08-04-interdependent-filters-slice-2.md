# Slice 2 — Regenerate the API clients (#910)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** The TypeScript SDK and the Dart client expose `hasFavorites`, `hasAssetsInAlbum` and
`hasAssetsNotInAlbum` on `FilterSuggestionsResponseDto` and `SmartSearchFacetsResponseDto`.

**Architecture:** Pure regeneration. No hand-written code in this slice — every changed file is generated
output.

**Tech Stack:** oazapfts (TypeScript SDK), OpenAPI Generator with fork mustache templates (Dart).

- **Spec:** `docs/superpowers/specs/2026-08-04-interdependent-filter-sections-910-design.md` §5.4
- **Branch:** `fix/910-interdependent-filter-sections`
- **Depends on:** Slice 1. Without the DTO change there is nothing to generate.
- **Scope:** `open-api/`, `packages/sdk/`, `mobile/openapi/`. No hand-written source.

## Global Constraints

- **Java is required** for the Dart generator. `java -version` must succeed before starting.
- The live TypeScript SDK is `packages/sdk/src/fetch-client.ts`, not `open-api/typescript-sdk/`. Generated
  output lands in both; the one the web app imports is `packages/sdk`.
- Never hand-edit generated files. If output looks wrong, fix the DTO in `server/src/dtos/` and regenerate.
- **Three of the commands CLAUDE.md documents for this workflow do not work** — verified against the
  `Makefile` and `server/package.json` (`feedback_local_verify_command_traps` §2 and §4):

  | Don't                | Why                                                | Do                                      |
  | -------------------- | -------------------------------------------------- | --------------------------------------- |
  | `make build-sdk`     | no such target                                     | `pnpm --filter @immich/sdk build`       |
  | `make open-api`      | removed stub — prints "use mise open-api", exits 1 | `mise open-api`                         |
  | `pnpm sync:open-api` | no such script in `server/package.json`            | `node server/dist/bin/sync-open-api.js` |

- Run `mise open-api`, not `mise run //:open-api`: from a worktree the `//:` prefix targets the **main**
  checkout (`reference_mise_run_from_worktree_wrong_dir`).
- **Run this slice before slice 3.** Slice 3 knowingly leaves `check:typescript` red until slice 4, and
  Step 6 below uses a clean `check:typescript` as its evidence that the generator emitted valid output.

## File Structure

| File                                 | Responsibility                              |
| ------------------------------------ | ------------------------------------------- |
| `open-api/immich-openapi-specs.json` | generated spec, source for both clients     |
| `packages/sdk/src/fetch-client.ts`   | generated TypeScript SDK — what web imports |
| `mobile/openapi/**`                  | generated Dart client                       |

**Interfaces produced** (slices 4 and 7 consume these):

```ts
// @immich/sdk
FilterSuggestionsResponseDto.hasFavorites: boolean
FilterSuggestionsResponseDto.hasAssetsInAlbum: boolean
FilterSuggestionsResponseDto.hasAssetsNotInAlbum: boolean
// and the same three on SmartSearchFacetsResponseDto
```

```dart
// package:openapi/api.dart
FilterSuggestionsResponseDto.hasFavorites // bool
FilterSuggestionsResponseDto.hasAssetsInAlbum // bool
FilterSuggestionsResponseDto.hasAssetsNotInAlbum // bool
```

---

## Task 1: Regenerate and verify

**Files:** all generated. No test file — the verification is that the symbols exist and the SDK compiles.

- [ ] **Step 1: Confirm the prerequisites**

```bash
java -version
git status --short
```

Expected: Java prints a version; the working tree is clean apart from slice 1's commits. Regenerating on
top of uncommitted work makes the generated diff impossible to review.

- [ ] **Step 2: Build the server and sync the spec**

```bash
cd server && pnpm build
node dist/bin/sync-open-api.js
```

- [ ] **Step 3: Verify the spec picked up the new fields**

```bash
grep -c '"hasAssetsNotInAlbum": {' open-api/immich-openapi-specs.json
```

Expected: `2` — the property declaration in `FilterSuggestionsResponseDto` and in
`SmartSearchFacetsResponseDto`. A `0` means slice 1's DTO edit is missing or the server build was
stale; go back rather than continuing.

The `": {"` suffix is load-bearing. A bare `grep -c 'hasAssetsNotInAlbum'` returns **4**, because each
schema also lists the name in its `required` array — confirmed by running it against the existing
`hasUnnamedPeople`, which reports 4 on today's spec. An earlier draft of this plan expected 2 from the
bare grep and would have read a correct regeneration as a failure.

- [ ] **Step 4: Regenerate both clients**

```bash
mise open-api
```

- [ ] **Step 5: Verify the generated clients**

```bash
grep -n 'hasAssetsNotInAlbum' packages/sdk/src/fetch-client.ts
grep -rn 'hasAssetsNotInAlbum' mobile/openapi/lib/model/filter_suggestions_response_dto.dart
```

Expected: hits in both. The Dart field must be a non-nullable `bool` — the Zod schema has no `.optional()`,
so a nullable `bool?` means the DTO was written wrong in slice 1.

- [ ] **Step 6: Build the SDK and typecheck the web app**

```bash
pnpm --filter @immich/sdk build
cd web && pnpm check:typescript
```

Expected: PASS. Nothing in web reads the new fields yet, so widening the response type cannot break it.
A failure here means the generator emitted something malformed.

This gate only means that **if slice 3 has not run yet**. If `check:typescript` is already red with
`hasFavorites`-shaped errors in `web/src/lib/utils/`, you ran slice 3 first: those errors are slice 3's
deliberate red, not a generator problem. Confirm no error points at `packages/sdk` and move on.

- [ ] **Step 7: Confirm the Dart client still analyses**

```bash
cd mobile && dart analyze --fatal-infos lib
```

Expected: PASS. Per `feedback_rebase_three_state_dart_codegen`, a generator bump can turn a class into a
real Dart `enum` and break `.value` access — `dart analyze` catches that here, before slice 7 depends on it.

- [ ] **Step 8: Commit**

Generated output goes in one commit, separate from hand-written code, so a later rebase can regenerate
rather than merge it.

```bash
git add open-api/ packages/sdk/ mobile/openapi/
git commit -m "chore(api): regenerate clients for the #910 filter facets"
```

---

## Done when

- `grep -c '"hasAssetsNotInAlbum": {' open-api/immich-openapi-specs.json` returns 2 (the bare grep
  returns 4 — see Task 1 Step 3).
- `packages/sdk/src/fetch-client.ts` and `mobile/openapi/` both carry all three fields.
- `pnpm check:typescript` (web) and `dart analyze --fatal-infos lib` (mobile) are green.
- The commit touches only generated directories.
