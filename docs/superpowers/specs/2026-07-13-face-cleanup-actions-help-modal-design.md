# Face Cleanup — "What do these actions do?" help modal — design

**Status:** approved (brainstorm 2026-07-13). Ready for implementation on `feat/face-cleanup-consistency` (PR #773).

**Origin:** the per-face resolution review page ships five terminal actions on the bulk bar — `→ Owner`,
`Keep here`, `Confirm / lock`, `Move → person…`, `Not a face` — with no explanation of what any of them
means or what it will do on apply. The distinctions that matter most are invisible: `Keep here` declines only
_this_ suspected owner (a later scan can re-flag the face toward someone else), which is the entire reason
`Confirm / lock` exists; `Not a face` strips the identity link and regenerates the person's thumbnail if the
detached crop was the avatar. An admin has no way to learn any of that from the UI.

**Scope (explicitly bounded).** This is the help affordance only. A broader ease-of-use pass was considered and
**declined** for this slice: per-state icons (state is currently encoded almost purely in color — indigo `owner`
vs violet `lock` is near-indistinguishable for a colorblind admin), keeping Apply visible while a selection
exists (the dock currently swaps it out for the bulk bar), bulk-bar visual hierarchy, and a source-photo preview
(which would need `assetId` on `FlaggedFaceSchema` — server + SDK + OpenAPI). Each remains a candidate for a
later slice; none is in this one.

---

## 1. Behavior

One modal, two entry points, both opening it via `modalManager.show(...)`:

1. An `(i)` `IconButton` on the **review banner** (`{count} faces need review…`), which is visible on page load.
2. An `(i)` `IconButton` on the **bulk bar**, in context with the five buttons it explains.

The bulk bar only renders once at least one face is selected, so the banner entry point is the one a confused
admin finds _before_ touching anything; the bulk-bar entry point is the one they reach for mid-task. Both open
the same component.

Surface is `@immich/ui`'s `Modal` + `ModalBody` + `ModalFooter` (as `ServerAboutModal` does), not a hand-rolled
popover: focus trap, escape-to-close, backdrop click and ARIA come from the design system, and the content is
too long for the ~288px anchored panel `people-face-statistics-info.svelte` uses. It matches `AdvancedScanModal`
and `PersonPicker`, the two modals this feature already ships.

## 2. Content

Each action renders as: **name** → **what it means / when to use it** → **what it does on apply**, the last set
off behind a quiet left rule, with the action's state color as a rail and swatch tying the entry back to the
button and to the face-tile ribbon on the grid.

The **name is not re-declared** — the modal reuses each button's existing i18n key
(`face_cleanup_review_bulk_owner` / `_stay` / `_lock` / `_other` / `_detach`), so a translated heading can never
drift from its translated button.

Copy is grounded in `resolveFaces` (`server/src/services/face-repair.service.ts`), not in what the labels imply:

| Action           | Means                                                                                                                                                       | On apply (verified against the service)                                                                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `→ Owner`        | Belongs to the suspected owner the scan found. The default for every flagged face.                                                                          | Face leaves this person and joins the suspected owner; it won't come back, because it now sits with the person it resembles.                                                                                                                                  |
| `Keep here`      | The face really does belong to this person; the scan got it wrong.                                                                                          | Face stays; a decline is written against **that face's own** suspected owner, so future scans stop proposing that move. A later scan suspecting a _different_ person can still flag it — hence `Confirm / lock`.                                              |
| `Confirm / lock` | Like `Keep here` but permanent and owner-agnostic. For faces that genuinely don't resemble their owner: childhood photos, age gaps, costumes, heavy shadow. | Face is pinned; no future scan can flag it again regardless of who it comes to resemble. The lock survives the person being merged away or deleted (the consistency-hardening work in this same PR). Undoable from the Resolutions page.                      |
| `Move → person…` | Send the face to a person you pick instead of the scan's suggestion.                                                                                        | Face moves to the chosen person. `Lock so it won't re-flag` in the picker also pins it there — needed for a deliberate override the scan will disagree with; without it the next scan can re-flag the face toward whoever it resembles.                       |
| `Not a face`     | The crop isn't a real face: a poster, statue, reflection, blurred smudge.                                                                                   | Face is unassigned from this person **and** its identity link is stripped, so it stops being proposed for anyone. The photo is untouched — only the detected face region is detached — and the person's thumbnail is regenerated if that crop was its avatar. |

Framing lines: an intro (_nothing changes until you press Apply; every flagged face ends in one of these five
states, then this person leaves the queue for good_) and a footer (_declines and locks are undoable from the
Resolutions page; if moving or detaching leaves an unnamed person with no faces, that empty person is removed_).

## 3. i18n

Fourteen new keys under `admin.face_cleanup_review_help_*` in `i18n/en.json` **only** — other locales fall back
to English and are filled by Weblate:

- `_open` — the `(i)` button's `aria-label`/`title`, shared by both entry points
- `_title`, `_intro`, `_footer`
- `_owner_body` / `_owner_effect`, and the same `_body` / `_effect` pair for `_stay`, `_lock`, `_other`, `_detach`

Splitting _means_ and _effect_ into separate keys keeps each translation unit short. The Close button reuses the
existing global `close` key.

## 4. Code

- **New** `web/src/routes/admin/face-cleanup/[personId]/ActionsHelpModal.svelte` — colocated with `PersonPicker.svelte`.
  Props: `{ onClose }`. Pure presentation: no props for the five actions, no network, no server change.
- **Moved** `STATE_COLOR` from `+page.svelte` into `review.svelte.ts` (which already owns `FaceState`), so the
  page and the modal read the five colors from one source instead of duplicating the hex values.
- **Edited** `+page.svelte` — the two `(i)` buttons, each calling `modalManager.show(ActionsHelpModal, {})`.

No server, SDK, OpenAPI, or migration changes.

## 5. Testing (TDD)

- `ActionsHelpModal.spec.ts` (new): renders all five action names, bodies and effects; each resolves through
  i18n rather than hardcoded English; Close invokes `onClose`.
- `page.spec.ts` (extended): the banner `(i)` opens the modal; the bulk-bar `(i)` (after selecting a face) opens
  the modal. Asserted through the existing `modalManager.show` mock.

No e2e: the modal is presentational and adds no server behavior.
