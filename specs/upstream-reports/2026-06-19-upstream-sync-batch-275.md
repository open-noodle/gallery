# Upstream Sync Report — 2026-06-19 (batch 275 / 1 upstream + 1 fork)

Small same-day sync on top of `2026-06-19-upstream-sync-batch-274.md`. Docs + one mobile-CI workflow only.

## Summary

- **Mode**: rolling-upstream-rebase on `rebase/upstream-rolling-20260509-active` (v3-cutover branch, held off `main`)
- **Fork commits synced**: 1 — #714 `b054b158` (globally-monotonic mobile versionCode). Clean `upstream-sync-fork-main`.
- **Upstream commits pulled** (`38920fc4ca..95fc5e9682`): 1 — #29203 `95fc5e96` (clarify duplicate exif merging intent). Target = `upstream/main` `95fc5e9682`.
- **Conflicts resolved**: 2 — both in `docs/docs/features/duplicates-utility.md` (fork #249 + fork #333 docs vs upstream's reworded table).
- **New migrations**: 0 — Gallery migration count steady at **33**, mobile Drift unchanged.
- **OpenAPI/SDK**: none — no endpoint/DTO/source change.
- **Net content change vs batch 274**: exactly 2 files — `.github/workflows/gallery-build-mobile.yml` + `docs/docs/features/duplicates-utility.md`. **No server/web/mobile-Dart/ML source touched.**
- **Risk level**: LOW.
- **Recommendation**: DONE — 4 audits GREEN; targeted CI (Gallery Build Mobile + Static Analysis GREEN, Docs Build GREEN locally) all pass.

> **Scope note:** held rolling branch — not pushed to `main`, no `branding.upstream.version` bump (stays `v2.7.5`). Now **0 behind / 792 ahead** of `upstream/main`.

## Fork sync (1)

| SHA (orig) | PR   | Area      | Outcome                                                                                                                                                                                                                                                                                                               |
| ---------- | ---- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b054b158` | #714 | mobile CI | clean — switches Android versionCode from branch-relative `git rev-list --count` to wall-clock minutes (`$(date +%s)/60`). Fixes the rolling-branch versionCode inflation that blocked main Play Store rollouts. Applied cleanly despite an adjacent fork-only `make pigeon`→`dart run pigeon` hunk in the same file. |

## Upstream commits (1)

| SHA        | PR     | Area | Risk | Outcome                                                                                                                                                                                                    |
| ---------- | ------ | ---- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `95fc5e96` | #29203 | docs | LOW  | reworded the metadata-sync table in `duplicates-utility.md` to singular "the kept asset" (sync only happens when exactly one is kept). Conflicted with two fork docs commits to the same file — see C1/C2. |

## Conflict resolutions

### C1 — `docs/docs/features/duplicates-utility.md` (at fork #249, checksum-tombstone dedup)

Fork #249 **added** a "Re-upload prevention" section (checksum tombstones) and kept the base (plural) metadata table; upstream #29203 reworded that table to singular. **Resolution:** took upstream's reworded (singular) table verbatim and re-appended the fork's "Re-upload prevention" section beneath it. (Reset the file to upstream's exact version, then appended the fork section — guarantees byte-exact upstream wording.)

### C2 — `docs/docs/features/duplicates-utility.md` (at fork #333, shared-space sync docs)

Fork #333 **added** a "Shared Space" row to the metadata table. **Resolution:** kept upstream's singular wording for every row **and** inserted the fork's "Shared Space" row after "Album", reworded to singular ("The kept asset will be added to every Shared Space…") for consistency with the rest of the upstream-reworded table. Prettier-formatted; no markers remain.

## Audits & local verification

| Check                           | Status | Notes                                                                                    |
| ------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| postrebase-audit (275)          | GREEN  | fork files/symbols, 33 migrations, no timestamp collisions, Generated-Artifact-Review OK |
| fork-patches-check              | GREEN  | @immich/ui patch metadata consistent                                                     |
| ci-invariants-check             | GREEN  | no PUSH_O_MATIC; gallery images; upstream docs-deploy stays dispatch-only                |
| mobile-drift-rebase-check (275) | GREEN  | schemaVersion / snapshots / Gallery callbacks consistent                                 |
| CLAUDE.md fork branding         | INTACT | restored after replay                                                                    |
| Net-diff scope check            | OK     | only docs + `gallery-build-mobile.yml` changed vs batch-274 green tree                   |
| prettier --check (changed docs) | PASS   | `duplicates-utility.md` clean                                                            |
| workflow YAML validity          | PASS   | `gallery-build-mobile.yml` parses                                                        |

> **Local unit tests / type checks not re-run:** the net content change vs the batch-274 green tree is exactly two files — a docs markdown file and a mobile-CI workflow YAML. No TypeScript, Svelte, Dart, or Python source changed, so server/web/SDK build + unit results are identical to batch 274 (4672 server / 3166 web, both green).

## Remote CI verification

Dispatched on `rebase/upstream-batch-275` — **targeted** to what this batch exercises (the heavy server/web/migration suites would re-run identically to batch 274's green run, since no such source changed):

| Workflow             | Result        | Notes                                                                                                                                  |
| -------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Gallery Build Mobile | GREEN         | exercises the #714 versionCode computation + confirms mobile still builds                                                              |
| Static Code Analysis | GREEN         | full-tree safety net                                                                                                                   |
| Docs Build           | GREEN (local) | not push/PR-triggered on a held branch; validated via local `docusaurus build` (`[SUCCESS] Generated static files`; links/MDX resolve) |

## Post-rebase state

- Upstream base: `95fc5e9682` (`38920fc4ca..95fc5e9682`); fork commits ahead: **792**; behind: **0**.
- `integratedForkHead`: `b054b158` (advanced by fork-sync of #714); `upstreamTargetHead`: `95fc5e9682`.
- Canonical `rebase/upstream-rolling-20260509-active` updated to the rebased tip; not pushed to `main` (held for v3 cutover).
