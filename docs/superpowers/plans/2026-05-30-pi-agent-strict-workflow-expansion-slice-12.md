# Workflow Expansion — Slice 12: Group 1 L3 read-only scenarios

> Live verification of archive/favorite/tag against a running stack
> (`--layer L3`, read-only, `plan-only`). Phase-1 boundary → periodic rc-personal.

**Goal:** Each batch action routes correctly live AND proposes a real,
never-applied plan for a recency source; subjective/removal arms stay `none`.

**Spec scope:** Slice 12 (closes Phase 1). **Depends on:** Slices 5-11 registered +
manifested (in the rc image), the L3 driver, the personal instance.

## Scenarios (`eval/scenarios/l3-readonly.mjs`)

Recency sources are self-contained (no `{album}` discovery needed).

**Routing** (data-independent):

- `l3.recall.archive`: 'archive my newest 20 photos' → `archive_assets`.
- `l3.recall.favorite`: 'favorite my newest 10 photos' → `favorite_assets`.
- `l3.recall.tag`: 'tag my newest 20 photos as "eval-l3"' → `tag_assets`.

**Plan-proposed** (data-dependent; threshold 0.5; never applied):

- `l3.plan.archive.recency`: 'archive my newest 20 photos' → `{ archive_assets, planProposed: true }`.
- `l3.plan.favorite.recency`: 'favorite my newest 10 photos' → `{ favorite_assets, planProposed: true }`.
- `l3.plan.tag.recency`: 'tag my newest 20 photos as "eval-l3"' → `{ tag_assets, planProposed: true }`.

**Negatives**:

- `l3.neg.archive.subjective`: 'archive the best ones' → `none`.
- `l3.neg.tag.removal`: 'remove the Travel tag from my newest 20' → `none`.
- (existing `l3.neg.favorite` 'favorite my best shots from last year' already covers
  subjective favorite → none — keep it; verify it still declines now that
  favorite_assets is registered.)

All proposed plans are reviewable-only (`approvalMode: plan-only`); the run-wide
`auditNoApply` + `auditGateBlocks` must stay clean (no apply, no gate block).

## Run (phase boundary → rc-personal)

The personal instance is pinned to `rc-15` (pre-Slice-5). Build + pin a fresh RC so
the live runner has archive/favorite/tag registered:

```
# rc-personal skill: rc_tag=explore-pi-agent-brainstorm-rc-16
gh --repo open-noodle/gallery workflow run gallery-rc-build.yml --ref explore/pi-agent-brainstorm -f rc_tag=explore-pi-agent-brainstorm-rc-16
# wait for build, pin apps/personal/server.yaml (3 refs) to rc-16, ArgoCD sync, rollout
```

Then run L3 from the local working tree against personal:

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
cd agent-runner && node --env-file-if-exists=.env eval/run.mjs --layer L3 --diff
```

- Each new routing + plan scenario passes; the two new negatives → none; existing 18
  hold; both audits clean. Then `eval/run.mjs --layer L3 --accept` (re-seed
  `baseline.l3.json` for Phase 1).

## Acceptance

- archive/favorite/tag each route live and propose a never-applied recency plan;
  subjective/removal → none; no-apply + gate-block audits clean; baseline re-seeded.

## Commit

`test: add Group 1 L3 read-only scenarios (routing + plan-proposed + negatives) (slice 12)`
