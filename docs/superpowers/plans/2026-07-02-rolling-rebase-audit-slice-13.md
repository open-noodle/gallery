# Slice 13 — LOW#8: restore branded `LoadingSpinner` in `ActivityViewer` + `DetailPanel`

**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §"Slice 13"
**Findings:** `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` LOW#8
**Branch / worktree:** `rebase/upstream-rolling-20260509-active`

---

## Step A — ground truth

The fork swaps upstream `@immich/ui`'s generic `LoadingSpinner` for a fork-local,
branded one (`web/src/lib/components/shared-components/LoadingSpinner.svelte`,
which renders `/gallery-loader.svg`) at call-sites throughout the themed app shell.
Not every `LoadingSpinner` usage is swapped, though — some are intentionally left on
the generic `@immich/ui` one.

### The "swapped set" (25 files) — imports the fork-local spinner

`grep -rn "LoadingSpinner" web/src --include="*.svelte" | grep "shared-components/LoadingSpinner"`
turns up 23 files that already do:

```
import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
```

- `web/src/lib/modals/PeoplePickerModal.svelte`
- `web/src/lib/modals/PartnerSelectionModal.svelte`
- `web/src/lib/modals/SpaceAddMemberModal.svelte`
- `web/src/lib/modals/MapModal.svelte`
- `web/src/lib/modals/UserGroupModal.svelte`
- `web/src/lib/modals/AlbumAddUsersModal.svelte`
- `web/src/lib/components/spaces/space-search-results.svelte`
- `web/src/lib/components/faces-page/AssignFaceSidePanel.svelte`
- `web/src/lib/components/faces-page/PersonSidePanel.svelte`
- `web/src/lib/components/asset-viewer/ImagePanoramaViewer.svelte`
- `web/src/lib/components/asset-viewer/VideoPanoramaViewer.svelte`
- `web/src/lib/components/asset-viewer/VideoNativeViewer.svelte`
- `web/src/lib/components/asset-viewer/VideoRemoteViewer.svelte`
- `web/src/lib/components/assets/thumbnail/VideoThumbnail.svelte`
- `web/src/lib/elements/SearchBar.svelte`
- `web/src/routes/admin/system-settings/StorageTemplateSettings.svelte`
- `web/src/routes/admin/system-settings/TemplateSettings.svelte`
- `web/src/routes/admin/queues/[name]/QueueGraph.svelte`
- `web/src/routes/(user)/user-settings/OauthSettings.svelte`
- `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- `web/src/routes/(user)/utilities/geolocation/+page.svelte`
- `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- `web/src/routes/(user)/memories/+page.svelte`

Plus the 2 that **should** be in this set but aren't (the rebase drop):

- `web/src/lib/components/asset-viewer/ActivityViewer.svelte` — imports `LoadingSpinner`
  from `@immich/ui` (line 16: `import { Icon, IconButton, LoadingSpinner, Textarea, toastManager } from '@immich/ui';`)
- `web/src/lib/components/asset-viewer/DetailPanel.svelte` — same
  (line 27: `import { Icon, IconButton, Link, LoadingSpinner, Text } from '@immich/ui';`)

23 + 2 = **25**, matching the finding's "25 files" claim exactly. This confirms the
scope: fix exactly these two.

### Files that intentionally keep the generic `@immich/ui` spinner (NOT part of the swap)

These 9 import `LoadingSpinner` from `@immich/ui` and are **out of scope** — the guard
must not flag them:

- `web/src/lib/modals/GeolocationPointPickerModal.svelte`
- `web/src/lib/modals/PluginMethodPicker.svelte`
- `web/src/lib/modals/CreateFaceModal.svelte`
- `web/src/lib/components/DelayedLoadingSpinner.svelte` (a thin wrapper *around*
  `@immich/ui`'s spinner that adds a display delay; several of the swapped-set files
  compose through this wrapper rather than importing the fork-local spinner directly —
  e.g. `AdaptiveImage.svelte`, `MemoryPhotoViewer.svelte`)
- `web/src/lib/components/album-page/AlbumThumbnail.svelte`
- `web/src/lib/components/people/representative-face-tile.svelte`
- `web/src/lib/components/shared-components/side-bar/StorageSpace.svelte`
- `web/src/routes/auth/logout/+page.svelte`
- `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`

(`people-merge-selector.svelte` / `people-visibility-modal.svelte` mention
"LoadingSpinner" only as a local boolean variable name feeding a `Button`'s `loading`
prop — no spinner import at all, irrelevant here.)

---

## Step B — files / tests / impl

### Files changed

1. `tools/upstream-preflight/src/branded-spinner.spec.ts` — new guard (repo-invariant
   import scan over `web/src`).
2. `web/src/lib/components/asset-viewer/ActivityViewer.svelte` — swap the
   `LoadingSpinner` import to the fork-local component.
3. `web/src/lib/components/asset-viewer/DetailPanel.svelte` — same.

### Test — guard (repo-invariant), RED first

`tools/upstream-preflight/src/branded-spinner.spec.ts`: recursively scan
`web/src/**/*.svelte`. For each file, find `import`-statement usages of the
identifier `LoadingSpinner`, classify by source specifier
(`$lib/components/shared-components/LoadingSpinner.svelte` vs `@immich/ui`). Assert:

- Every file in the fixed "swapped set" list (the 23 above + `ActivityViewer.svelte` +
  `DetailPanel.svelte` = 25) imports the fork-local spinner, not `@immich/ui`'s.
- (Regression guard) none of those 25 import `LoadingSpinner` from `@immich/ui`.

The out-of-scope 9 files are simply not part of the asserted set, so they can freely
keep importing the generic spinner without failing the guard.

- **Expected RED:** 2 failures — `ActivityViewer.svelte` and `DetailPanel.svelte` import
  `@immich/ui`'s `LoadingSpinner` instead of the fork-local one.
- **Command:** `cd tools/upstream-preflight && npx vitest run src/branded-spinner.spec.ts`

### Minimal impl (GREEN)

In both files, replace:

```svelte
import { Icon, IconButton, LoadingSpinner, Textarea, toastManager } from '@immich/ui';
```

(`ActivityViewer.svelte`) and

```svelte
import { Icon, IconButton, Link, LoadingSpinner, Text } from '@immich/ui';
```

(`DetailPanel.svelte`) with the `LoadingSpinner` name dropped from the `@immich/ui`
destructure, plus a new top-level import matching the other 23 files exactly:

```svelte
import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
```

No other code in either file changes — both already use `<LoadingSpinner />` (or with
props) as a plain component reference, and the fork-local component is a drop-in
(same default-export component shape) for the subset of props these two call-sites use.

### Edge cases covered

- Both call-sites' actual `<LoadingSpinner ... />` usages are inspected before the swap
  to confirm they only pass props the fork-local component supports (it does — same
  `size`/`class` style props as the rest of the swapped set already uses).
- Guard also asserts the whole 25-file swapped set (not just the 2 fixed files), so a
  future rebase regressing any *other* file's swap is caught too — not just these two.
- The 9 intentionally-generic files are excluded from the asserted set so the guard
  isn't brittle / doesn't force spinner choices that aren't part of this finding.

### GREEN commands

```
cd tools/upstream-preflight && npx vitest run src/branded-spinner.spec.ts
cd web && pnpm check
```

### Commit

`fix(web): restore branded LoadingSpinner in ActivityViewer/DetailPanel (LOW #8)`
