# Pi Agent Workflow Expansion — Phase 3 Design

Status: in progress (tag removal shipped; curation dropped; recent-uploads next)
Date: 2026-05-30
Branch: `explore/pi-agent-brainstorm` (PR #574)
Builds on: Phase 1 (strict/hybrid foundation) and Phase 2 (named-entity resolver + 6 workflows).

## How To Use This Spec

This spec is written for `/impl-loop`. Every remaining slice is sized to be
planned, TDD-implemented, committed, and pushed independently. Treat shipped
slices as a completed baseline.

**TDD is mandatory for every slice.** No production code before a failing test:

1. Write the listed failing tests first.
2. Run them and confirm the **expected red** failure (assert on the real error).
3. Implement the smallest change that makes them green.
4. Run the full relevant suite and confirm **green** with no regressions.
5. Refactor under green.
6. Commit with the slice tag, then push.

A slice is done when its new tests are green, the **full** `agent-runner` unit
suite is green, the **full** `server` unit suite is green (when server files
changed), and the L1 eval baseline is still 100% (re-seed it in the same slice
if intended routing changed).

Commands (pnpm/node are not on PATH — always go through mise):

```bash
/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test                 # agent-runner unit
/opt/homebrew/bin/mise exec -- node --env-file-if-exists=.env agent-runner/eval/run.mjs --runs 5            # L1 eval
/opt/homebrew/bin/mise exec -- node --env-file-if-exists=.env agent-runner/eval/run.mjs --runs 5 --accept   # re-seed baseline
/opt/homebrew/bin/mise exec -- node agent-runner/src/bin/sync-strict-workflow-manifest.mjs                  # manifest mirror
/opt/homebrew/bin/mise exec -- pnpm -C server build && /opt/homebrew/bin/mise exec -- pnpm -C server sync:agent-capabilities  # matrix block
```

## Purpose

Phase 1 and Phase 2 delivered 16 strict/hybrid workflows over a shared source
resolver. Phase 3 targets three matrix gaps. Two are being built; one was
investigated and dropped:

1. **Tag removal (`untag_assets`) — SHIPPED (Slices 1-2).** Completes the
   documented "Add or remove tags" capability. Tagging was add-only;
   `"remove the Travel tag from my newest 20"` routed to `none`. Now a hybrid
   workflow proposes an `asset.removeTag` operation over a resolved selection,
   with tag name→id resolution. Closes the fourth "remove … from …" seam.
2. **Highlight curation — DROPPED (was Slices 3-7).** Curation is **already
   fully built**: the server `curateSelection` MCP tool (ranking + curated subset
   materialization) plus the LLM/`e2e-runtime` orchestration that implements the
   full `2026-05-26-pi-agent-highlight-curation-design.md` behavior, including
   **preview-assisted** curation, oversized-source guards, and fewer-candidates
   shortage handling. A deterministic strict workflow `run()` has no access to
   the session's provider image capability (`dispatcher.mjs` passes only
   `{ client, slots, signal, nowMs }`), so it cannot hand off selectively; it
   would intercept "best N from `<source>`" prompts and force metadata-only,
   **regressing preview-assisted curation** in image-capable sessions. The
   deterministic workflow is therefore redundant and net-negative. Curation stays
   on the existing tool + LLM path. (The in-progress Slices 3-4 were reverted in
   commit `f17fdb277c`.)
3. **Recent-upload source token — NEXT (Slice 3).** A small shared-resolver
   addition so "uploaded today / added this week / recent uploads" resolves by
   **upload date** (`createdAfter` / `createdBefore`) rather than capture date
   (`takenAfter` / `takenBefore`). Benefits every source workflow (archive, tag,
   untag, album-from-source) at once.

## Current State (Grounded)

Verified in the codebase; re-verify any **Open Contract Question** at its slice.

### Tag removal building blocks (shipped)

- `asset.removeTag` is an **operation** via `proposeAlbumOperations`:
  `{ type:'asset.removeTag', summary, targetKind:'asset_batch', assetSource:{kind:'selectionHandle', selectionHandleId}, payload:{ tagId } }`,
  no `targetId` (`validateStandaloneTarget(AssetBatch)`). Exact mirror of
  `addTagOperationSchema` (`server/src/dtos/agent-operation.dto.ts`).
- Tag name → `tagId` via `resolveAssetSearchFilters({ tags: [name] })` → a
  `results[]` entry `{ kind:'tag', status:'matched', id }`; `ambiguous` /
  `not_found` → `needs_input`.

### Recent-upload building block

- `searchAssets` filters support both capture-date `takenAfter`/`takenBefore`
  **and** upload-date `createdAfter`/`createdBefore`
  (`server/src/dtos/agent-tool.dto.ts:319-322`).
- The resolver (`agent-runner/src/strict-workflows/asset-source-resolver.mjs`)
  currently emits only `takenAfter`/`takenBefore` for all date ranges
  (`:60-93,352`). No upload-date path exists.

## Scope

In scope (remaining):

- Resolver support for an upload-date ("recent uploads") source token.
- Cross-cutting hardening: disambiguation sweep, L3 read-only proofs, capability
  matrix consistency, baseline re-seed, CI.

Out of scope: a deterministic curation workflow (dropped — see Purpose).

## Non-Goals

- No deterministic `curate_highlights` workflow; curation stays on the existing
  `curateSelection` tool + LLM path.
- No `analyzeAssetQuality`, image-quality scoring, duplicate clustering, trash,
  crop/enhance, geocoding, or sharing (tool-gated; out of phase).
- No new server MCP tools, operation types, or migrations.

## Flow Ownership Additions

| Capability                         | Flow                                 | Owns (deterministic)                                                                                                                   | Hands off / asks                                                                               |
| ---------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Remove a tag from photos (shipped) | Hybrid (`untag_assets`)              | "remove [the] `<tag>` tag from `<source>`", "untag `<source>`", "remove tag `<tag>` from `<source>`" over a resolver-resolvable source | Unbounded source → handoff; tag not found/ambiguous → needs_input; subjective source → handoff |
| Recent-upload source token (next)  | Resolver extension (no new workflow) | "uploaded `<when>`", "added `<when>`", "recent uploads" → `createdAfter`/`createdBefore`                                               | n/a — shared by all source workflows                                                           |

## Architecture — Recent-upload resolver token

Add `parseUploadRange(source, now)` to `asset-source-resolver.mjs`, parallel to
`parseDateRange`, recognizing upload phrasing ("uploaded", "added", "imported",
"recent uploads") and emitting `{ createdAfter, createdBefore }` instead of
`{ takenAfter, takenBefore }`. Capture phrasing ("taken", "from `<when>`",
"photos from `<when>`") stays on `takenAfter`/`takenBefore`. When a prompt mixes
both, upload phrasing wins for the date field. Purely additive to the filter
object passed to `searchAssets`.

## Open Contract Questions

| #   | Question                                                                                                                                                     | Pinned to                          | Fallback                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------- |
| OQ6 | Does `searchAssets` metadata mode return the upload-date set for `createdAfter`/`createdBefore` exactly as `takenAfter`/`takenBefore` does for capture date? | Slice 3 (prove live in Slice 4 L3) | Keep capture-date behavior; mark the upload token handoff |

(OQ1 tag name→id and OQ2 removeTag op shape were resolved and shipped in Slice 1.)

## Coverage By Eval Layer

- **L1:** upload-token routing positives + the capture-vs-upload disambiguation
  negatives; re-seed `agent-runner/eval/baseline.json` if routing changes.
- **L2:** resolver unit tests (`asset-source-resolver.test.mjs`) + a workflow-level
  test that an upload-dated source resolves to a bounded selection.
- **L3:** a live read-only proof that `createdAfter` resolves on the personal
  instance (OQ6); re-seed `agent-runner/eval/baseline.l3.json` after a final RC.

## Slices

### Slice 1 — `untag_assets` router + run + contract fixture — SHIPPED

Commit `5282f5fcd9`. Hybrid tag-removal workflow end-to-end + `validateAssetRemoveTag`
fixture + manifest entry + matrix regen + disambiguation flip. 885 agent-runner
tests; server matrix spec green.

### Slice 2 — `untag_assets` L1 scenarios + baseline — SHIPPED

Commit `52adef202a`. Recall + slot-fidelity scenarios; two stale negatives
updated; L1 re-seeded to 100% (114/114).

### Slice 3 — Recent-upload source token (resolver)

Goal: upload-date source phrasing across all source workflows.

Files: `agent-runner/src/strict-workflows/asset-source-resolver.mjs`,
`asset-source-resolver.test.mjs`. Resolve OQ6 (createdAfter behavior) first.

TDD tests:

- `parseUploadRange("uploaded today", now)` → `{ createdAfter, createdBefore }`
  bounding today; "added this week", "imported yesterday", "uploaded in the last
  7 days", "recent uploads" (default window — pick and document, e.g. last 30
  days) similarly.
- Capture phrasing unchanged: "photos from today", "taken last weekend",
  "January 2024" still → `takenAfter`/`takenBefore`.
- Mixed phrasing: "photos I uploaded today" → upload date wins.
- Resolver integration: each source workflow (archive, tag, untag,
  create_album_from_source) accepts an upload-dated source and passes
  `createdAfter`/`createdBefore` to `searchAssets`.
- Workflow-level: "archive everything I uploaded today" resolves to a bounded
  selection (not handoff).

Edge cases: "uploaded" with no time word ("photos I uploaded") → ambiguous → keep
current behavior (handoff/needs count) rather than an unbounded upload range;
timezone handling matches the existing `dayStart`/`dayEnd` helpers.

Exit: resolver tests + full agent-runner suite green; no capture-date regression;
L1 re-seeded if routing changed.

### Slice 4 — Hardening: disambiguation + L3 + capability matrix + acceptance

Goal: cross-cutting integration, live proofs, ship-ready.

- Disambiguation sweep across all 17 workflows: `untag_assets` and upload-dated
  sources route correctly and do not steal from `tag_assets`,
  `remove_photos_from_album`, `create_album_from_source`, `archive_assets`.
- L3 read-only scenarios (live against personal): `untag_assets` routing + a
  seeded `l3.plan.untag.*` plan scenario (needs a real tag on real owned assets;
  proves OQ2 live, gated `planProposed: SEEDED ? true : undefined`); an
  `l3.plan.upload.recency` proof that `createdAfter` resolves live (OQ6).
- Capability matrix: confirm the generated block + Flow Ownership are consistent
  with the manifest (untag already present; no curate entry). Add a note that
  search/source filters now accept upload-date. Keep
  `server/src/services/agent-capability-matrix.spec.ts` green. Run docs prettier
  from `cd docs` to a fixed point.
- Build one RC (`rc-personal`), pin personal (leave it on the RC), run the full
  L3 suite, re-seed `baseline.l3.json`.
- Branch CI green (Docs Build, Revert-to-Immich, Lint/Test Server, SQL Schema,
  OpenAPI Clients). agent-runner is not in CI — local green + L3 is the gate.
- `babysit-codex` until green.

Exit: all suites green; L3 audits clean; matrix spec green; CI green.

## Edge Case Coverage Checklist

| Edge case                                   | Required behavior                     | Slice       |
| ------------------------------------------- | ------------------------------------- | ----------- |
| Untag with no tag named                     | needs_input: which tag                | 1 (shipped) |
| Tag not found / ambiguous                   | needs_input (no plan)                 | 1 (shipped) |
| Untag over an empty selection               | needs_input (no empty removal)        | 1 (shipped) |
| Untag vs "remove `<photos>` from `<album>`" | tag token → untag; else remove_photos | 1, 4        |
| Upload phrasing vs capture phrasing         | createdAfter vs takenAfter            | 3           |
| Mixed "photos I uploaded today"             | upload date wins                      | 3           |
| "uploaded" with no time word                | keep current bounded behavior         | 3           |

## Acceptance Criteria

- `untag_assets` shipped (done).
- The shared resolver resolves upload-date sources across every source workflow.
- OQ6 resolved against the real server and proven by an L3 plan scenario.
- Full `agent-runner` unit suite green; full `server` unit suite green; L1 100%
  (runs=5); L3 audits clean; capability-matrix spec green.
- Capability matrix reflects: tag removal supported, upload-date source filtering
  noted — generated block and hand-authored matrix in agreement.
- No new server MCP tools, operation types, or migrations.

## Future Work (out of phase, tool-gated)

- `analyzeAssetQuality` → objective best-photo scoring + visual cleanup.
- Duplicate / near-duplicate grouping (photo similarity surface).
- Trash/delete operation (needs a product/risk decision).
- Forward geocoding (place name → coordinates) for "set location to Paris".
- Crop/enhance image-edit operation family.
- Sharing / export / download with privacy review.
