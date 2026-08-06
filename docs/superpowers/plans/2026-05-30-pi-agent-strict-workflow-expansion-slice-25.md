# Workflow Expansion — Slice 25: End-to-end regression, edge sweep & acceptance

> Closes Phase 4. Fills the last edge-case gaps as tests, updates the matrix
> narrative, runs the combined L3 battery, and re-seeds the L3 baseline.

**Goal:** The full edge-case list is wired as tests; the capability matrix narrative
reflects the seven shipped workflows; both eval audits stay clean across the
expanded battery; baselines re-seeded.

## 1. Edge-case gaps → tests

Most edges are already covered per-slice (polarity, gate, handoff, guards,
disambiguation, no-raw-ids, contract fixtures). Fill the remaining explicit gap:

- **Absurd recency count (> 4 digits) → handoff** (`asset-source-resolver.test.mjs`):
  `resolveAssetSource({ sourceDescription: 'newest 99999 photos' })` → `status: 'handoff'`,
  no `searchAssets` call (a 5-digit token is not captured by the `\d{1,4}` count, so
  the recency keyword is unbounded → handoff).
- **Recency keyword with no count → handoff** (confirm existing coverage; add if
  missing): `'newest photos'` → handoff.

(Coverage already present, verified: subjective/location/people/album/camera →
handoff via the clean-source gate; zero-asset → needs_input; one op per plan;
selection-handle-only across all batch/album workflows; `query` never sent to
`resolveAssetSearchFilters`/metadata `searchAssets`; owner/self/last-owner/no-op
guards; album-vs-space disambiguation (Slice 24).)

## 2. Matrix narrative (`2026-05-19-pi-agent-capability-matrix.md`)

The generated "Implemented strict/hybrid workflows" block already lists all ten
workflows (auto-synced). Update the **Next Steps** to reflect that the three
candidate groups shipped, and note the one scoping decision:

> The batch-action (archive/favorite/tag), space-detail/membership
> (rename/describe space, manage members, change role), and general
> album-from-source workflows now ship with L1 + L3 eval coverage. Space
> disambiguation (`which space/user did you mean?`) currently re-prompts via
> `needs_input` rather than a durable continuation — a follow-up could add
> candidate-resume like the trip workflow.

## 3. Combined L3 (Groups 1–3) against rc-16 personal

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
cd agent-runner && node --env-file-if-exists=.env eval/run.mjs --layer L3 --diff
```

WAIT FOR COMPLETION (the personal model is slow, ~30–60s/scenario; do NOT trust the
decile log — wait for exit). Expect: all routing passes; recency batch/album +
describe-space propose never-applied plans; membership/role route (routing-only on
personal); negatives → none/add_photos; **both audits clean** (no-apply, no
gate-block). Then `--accept` to re-seed `baseline.l3.json`.

## 4. Acceptance verification

- `node --test 'agent-runner/src/**/*.test.mjs'` green (resolver + 7 workflows +
  contract fixtures + disambiguation).
- `cd server && node --experimental-strip-types src/bin/sync-agent-capabilities.ts --check` exits 0.
- L1 battery 72/72 (baseline current from Slice 23); L3 audits clean; baselines
  committed.
- No new MCP tools / operation types; no apply-path changes; every fixture validates
  real DTOs.

## 5. RC cleanup note

After the branch merges, revert the personal instance to `:release` (remove the
rc-16 pin in `infra-gitops apps/personal/server.yaml`) — the
`feedback_pierre_rc_override_cleanup` memory.

## Commit

`test: edge-case sweep + matrix narrative + re-seed L3 baseline (slice 25)`
