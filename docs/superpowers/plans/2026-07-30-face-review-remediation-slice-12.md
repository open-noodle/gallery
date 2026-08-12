# Slice 12 — Web: gating, dialog semantics, i18n

**Spec:** [`2026-07-30-face-review-unification-remediation-slices.md`](../specs/2026-07-30-face-review-unification-remediation-slices.md)
(Slice 12, findings F28–F32)
**Branch:** `feat/face-review-unified`
**Depends on:** Slice 2 (commit `a7ad2bce387`), which rewrote
`web/src/routes/admin/face-cleanup/resolutions/page.spec.ts` to render real translations. Build on
that spec — do not revert it to a key-echo mock.

## Goal

The client never offers an action the server will refuse, destructive confirmations are real dialogs,
and every user-visible string is translatable and correctly pluralised.

## Concurrency

Server slices are running concurrently. Touch **only** files under `web/` and `i18n/`. Do not touch
anything under `server/`, `e2e/`, `scripts/`, `docs/superpowers/specs/`, or
`web/src/lib/modals/PersonSuggestionReviewModal.*` (Slice 11 owns the modal).

## Part 1 — editor-gate the suggestion surfaces (F28)

**Two routes reach these surfaces**, and a recent commit (`b1579ab0605`) added the second:

1. `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
   renders `<PersonSuggestionBanner>` at roughly `:784`, unconditionally. `isEditor` is defined in the
   same file (roughly `:121`) and is applied at eight other sites — just not this one.
2. `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte` now routes
   the same surfaces through the **space** endpoints when `primaryProfile.type === 'space-person'`
   (see its `getSuggestionTarget` / `fetchSuggestions` helpers). Its own doc comment says: _"The server
   returns an empty page to members below editor, which keeps the banner hidden for viewers."_ That is
   the entire viewer protection, and it is server-side only.

**Change.** Gate the banner and the review-modal opener on the client too, on both routes:

- space route: wrap in `isEditor`.
- global route: it already has a `canEditSpacePerson` derived (roughly `:428-438`) — apply it. For a
  personal (non-space) person the gate must always be true; only a space-scoped profile is
  role-gated.

Add a comment at each site stating that this is defence in depth, that the server's empty-page
short-circuit is the primary gate, and that relaxing that short-circuit (a natural future change —
"let viewers see what is pending") must not silently expose the actions.

Do **not** change the server. The write endpoints already `requireRole(Editor)`.

## Part 2 — real confirm dialogs (F29)

`web/src/routes/admin/face-cleanup/[personId]/+page.svelte` (roughly `:960-1005`) and
`web/src/routes/admin/face-cleanup/people/[personId]/+page.svelte` (roughly `:719-772`) are the
**only two** hand-rolled `fixed inset-0 z-50` dialogs in all of `web/src` — no `role="dialog"`, no
`aria-modal`, no accessible name, no focus move or trap, no Escape, no backdrop dismissal, background
not inert. They guard the two irreversible actions in the console (detach / "not a face", and
whole-cluster move).

**Change.** Replace both with `modalManager.show(ConfirmModal, { … })` from `@immich/ui` — the pattern
asset deletion already uses (see `web/src/lib/managers/selection-command-handlers.ts:144` and
`web/src/lib/managers/edit/edit-manager.svelte.ts:85`). Keep the existing i18n keys for title, body
and CTA; keep the count interpolation. Delete the `showEntireConfirm` / `showDetachConfirm` `$state`
flags and their markup.

## Part 3 — resolutions page honesty (F30)

`web/src/routes/admin/face-cleanup/resolutions/+page.svelte`:

1. The empty state (roughly `:141-147`) branches on `filtered.length === 0` and always says "no
   decisions recorded yet". Branch instead on whether the **unfiltered** list is empty; when it is not
   but the filter excluded everything, say so. New i18n key required.
2. `targetName()` (roughly `:56`) collapses a **deleted** target and a genuinely **unnamed** cluster
   into the same string. Both `personId`/`personName` and `spacePersonId`/`spacePersonName` can be
   null-name-with-id, because both FKs are `ON DELETE SET NULL`. Render the deleted case distinctly.
   New i18n key required.
3. The target thumbnail is gated on `item.personId` only (roughly `:196`), so a space-person target
   never renders one. Use the space-person branch too — the admin face-keyed route
   (`/admin/face-repair/faces/:assetFaceId/thumbnail`) is face-keyed and works for both.
4. The three filter-chip labels (roughly `:88-92`) are evaluated once at init, so they do not update
   on a locale change. Make them `$derived`.

Slice 2's `page.spec.ts` renders real translations, so your new assertions can check actual strings.

## Part 4 — i18n (F31)

1. **Nine orphaned keys** exist in `i18n/en.json` and the translated locales, referenced nowhere in
   `web/` or `mobile/`. Verify each with `grep -rn <key> web/src mobile/lib` before acting:
   `admin.face_cleanup_people_load_more`, `admin.face_cleanup_resolutions_declines_empty`,
   `admin.face_cleanup_resolutions_declines_heading`, `admin.face_cleanup_resolutions_face_label`,
   `admin.face_cleanup_resolutions_locked_to`, `admin.face_cleanup_resolutions_locks_empty`,
   `admin.face_cleanup_resolutions_locks_heading`, `face_suggestion_all_done`,
   `face_suggestion_confirmed_toast`.
   - Remove the seven `admin.face_cleanup_resolutions_*` / `_people_load_more` keys from `en.json`
     **and every locale that carries them**.
   - **Wire up** the other two rather than removing them: they document a specified success toast and
     an all-done state that were never connected. `face_suggestion_confirmed_toast` belongs where a
     confirm succeeds — but the modal is Slice 11's file, so instead **leave both keys in place** and
     record in your report that Slice 11 must wire them. Do not remove them.
2. **17 count-bearing admin keys use bare `{count}`** with no ICU plural, so they render "1 clusters"
   / "1 faces". Add plurals. Enumerate them by grepping `en.json` for `{count}` within
   `admin.face_cleanup_*` and cross-check against the list in the spec's F31. The user-facing
   `face_suggestion_count` already does this correctly — copy its ICU form.
3. **Stale keys**: `de.json` carries ~39 and `fr.json` ~27 `admin.face_cleanup_*` keys with no
   `en.json` counterpart (residue from the pre-unification design). Remove them.
   `web/src/lib/i18n/placeholders.spec.ts:139` deliberately skips keys absent from `en`, which is why
   nothing flags them.
4. Two keys are passed a `{count}` their message does not use
   (`admin.face_cleanup_review_detach_confirm_body`, at both confirm sites). Either add the
   placeholder to the message or drop the value — pick whichever reads better and be consistent
   across the two call sites.

## Part 5 — snooze keying (F32a)

`web/src/lib/components/faces-page/person-suggestion-banner.svelte` (roughly `:24`, `:35`) keys the
snooze on `person.id`. On `/spaces/…` that is the space-profile id; on `/people/…` it is the global
person id — while the API calls on that route use `profile.id`. So "Not now" on one route does not
snooze the other.

**Change.** Key the snooze on the same identifier the suggestion API calls use for that surface —
pass it in explicitly from each route rather than deriving it inside the banner, so the two cannot
drift again. Also prune entries past the 30-day expiry on write
(`web/src/lib/utils/face-suggestion-snooze.ts:68-76` never prunes).

Keep the existing per-user scoping — `face-suggestion-snooze.spec.ts` already covers it well
(per-user, signed-out no-op, expiry, corrupt JSON, baseline-rebase-down). Do not regress those.

## Part 6 — ML settings (F32b)

`web/src/routes/admin/system-settings/MachineLearningSettings.svelte`:

1. `:276-278` and `:289-292` include `!configToEdit.machineLearning.enabled` in the suggestions
   toggle's `disabled`. The server **deliberately** supports suggestions with the ML master switch off
   — `server/src/utils/misc.ts:114-122` omits that check on purpose and
   `server/src/services/person.service.spec.ts:7083-7089` pins it. Today an admin cannot enable
   suggestions with ML off, and worse, with suggestions already on, turning ML off makes the toggle
   unreachable while the server keeps serving and scanning. Remove `machineLearning.enabled` from
   both `disabled` expressions. Leave the config-file lock and the `facialRecognition.enabled`
   dependency alone.
2. The auto-fill `$effect` (`:19-38`) tracks `disabled` and `suggestions.enabled` and rewrites
   `suggestions.maxDistance` to `maxDistance + 0.2` whenever either changes, discarding a value the
   admin set deliberately and marking the form edited. Make it fill only when the value is unset or
   would violate the invariant — never overwrite a valid admin-set value.

## Tests

Every absence assertion needs a positive control in the same test body (spec §2). Web specs run with
happy-dom, which never fires `img.onload` on its own.

| #      | Test                                                                                                                                                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S12.1  | Space route: a **viewer** with a non-zero suggestion total renders **no** banner; an **editor** with the identical data renders it. Both halves in the same spec, differing only in role — a test that passes on `total: 0` alone is not acceptable (that is exactly the vacuous shape Slice 2 removed) |
| S12.2  | Global route: same, for a person whose `primaryProfile.type === 'space-person'`                                                                                                                                                                                                                         |
| S12.3  | **pin** — a personal (non-space) person always renders the banner for its owner                                                                                                                                                                                                                         |
| S12.4  | Detach confirmation is a `ConfirmModal`: Escape cancels, cancelling issues no `resolveFaces` call, confirming issues exactly one with the expected payload                                                                                                                                              |
| S12.5  | Whole-cluster-move confirmation: same three assertions                                                                                                                                                                                                                                                  |
| S12.6  | Resolutions with rows present but none matching the active filter shows the filtered-empty message, not the never-recorded one; with no rows at all it shows the never-recorded one                                                                                                                     |
| S12.7  | A row with `personId` set and `personName` null renders the deleted-target treatment; a row with both null renders the unnamed treatment; a space-person row renders a thumbnail                                                                                                                        |
| S12.8  | Switching locale updates the three filter-chip labels                                                                                                                                                                                                                                                   |
| S12.9  | Table-driven over all 17 plural keys, rendering against real `en.json`: count 1 reads singular, count 2 reads plural                                                                                                                                                                                    |
| S12.10 | A check that every `$t('…')` key referenced in the files this slice touches exists in `en.json`, and that no key removed in Part 4 is still referenced in `web/` or `mobile/`                                                                                                                           |
| S12.11 | Snooze set on the space route suppresses the banner on the global route for the same profile, and the reverse                                                                                                                                                                                           |
| S12.12 | Entries past expiry are removed from storage on the next write; unexpired entries survive                                                                                                                                                                                                               |
| S12.13 | With `machineLearning.enabled === false`, the suggestions toggle is **enabled**                                                                                                                                                                                                                         |
| S12.14 | Setting `suggestions.maxDistance` by hand, then toggling suggestions off and on, preserves the admin's value; an unset value is still auto-filled                                                                                                                                                       |

## Verification

```bash
cd web
pnpm exec vitest --run \
  'src/routes/(user)/people/**/*.spec.ts' \
  'src/routes/(user)/spaces/**/*.spec.ts' \
  'src/routes/admin/face-cleanup/**/*.spec.ts' \
  'src/routes/admin/system-settings/*.spec.ts' \
  'src/lib/utils/face-suggestion-snooze.spec.ts' \
  'src/lib/components/faces-page/*.spec.ts' \
  'src/lib/i18n/placeholders.spec.ts'
pnpm check:typescript
pnpm lint
```

`check:svelte` has been observed scanning zero files locally while working in CI — treat it as a
push-only gate and do not read a local zero-file run as green.

## Constraints

- `i18n/` is shared with the Flutter app. Grep **both** `web/` and `mobile/` before removing or
  renaming any key.
- Only `en.json` gets **new** keys; the other locales are translated separately. Removals apply to
  every locale that carries the key.
- Do not add `Co-Authored-By` or "Generated with" trailers. Do not commit.

## Commit

```
fix(web): gate face-suggestion actions by role and use real confirm dialogs
```
