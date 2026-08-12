# Advanced Scan Tuning — execution handoff (resume state)

**Saved:** 2026-06-06 (mid subagent-driven execution, paused for connectivity).
**Worktree:** `/Users/pierre/dev/gallery/.claude/worktrees/face-cleanup-console`
**Branch:** `feat/face-cleanup-console` (PR #664).
**Execution model:** `superpowers:subagent-driven-development` — fresh implementer subagent per task, then spec-compliance review, then code-quality review, fix loop, mark complete.

> NOTE: `SendMessage` is NOT available in this environment, so "implementer fixes" are done by dispatching a **fresh fix subagent** with precise instructions (equivalent effect, keeps orchestrator context clean). Reviews are fresh `Agent` (general-purpose, model `sonnet`) dispatches.

## What this feature is

Curated "Advanced scan" modal on the Face Cleanup admin dashboard. Lets an admin tune **3 knobs** for a single scan run — match sensitivity (`maxDistance`), min faces (`minFaces`), contamination cap (`maxFlaggedFraction`) — pre-filled from a defaults endpoint, per-scan transient (no persistence), engine unchanged.

- **Spec:** `docs/plans/2026-06-06-face-cleanup-advanced-scan-design.md`
- **Plan (the source of truth for tasks/code):** `docs/plans/2026-06-06-face-cleanup-advanced-scan-plan.md`

## Commit stack (ALL LOCAL — nothing pushed yet)

`origin/feat/face-cleanup-console` is at **`5826eb0d08`** (the decline feature). These 6 advanced-scan commits are local-only:

| SHA          | Commit                                                                  | Task                                    |
| ------------ | ----------------------------------------------------------------------- | --------------------------------------- |
| `54e2fef99e` | docs: note required-body SDK shape in plan runScan                      | (plan doc fix) — **HEAD**               |
| `564482b418` | feat(web): advanced scan tuning modal on the face-cleanup dashboard     | Task 5 (amended w/ disabled-button fix) |
| `36efe96d1a` | chore(open-api): regenerate for scan params + defaults endpoint         | Task 4                                  |
| `4af2ff6d8e` | test(face-repair): medium test that triggerScan params reach the engine | Task 3                                  |
| `5f53b4f709` | feat(face-repair): add scan defaults read endpoint                      | Task 2                                  |
| `466505bbcc` | feat(face-repair): accept optional tuning params on the scan trigger    | Task 1                                  |

(Design + plan doc commits `c920fabcbd`, `3dcf568fb4`, `27287149e1` precede these.)

## Task status

| Task                                         | Status                                | Notes                                                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Scan trigger accepts optional params body | ✅ DONE                               | spec ✅; quality fix applied → exported `FaceRepairScanParams = z.infer<…>` (single source of truth) + lower-bound tests.                                                                                  |
| 2. Effective scan-defaults read endpoint     | ✅ DONE                               | spec ✅; quality APPROVED, applied `minFaces: z.number().int()` fix.                                                                                                                                       |
| 3. Medium test — params reach engine         | ✅ DONE                               | spec ✅ (deep trace: 3/11≈27% straddles 0.5 default vs 0.1 tuned cap); quality APPROVED, applied: cite `DEFAULT_MAX_FLAGGED_FRACTION` in comment + `totals` non-null guards. **Runs in CI only (Docker)**. |
| 4. Regenerate OpenAPI + SDKs                 | ✅ DONE                               | clean codegen, only `open-api/` + `mobile/openapi/` changed, no enum renumbering, `minFaces` typed integer. **Surfaced: SDK `triggerScan` body arg is REQUIRED** (see gotchas).                            |
| 5. Advanced modal + dashboard wiring         | ⚠️ APPROVED, optional cleanup PENDING | spec ✅ after disabled-button fix; code-quality **APPROVED** with 5 Minors. A cleanup fix-subagent (W1/W2/W3 below) was **dispatched but USER-REJECTED** right before the pause.                           |
| 6. Full verification + final review          | ⬜ NOT STARTED                        | full suites, final code review, push, babysit CI.                                                                                                                                                          |

TaskCreate IDs (this session): #13 T1 ✅, #14 T2 ✅, #15 T3 ✅, #16 T4 ✅, #17 T5 (in_progress), #18 T6 (pending).

## RESUME HERE — next decision: Task 5 optional cleanups

Code-quality review of Task 5 was **APPROVED** (no Critical/Important). The 5 Minors are polish. A fix subagent was about to apply 3 of them but the user interrupted (about to lose internet). **Decision needed on resume:** apply these cleanups, or skip and proceed to Task 6 (they don't block — review already APPROVED).

The 3 cleanups that were queued (recommended — they remove _misleading comments_ + dead code):

- **W1 — modal defaults load:** `AdvancedScanModal.svelte` uses `.then(onFulfilled, onRejected)` with a comment falsely claiming `.catch()` leaves the rejection unhandled. Restore the plan's clean `onMount(async () => { try { const d = await getFaceRepairScanDefaults(); … } catch { /* keep fallbacks */ } })`. Keep a named `loadDefaults` if the Reset button calls it.
- **W2 — test scaffolding:** `AdvancedScanModal.spec.ts` has vestigial `process.on('unhandledRejection', …)` / `process.off` with a wrong comment. Remove it; with W1 the component handles the rejection, so the fallback test passes without it. **Must re-run all 3 modal tests after removal** — if test (c) fails, fix the component's try/catch (do NOT re-add process.on). Keep the `fireEvent.submit(form)` approach + its accurate comment (the submit button is portal-mounted by bits-ui Dialog.Portal, so clicking it doesn't trigger the form in happy-dom).
- **W3 — type dedup:** `AdvancedScanModal.svelte` `type Params` and `+page.svelte`'s local `type ScanParams` are identical. Export the type from the modal and import it on the page.

Two Minors intentionally **deferred** (lower value / more churn): (W4) the 3 bare `<input>`s inside `Field` lack `id`/label association (a11y, admin-only modal so low impact); (W5) the "Reset to defaults" button is a bare `<button>` not `@immich/ui` `<Button>`.

If applying W1/W2/W3: dispatch a fresh fix subagent (model sonnet), have it run `make check-web && make lint-web` + `pnpm -C web test -- --run 'src/routes/admin/face-cleanup/AdvancedScanModal.spec.ts'` (all 3 green), prettier-write the 3 files, then `git commit --amend --no-edit` onto `564482b418`. The verbatim cleanup prompt is preserved in the chat transcript (the rejected tool call).

## Then: Task 6 (full verification + final review + ship)

Per the plan's Task 6 (`docs/plans/2026-06-06-face-cleanup-advanced-scan-plan.md`, "## Task 6"):

1. `make check-server && make lint-server`; prettier-write the changed server files.
2. Full server unit suite: `pnpm -C server test -- --run` (expect all pass; was 4627 passing).
3. Full web unit suite: `pnpm -C web test -- --run` (expect all pass; was 216/216 files — **confirm no diagnostic\*.spec.ts remain**, they were deleted during this handoff).
4. Commit any format fixes.
5. **Final comprehensive code review** subagent over the whole feature diff (`git diff 27287149e1..HEAD` — i.e. the 6 advanced-scan commits) per subagent-driven-development's final step.
6. **Push** (`git push`) and **babysit CI** to green (use the `babysit` skill; PR #664). Known-flaky: `mise install --cd plugins` 403 in Docker builds → re-run failed jobs (not a code issue).
7. Optionally update the personal clone (`personal-test-feat-face-cleanup-console`, currently on **rc7** = decline feature) to a new RC to manually test Advanced scan on real data: build `feat-face-cleanup-console-rc8`, `kubectl -n personal-test-feat-face-cleanup-console set image deploy/gallery-server server=ghcr.io/open-noodle/gallery-server:feat-face-cleanup-console-rc8` (KUBECONFIG=~/.kube/noodle-k3s.yaml).

## Environment gotchas (carry forward)

- **Background/non-login bash lacks pnpm/node:** prepend every shell cmd with `export PATH="$HOME/.local/share/mise/shims:$PATH";`. Pipes mask exit codes — read the vitest summary line, not `$?`.
- **Medium tests need Docker (unavailable locally)** — Task 3's test is CI-gated. Verify medium tests via `make check-server` (tsc covers `test/`) + `make lint-server` only.
- **`check:svelte` is a local no-op** (reports 0 files). Gate web on `make check-web` (tsc) + component tests.
- **`pnpm format` (server) is `--check` not `--write`** — use `pnpm exec prettier --write <files>`. `make lint-web`/`lint-server` are eslint-only; run prettier separately.
- **SDK `triggerScan` body arg is REQUIRED** (`@Body()` → required requestBody). Web must call `triggerScan({ faceRepairScanTriggerRequestDto: params ? { params } : {} })` — never `undefined`. (Already implemented in `+page.svelte` `runScan`.)
- **oazapfts anonymous-enum renumbering** (bit the decline feature): adding inline `z.enum` fields named `type` renumbers `Type`/`Type2`. Not triggered here (scan params are all numbers) — but re-check on any future DTO regen.
- **Worktree trap:** the real worktree is `.claude/worktrees/…`; `.claire/…` resolves to `main`. Always operate in `/Users/pierre/dev/gallery/.claude/worktrees/face-cleanup-console` and confirm `git branch --show-current` == `feat/face-cleanup-console`.

## Quick resume checklist

1. `cd /Users/pierre/dev/gallery/.claude/worktrees/face-cleanup-console && git status` (expect clean, HEAD `54e2fef99e`).
2. Decide W1/W2/W3 cleanup (apply via fix subagent, amend `564482b418`) — or skip → mark Task 5 complete (#17).
3. Run Task 6 (verification → final review → push → babysit CI).
