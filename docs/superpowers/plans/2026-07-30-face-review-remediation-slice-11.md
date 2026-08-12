# Slice 11 — Web: honest action feedback

**Spec:** [`2026-07-30-face-review-unification-remediation-slices.md`](../specs/2026-07-30-face-review-unification-remediation-slices.md)
(Slice 11, findings F24–F27, plus three items folded in from other slices)

## Goal

The UI never reports success for something that did not happen, and never states a count it did not
verify.

## Folded-in scope (from other slices)

- **F23, deferred out of Slice 10:** paginate `listNegativeVerdicts` server-side and the resolutions
  page client-side. Both halves must land together or the page breaks.
- **From Slice 12, blocked there:** `listNegativeVerdicts` does not project
  `shared_space_person.representativeFaceId`, so a space-person target on the resolutions page renders
  no thumbnail. `web/src/routes/admin/face-cleanup/resolutions/+page.svelte` has a comment at the exact
  spot. Add the projection and render it.
- **From Slice 12, left for you:** `face_suggestion_confirmed_toast` and `face_suggestion_all_done`
  exist in `i18n/en.json` and are referenced nowhere. Wire both in
  `web/src/lib/modals/PersonSuggestionReviewModal.svelte` — the toast where a confirm succeeds, the
  all-done state when the queue drains to zero. There is a key-audit spec
  (`web/src/lib/i18n/slice-12-key-audit.spec.ts`) that currently asserts they are unreferenced —
  update it.

## Part 1 — F24: the modal's 400 handling is wrong at its root

`web/src/lib/modals/PersonSuggestionReviewModal.svelte` treats **any** `{ status: 400 }` as
"already resolved": it marks the face acted, advances, and shows nothing. The comment claims the
dangerous failure mode (insufficient role / RBAC) surfaces as 403. **That is false for the personal
path** — `requireAccess` throws `BadRequestException` (`server/src/utils/access.ts`, around `:40`), so
_every_ authorization failure there is a 400. And Slice 4 added a face-ownership check to reject and
ignore, so there are now more 400s, not fewer. A suggestion whose asset is trashed or un-shared
between the queue load and the click reports success.

**Change.** Stop inferring intent from the status code. Have the action endpoints signal
"nothing to do" explicitly: return **204 No Content** when the action was a no-op and **200** when it
acted. The server methods already distinguish these internally (`claimed === 0`, the
`isFaceSuggestionEnabled` short-circuit, `markRejected` affecting no rows). Then in the modal:

- 204 → mark acted, advance, do **not** increment the confirmed counter, no toast;
- 200 → mark acted, advance, increment, show `face_suggestion_confirmed_toast`;
- any 4xx or 5xx → `handleError` and stay on the current face so it can be retried.

This touches the controllers' `@HttpCode`, the services' return values (they currently return
`Promise<void>` — they need to report whether they acted), the OpenAPI spec and the generated SDK.
**Do not regenerate the spec or SDKs** — the controlling session does that in one pass. Report what
will need regenerating.

Server files this needs: `server/src/controllers/person.controller.ts`,
`server/src/controllers/shared-space.controller.ts`, `server/src/services/person.service.ts`,
`server/src/services/shared-space.service.ts`, and their specs.

## Part 2 — F25: the move-entire count can understate by orders of magnitude

`web/src/routes/admin/face-cleanup/[personId]/+page.svelte` derives
`clusterTotal = restTotal + flaggedFaces.length`. `restTotal` is set only by `loadRestPage`, whose
entire error handling is `catch { /* graceful */ }`. Server-side, `entireCluster` enumerates the
cluster itself and ignores any client count. So a failed rest-load leaves the confirm saying "moves all
5 faces" for a 900-face cluster.

**Change.** Track the load failure. While it is set, **disable** the whole-cluster action with an
explanatory message, and make the confirm copy state that the server enumerates the cluster itself.
The sibling manual page hard-fails to a Retry banner — match that spirit.

## Part 3 — F26: bulk approve

`web/src/routes/admin/face-cleanup/scan/ConfidentLane.svelte` and `scan/+page.svelte`: bulk approve
has no confirmation (the single-row dismiss beside it does), and `Promise.all` rejects on the first
failure so a partial success is reported as total failure.

**Change.** Add a `ConfirmModal` naming the cluster count (Slice 12 established this pattern in the
two review pages — follow it). Switch to `Promise.allSettled` and report "N applied, M failed",
listing the failures. New i18n keys as needed, `en.json` only.

## Part 4 — F27: two smaller correctness bugs

- `scan/+page.svelte`: `stopPolling` clears the timer, but an in-flight `fetchLatestScan` re-arms it in
  its `.then`, so polling continues after `onDestroy`. Add a `destroyed` guard checked before
  re-arming.
- `web/src/routes/admin/face-cleanup/people/+page.svelte`: any page failure sets `loadError`, which is
  exclusive with the grid, so a failed _load-more_ wipes several loaded pages and Retry restarts from
  page 0. Keep the grid and offer an inline retry for the failed page; only a failed **first** page
  renders the full-page error state.

## Part 5 — F23 and the thumbnail projection

- `server/src/repositories/face-person-verdict.repository.ts` `listNegativeVerdicts` takes
  `{ page, size }` (size capped at 200), returns `{ total, items }`, orders stably
  (`createdAt desc, id desc`), and projects `shared_space_person.representativeFaceId` alongside the
  existing `person.faceAssetId`.
- `server/src/services/face-repair.service.ts` `listResolutions` and the response DTO carry the page
  through and expose the new field.
- `web/src/routes/admin/face-cleanup/resolutions/+page.svelte` paginates and renders a space-person
  thumbnail via the admin face-keyed route, replacing the `item.personId`-only gate. Remove the
  comment Slice 12 left describing the gap.

If the new `ORDER BY … LIMIT` needs an index to avoid a sort over the whole table, add it in a **new**
migration under `server/src/schema/migrations-gallery/` with a round timestamp — never amend an
existing one.

## Tests

Every absence assertion needs a positive control in the same test body (spec §2). Web specs use
happy-dom, which never fires `img.onload` by itself.

| #      | Layer  | Test                                                                                                                                        |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| S11.1  | web    | Confirm rejected with `{ status: 400 }` ⇒ `handleError` called, face **not** marked acted, modal does not advance, counter unchanged        |
| S11.2  | web    | Confirm resolving 204 ⇒ no toast, face acted, modal advances, counter **not** incremented                                                   |
| S11.3  | web    | Confirm resolving 200 ⇒ counter incremented and the success toast shown                                                                     |
| S11.4  | web    | The same three cases for `dismiss` and `ignore`                                                                                             |
| S11.5  | web    | **pin** — a 500 still surfaces and leaves the current face selected and retryable                                                           |
| S11.6  | web    | The all-done state renders when the queue drains to zero                                                                                    |
| S11.7  | unit   | Server: each action returns the acted/no-op signal correctly — acted, already-resolved, feature-disabled, ineligible                        |
| S11.8  | unit   | Server: the controllers map that signal to 200 vs 204                                                                                       |
| S11.9  | web    | With the rest-load failed, the whole-cluster action is disabled with an explanation, and the flagged grid still renders                     |
| S11.10 | web    | **pin** — with a successful rest load, the confirm copy shows `restTotal + flagged.length`                                                  |
| S11.11 | web    | Bulk approve shows a confirm naming the cluster count; cancelling issues zero `resolveFaces` calls                                          |
| S11.12 | web    | Bulk approve where one of three rejects ⇒ the other two still applied, message reports 2 applied / 1 failed                                 |
| S11.13 | web    | No further `getLatestScan` after `onDestroy`, including when a fetch was already in flight                                                  |
| S11.14 | web    | Page 3 of the people grid failing keeps pages 1–2 rendered and offers a retry for page 3 only                                               |
| S11.15 | web    | **pin** — page 1 failing still renders the full-page error state                                                                            |
| S11.16 | medium | `listNegativeVerdicts({ page: 1, size: 2 })` over 5 rows returns 2 items and `total: 5`; page 3 returns 1; ordering stable across pages     |
| S11.17 | medium | A space-person-targeted verdict exposes its representative face id; a personal one still exposes `person.faceAssetId`                       |
| S11.18 | web    | The resolutions page renders page 1, loads page 2 on demand, its total matches the server total, and a space-person row renders a thumbnail |

## Verification

```bash
cd web && pnpm exec vitest --run \
  src/lib/modals/PersonSuggestionReviewModal.spec.ts \
  src/routes/admin/face-cleanup/resolutions/page.spec.ts \
  src/routes/admin/face-cleanup/scan/page.spec.ts \
  src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts \
  src/routes/admin/face-cleanup/people/page.spec.ts \
  'src/routes/admin/face-cleanup/[personId]/page.spec.ts' \
  src/lib/i18n/slice-12-key-audit.spec.ts
cd web && pnpm check:typescript && pnpm lint
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/controllers/person.controller.spec.ts src/controllers/shared-space.controller.spec.ts src/services/person.service.spec.ts src/services/shared-space.service.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/face-person-verdict.repository.spec.ts test/medium/specs/services/face-repair.resolutions.spec.ts
cd server && npx tsc --noEmit -p tsconfig.json && npx eslint <the files you touched> --max-warnings 0
```

**Pass explicit spec paths, never globs** — a vitest glob over bracketed SvelteKit route directories
(`[personId]`, `(user)`) silently matches **zero** files and reports a clean pass. Always check the
reported file and test counts.

`check:svelte` has been observed scanning zero files locally while working in CI — treat it as a
push-only gate.

## Constraints

- This slice runs **after** Slice 9 has been committed, because both need
  `server/src/services/person.service.ts`. Confirm that before you start: `git log --oneline -5`
  should show a `perf(face-suggestions): queue suggestion scans only for people with candidates`
  commit. If it does not, stop and report rather than proceeding.
- Do NOT touch `server/src/repositories/person.repository.ts`,
  `server/src/repositories/shared-space.repository.ts`, `server/src/repositories/job.repository.ts`,
  or anything under `e2e/`.
- **`vitest` does not typecheck.** Run tsc, eslint and prettier and show their output.
- If you break a spec outside your scope, **report it with the exact fix** rather than editing it.
- Never run `make sql`, `mise //:sql`, `pnpm sync:open-api` or `mise open-api` — report what needs
  regenerating.
- New i18n keys go in `en.json` only. `i18n/` is shared with the Flutter app.
- Do not add `Co-Authored-By` or "Generated with" trailers. Do not commit.

## Commit

```
fix(web): report face-review action outcomes honestly
```
