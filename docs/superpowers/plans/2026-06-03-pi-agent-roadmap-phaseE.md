# Phase E — Screenshot/document cleanup — impl-loop plan

Spec: `docs/superpowers/specs/2026-05-31-pi-agent-capability-roadmap.md` (Phase E). agent-runner-first.

## Autonomous decisions (OQ-E1)

- **Tag-first** resolution of "screenshots" → the `Screenshots` / `Auto/Screenshots` classification tag via
  `resolveAssetSearchFilters`. **E2 (heuristic `make:null`) is intentionally SKIPPED**: a camera-less heuristic
  feeding archive/trash workflows would also match downloads, memes, scanned documents, and edited exports —
  unacceptable precision for a cleanup/destructive context. On tag-not-found, the resolver **discloses** that
  screenshots aren't tagged on this instance (handoff/needs_input) rather than silently acting on the wrong photos.
  Users who want this enable a `Screenshots` classification category (the fork already auto-tags `Auto/{category}`).

## Current state (verified)

- Screenshots already **route** by verb (routing is pre-resolution): `classification-recall.mjs` has
  `recall.archive.screenshots` ("archive old screenshots from 2024" → archive_assets, with a comment that the
  resolver currently HANDS OFF "screenshots"); `disambiguation.test.mjs` routes
  "remove my screenshots from the Family space" → manage_space_assets, "delete my 2024 screenshots" → trash_assets.
  The `l3.neg.delete` "delete all my screenshots" → none is protected by the **unbounded-"all" decline**, not the noun.
- Resolver `asset-source-resolver.mjs`: `parseEntitySource` (:204) builds an entity; `ENTITY_TO_RESOLVER_FIELD`
  (:277) maps `tags → tags` for `resolveAssetSearchFilters`; `GENERIC_NOUNS` (:335 filler), `TYPE_NOUNS` (:338 media).
  "screenshots" is neither today → it survives as leftover text and the source hands off. Tag resolution for
  EXPLICIT tags already flows through resolveAssetSearchFilters with not-found handling — reuse that path.
- Classification tag shape: `classification.service.ts:181` emits `Auto/${category.name}` → an admin "Screenshots"
  category yields the `Auto/Screenshots` tag.

## Slice E1 — Resolver recognizes "screenshots" (agent-runner, tag-first, TDD)

CRITICAL STYLE: agent-runner single-quote, NOT prettier-gated/CI'd. Do NOT run prettier on agent-runner files.

**Tests first** (`asset-source-resolver.test.mjs`):

- `parseEntitySource`/`resolveAssetSource` for "my screenshots" / "screenshots" / "screen shots" / "screen captures"
  / singular "screenshot" → emits a tag entity `Screenshots` (the resolver calls
  `resolveAssetSearchFilters({ tags:['Screenshots'] })`). Use the existing test harness's resolveAssetSearchFilters
  stub: when it returns a matched tagId → the resolved filter carries `tagIds:[<id>]`.
- tag-not-found: stub resolveAssetSearchFilters returns not-found/empty for Screenshots → the resolver returns a
  disclosure/handoff outcome (the same shape other not-found tag resolutions produce) stating screenshots aren't
  tagged on this instance — NOT a silent empty/whole-library match.
- combined: "screenshots from last week" → tag filter + the date filter (both survive).
- "Auto/Screenshots": if the instance tag is named `Auto/Screenshots`, resolution still matches (resolve with
  both `Screenshots` and, if the first misses, `Auto/Screenshots`; assert the resolver tries the path form).
- regression: a non-screenshot source ("my Sony photos") is unchanged; "screenshots" does not leak into unrelated
  sources.
  RUN red → implement (single quotes; hook the screenshot noun in parseEntitySource to push 'Screenshots' onto the
  tags entity, and strip the matched noun so it isn't leftover text) → GREEN.

**L1** (routing unchanged — screenshots is a source modifier; verb owns routing):

- Update the `recall.archive.screenshots` comment (resolver now RESOLVES screenshots tag-first when configured,
  discloses otherwise). Add recall coverage if useful ("trash my screenshots" → trash_assets — already implied by
  verb; only add if it tightens slot survival). Ensure negatives stay intact: "delete all my screenshots" must NOT
  route (unbounded). Run `node eval/run.mjs --runs 5`; re-seed `--accept` only if intended deltas; confirm 100%.

Gates: full agent-runner suite green (fix disambiguation.test.mjs if a screenshot case's resolved-source
expectation changed — routing stays, run-time resolution may now assert a tag); L1 100%.
Commit `feat(agent): resolve "screenshots" to the Screenshots tag (tag-first, discloses when untagged) (E1)`; push.

## Slice E2 — SKIPPED (documented)

Heuristic `make:null` fallback intentionally not implemented (precision/safety — see decision above). No code.

## Slice E3 — Hardening: matrix + L3

- Capability matrix (`docs/.../2026-05-19-pi-agent-capability-matrix.md`): move "Screenshot/document cleanup"
  feasibility to **tag-based solid** (note: precise when an `Auto/Screenshots` classification category is
  configured; discloses + hands off otherwise; no heuristic). Keep `agent-capability-matrix.spec.ts` green; do not
  run prettier on the .md.
- L3 (`l3-readonly.mjs`, single quotes): `l3.recall.screenshots` ("archive my screenshots" → archive_assets) +
  a propose-only `l3.plan.screenshots` gated `planProposed: SEEDED ? true : undefined` (needs a Screenshots tag on
  the instance). Live run deferred to the consolidated end RC.
  Commit `test(agent): screenshot cleanup matrix + L3 (E3)`; push.
