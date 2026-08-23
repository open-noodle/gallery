# Rename / edit spaces — design

**Date:** 2026-07-25
**Discussion:** [#856 — Renaming spaces](https://github.com/open-noodle/gallery/discussions/856)
**Branch:** `worktree-feat-rename-spaces`

## Problem

A user asked how to rename a shared space and could not find the button. There is no button: the web app
has never shipped a way to edit a space's name, description, or color after creation.

The gap is almost entirely UI. The server endpoint already exists and works:

- `PATCH /shared-spaces/:id` accepts `name`, `description`, `color`, `thumbnailAssetId`, `thumbnailCropY`,
  `faceRecognitionEnabled`, `petsEnabled` (`SharedSpaceUpdateSchema`, `server/src/dtos/shared-space.dto.ts:16`).
- Renames are already recorded as `SharedSpaceActivityType.SpaceRename` (`server/src/enum.ts:87`) and
  already rendered in the space activity feed (`web/src/lib/components/spaces/space-activity-feed.svelte:69`).

Two things are missing: the endpoint gates naming behind **Owner**, and nothing in the web app calls it
with a `name`.

## Goals

1. Space **owners and editors** can change a space's name, description, and color.
2. The entry point is discoverable from the space page.
3. Space-wide processing settings stay owner-only.

## Non-goals

- **Mobile.** `mobile/lib/repositories/shared_space_api.repository.dart` has no `updateSpace` call at all.
  Adding one means a repository method, a bottom-sheet action, a dialog, and a local Drift write —
  its own PR.
- **The `/spaces` list context menu.** Neither `space-card.svelte` nor `spaces-table.svelte` has a
  context menu today; adding one is a separate surface.
- **Loosening `faceRecognitionEnabled` / `petsEnabled`.** These stay owner-only (see below).
- **Cover photo editing.** Already shipped and already editor-level.

## Design

### 1. Server — split the RBAC bucket

`server/src/services/shared-space.service.ts:275-281` currently buckets all five non-cover fields into one
owner-only `isMetadataUpdate` check:

```ts
const isMetadataUpdate =
  dto.name !== undefined ||
  dto.description !== undefined ||
  dto.color !== undefined ||
  dto.faceRecognitionEnabled !== undefined ||
  dto.petsEnabled !== undefined;
const minimumRole = isMetadataUpdate ? SharedSpaceRole.Owner : SharedSpaceRole.Editor;
```

Naming and appearance move to Editor. Cover is already Editor. That leaves only the settings pair on
Owner, so the check inverts and collapses:

```ts
// Space-wide processing settings stay owner-only; naming/appearance (name, description, color)
// and the cover are editor-level.
const isOwnerOnlySettingsUpdate = dto.faceRecognitionEnabled !== undefined || dto.petsEnabled !== undefined;
const minimumRole = isOwnerOnlySettingsUpdate ? SharedSpaceRole.Owner : SharedSpaceRole.Editor;
```

**Why the settings pair stays owner-only.** `faceRecognitionEnabled` gates ML processing and the People
tab for the entire space, and flipping it from `false` to `true` queues a `SharedSpaceFaceMatchAll` job
across every asset (`shared-space.service.ts:358-363`). `petsEnabled` likewise changes what the whole
space's people list contains. Those are administrative settings, not naming.

**Mixed payloads reject wholesale.** The check runs against the entire DTO before any write, so an editor
sending `{ name, petsEnabled }` gets a `ForbiddenException` and _nothing_ is written — no partial update.
This is existing behaviour and must be locked down by a test.

No DTO, controller, permission, migration, or SDK change. `Permission.SharedSpaceUpdate` and the route are
untouched.

### 2. Web — service layer

The API call does **not** live in the modal. `web/src/lib/services/space.service.ts` already exists, and
both comparable edit modals in the codebase route through a service handler that returns a boolean:

```
ApiKeyUpdateModal  → handleUpdateApiKey(...) → boolean → if (success) onClose()
TagEditModal       → handleUpdateTag(...)    → boolean → if (success) onClose()
```

The handler owns the `updateSpace` call, the success toast, and `handleError`; the modal only closes on
success. This matches the existing `addAssetsToSpace` shape in `space.service.ts:10-32`
(`try { … return true } catch { handleError(…); return false }`).

Add to `web/src/lib/services/space.service.ts`:

```ts
export const updateSpaceDetails = async (
  spaceId: string,
  dto: { name: string; description: string; color: UserAvatarColor },
) => { … };
```

Tests go in the existing `web/src/lib/services/space.service.spec.ts`.

### 3. Web — `SpaceEditModal.svelte`

New `web/src/lib/modals/SpaceEditModal.svelte`, mirroring `SpaceCreateModal.svelte`: `FormModal` wrapping
`Field` + `Input` (name), `Field` + `Textarea` (description), `Field` + `ColorPicker` (color). Prefilled
from the passed space, calls `updateSpaceDetails` on submit, closes on success.

```
┌─ Edit space ──────────────────┐
│ Name *                        │
│ [ Family & Friends          ] │
│                               │
│ Description                   │
│ [ Our shared holiday photos ] │
│ [                           ] │
│                               │
│ Color                         │
│ ( ● ○ ○ ○ ○ ○ ○ ○ ○ ○ )       │
│                               │
│        [ Cancel ]  [ Save ]   │
└───────────────────────────────┘
```

**One deliberate difference from the create modal.** `SpaceCreateModal` sends
`description: description || undefined`. The edit modal must send `description` **as-is**. `updatePayload`
in the service only picks up keys that are `!== undefined` (`shared-space.service.ts:299-320`), so sending
`undefined` for an emptied field would silently keep the old description. An empty string passes
`z.string().max(500)` and clears the column.

**Empty-name guard.** `Field ... required` only propagates to native HTML form validation, which blocks an
empty input but happily submits `"   "` — which the server then rejects with a 400 from
`z.string().trim().min(1)`. `FormModal` takes a `disabled` prop for its submit button, so the modal binds
`disabled={name.trim().length === 0}` to catch both cases before a request is made.

This is a **deliberate deviation** — no other `FormModal` in the codebase disables its submit button. It
earns its keep because whitespace-only names are otherwise a real, reachable 400.

**Length caps.** `name` is capped at 100 and `description` at 500 server-side. Without client caps, pasting
an over-long description yields a 400 surfaced as a generic toast that names neither the field nor the
limit. Both `Input` and `Textarea` spread `{...restProps}` onto the underlying element, so `maxlength={100}`
and `maxlength={500}` pass straight through and make that error unreachable.

**Autofocus and select.** Renaming is the dominant path. The name input autofocuses _with its existing text
selected_, so typing replaces it immediately rather than requiring a manual select-all.

### 4. Web — entry points

Rename is reachable from **two** places, because the reported bug is a discoverability failure, not a
missing capability.

#### 4a. Header overflow menu

`web/src/routes/(user)/spaces/[spaceId]/+layout.svelte`, inside the existing `{#if isEditor}` block of the
header overflow menu, above "Add all photos":

```
  [＋ Add photos]  [⋮]
                    │
     ┌───────────────────────┐
     │ ◉ Hide from timeline  │
     │ ☺ Stop sharing names  │
     ├───────────────────────┤
     │ ✎ Edit space   ← new  │  editor+
     │ ⧉ Add all photos      │  editor+
     ├───────────────────────┤
     │ 🐾 Show pets          │  owner
     │ 🗑 Delete space       │  owner
     └───────────────────────┘
```

Handler follows the established pattern in this file — `modalManager.show(SpaceEditModal, { space })`,
then `invalidateAll()`. `invalidateAll()` refreshes the hero title, the page title, and the tab counts. The
rename appears in the activity feed with no extra work.

#### 4b. Hero pencil menu

The ✎ button on the space hero is where a user hunting for "rename" looks **first** — and today it contains
only "Change cover photo" and "Reposition". A user who clicks it concludes renaming is impossible, which is
verbatim what discussion #856 reports. Shipping rename only into the ⋮ menu would leave that trap intact,
so "Edit space" is added to the hero menu too.

The pencil's gate also changes. It currently renders on `canEdit && hasCover` (`space-hero.svelte:169`), so
a space with no cover photo shows no pencil at all. Since the menu now hosts a non-cover action, the gate
drops to `canEdit` — but the **cover-specific items stay conditional**, because "Reposition" is meaningless
without a cover image to drag:

| Menu item          | Condition             |
| ------------------ | --------------------- |
| Edit space         | `canEdit`             |
| Change cover photo | `canEdit`             |
| Reposition         | `canEdit && hasCover` |

The existing top-left "Set cover photo" button (`canEdit && !hasCover`) stays. It duplicates "Change cover
photo" for cover-less spaces, which is accepted: it is a deliberate empty-state call to action, and removing
it would regress cover discoverability to fix a redundancy nobody has complained about.

### 5. i18n

Reuses the existing `name`, `description`, and `color` keys. New keys in `i18n/en.json` only (web and
mobile share one `i18n/` directory; new keys only need `en.json`):

| Key                             | English                |
| ------------------------------- | ---------------------- |
| `spaces_edit`                   | Edit Space             |
| `spaces_edit_success`           | Space updated          |
| `errors.unable_to_update_space` | Unable to update space |

## Testing

Written test-first: each behaviour gets a failing test before the implementation that satisfies it.

### RBAC matrix (server)

The field groups and their required roles. Every cell gets a test.

| Role       | Naming (`name`, `description`, `color`) | Cover (`thumbnailAssetId`, `thumbnailCropY`) | Settings (`faceRecognitionEnabled`, `petsEnabled`) |
| ---------- | --------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| Owner      | allow                                   | allow                                        | allow                                              |
| Editor     | **allow (changed)**                     | allow                                        | deny `ForbiddenException`                          |
| Viewer     | deny                                    | deny                                         | deny                                               |
| Non-member | deny                                    | deny                                         | deny                                               |

Plus the mixed-payload case: an **editor** sending naming + settings together is denied, and
`mocks.sharedSpace.update` is asserted **not** to have been called — proving no partial write.

### Existing tests that must change

`server/src/services/shared-space.service.spec.ts`:

| Line | Test                                                        | Action                                                                                                       |
| ---- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1141 | `should not allow editor to update name`                    | Invert — editor now succeeds                                                                                 |
| 1151 | `should not allow editor to update description`             | Invert — editor now succeeds                                                                                 |
| 1188 | `should not allow editor to update color`                   | Invert — editor now succeeds                                                                                 |
| 1200 | `should treat color update as metadata change (owner-only)` | Assertion still correct (uses a Viewer), but the title is now misleading — retitle to name the viewer denial |

### Server edge cases

- Empty DTO — no-op, no `update` call, no activity log (existing test at :1016, keep).
- Name unchanged but color changed — logs `SpaceColorChange` only, not `SpaceRename`.
- Name changed — logs `SpaceRename` with correct `oldName` / `newName`.
- Description cleared to `''` — written through, not skipped as `undefined`.
- Editor toggling `faceRecognitionEnabled` — denied, and no `SharedSpaceFaceMatchAll` job queued.

### DTO validation (server)

Against `SharedSpaceUpdateSchema`: whitespace-only name rejected (`.trim().min(1)`), name over 100 chars
rejected, description over 500 chars rejected, empty-string description accepted. `shared-space.dto.spec.ts`
already exists for this.

### Web

`space.service.spec.ts` (extends the existing file):

- `updateSpaceDetails` calls `updateSpace` with the right payload and returns `true`.
- Emits the success toast on success.
- On API failure, calls `handleError` with `errors.unable_to_update_space` and returns `false`.

`SpaceEditModal` spec:

- Prefills all three fields from the passed space.
- Saves the edited name via `updateSpaceDetails` with the right payload shape.
- Emptying description sends `''`, **not** `undefined` — the regression this design calls out.
- Submitting unchanged sends the current values without error.
- Save is disabled for an empty name **and** for a whitespace-only name (`"   "`), which native `required`
  would let through.
- Name and description inputs carry `maxlength` 100 / 500.
- The name input is focused with its text selected on open.
- A `false` return from the service leaves the modal open; a `true` return closes it.
- Color swatches are targeted by `data-testid="color-swatch-{value}"`, **not** by `aria-label` — those are
  raw lowercase enum values (`primary`, `amber`), a pre-existing wart this PR does not fix.

`space-layout.spec.ts`:

- Owner sees "Edit space" in the ⋮ menu.
- Editor sees it.
- Viewer does **not**.
- Clicking it opens the modal; a resolved edit triggers `invalidateAll`.

`space-hero` spec:

- Editor sees the ✎ menu on a space **with** a cover, containing all three items.
- Editor sees the ✎ menu on a space with **no** cover — the regression the gate change fixes — containing
  "Edit space" and "Change cover photo" but **not** "Reposition".
- Viewer sees no ✎ menu in either case.
- The empty-state "Set cover photo" button still renders for an editor on a cover-less space.

### e2e

`e2e/src/specs/server/api/shared-space.e2e-spec.ts` — an editor renames a space end to end, and an editor
is rejected when toggling `faceRecognitionEnabled`.

## Risks

- **Permission loosening.** Editors gain the ability to rename a space other members see. Mitigated by the
  activity feed already recording renames with old and new names, so the change is visible and attributable.
- **The four inverted tests.** They encode the old rule deliberately, so flipping them is the point — but
  each must be flipped to a positive assertion (editor _succeeds_, with the payload checked), not deleted.
- **The hero pencil gate change touches shipped behaviour.** Dropping `hasCover` makes the ✎ appear on
  cover-less spaces where it previously did not. That is the intended fix, but it is a visual change to an
  existing surface rather than purely additive, so the hero spec must pin both the with-cover and
  without-cover menus.
