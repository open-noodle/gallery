# Slice 7 — H2 + M4 + LOW#14: `GalleryTabShellRoute` rename misses + 3-tab index fix

**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §"Slice 7"
**Findings:** `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` H2, M4, LOW#14
**Branch / worktree:** `rebase/upstream-rolling-20260509-active`

---

## Step A — reachability investigation (findings)

### The two shell routes

| Route (`.gr.dart`)     | Page class                                                                          | `AutoTabsRouter` routes                                    | Layout                |
| ---------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------- |
| `TabShellRoute.page`   | `TabShellPage` (`lib/pages/common/tab_shell.page.dart`)                             | `[MainTimelineRoute, SpacesRoute, DriftLibraryRoute]`      | Photos / Spaces / Lib |
| `GalleryTabShellRoute` | `GalleryTabShellPage` (`lib/presentation/pages/common/gallery_tab_shell.page.dart`) | `[MainTimelineRoute, DriftAlbumsRoute, DriftLibraryRoute]` | Photos / Albums / Lib |

Both are 3-tab in the fork. They differ in the middle tab (legacy=Spaces, fork=Albums)
and their nav internals: `GalleryTabShellPage` uses `GalleryBottomNav` + `GalleryTabEnum`

- `kGalleryPhotosIndex/kGalleryAlbumsIndex/kGalleryLibraryIndex` (from
  `lib/providers/gallery_nav/gallery_tab_enum.dart`) and does its invalidations in
  `GalleryBottomNav._onTabTap`. `TabShellPage` uses the upstream `TabEnum` + the
  `constants.dart` `k*TabIndex` constants and does its invalidations in
  `_onNavigationSelected`.

### Reachability of the legacy `TabShellRoute` after the two renames

Navigation call-sites that push a shell route (grep of `mobile/lib/**/*.dart`, excl. `*.gr.dart`):

- `main.dart:210` → `GalleryTabShellRoute` (cold start)
- `splash_screen.page.dart:378` → `GalleryTabShellRoute` (clean install / resume)
- `login_form.dart:254,383` → `GalleryTabShellRoute`
- `share_intent.page.dart:68` → `GalleryTabShellRoute`
- `view_intent_handler_android.dart:100` → **`TabShellRoute`** ← H2 (fix)
- `drift_locked_folder.page.dart:46` → **`TabShellRoute`** ← M4 (fix)

Initial route is `SplashScreenRoute` (`router.dart:125 initial: true`), which
redirects to `GalleryTabShellRoute`. **After fixing the two call-sites, ZERO in-app
navigation pushes `TabShellRoute`.** Remaining textual references are non-navigational:

- `router.dart:129` — route _registration_ (config, `TabShellRoute.page`)
- `router.dart:137-138` — comment documenting the legacy block as the **rollback target**
  for the gallery-bottom-nav redesign ("rollback: remove this block and point the 5
  callsites of `GalleryTabShellRoute()` back at `TabShellRoute()`")
- `router.gr.dart` — generated class
- `memory_bottom_info.widget.dart:44` — prose comment

**Conclusion:** the legacy `TabShellRoute`/`TabShellPage` becomes unreachable via normal
in-app navigation after the rename, but it is **deliberately retained as the documented
rollback path** for the fork's bottom-nav redesign. It is therefore NOT dead code to
delete — and fixing its off-by-one is meaningful precisely because a rollback must land
on a correct 3-tab page. Flag it only as a _future_ removal candidate if/when the
gallery-bottom-nav is made permanent.

### Are `constants.dart` tab indices shared with `GalleryTabShellPage`?

**No.** `kPhotoTabIndex/kSearchTabIndex/kSpacesTabIndex/kLibraryTabIndex` are used **only**
by `tab_shell.page.dart` (grep: 4 usages, all in that file). `GalleryTabShellPage` uses its
own `kGallery*Index` fork constants. Likewise `TabEnum`/`tabProvider` are consumed only by
`tab_shell.page.dart:125` (`tabProvider` is write-only — no readers anywhere).

> ⚠️ The Slice-7 prompt's premise ("`constants.dart` values are used by the real
> GalleryTabShellPage") is **incorrect** — they are not. This does not change the fix:
> `gallery_tab_enum.dart` explicitly documents that the upstream 4-tab enum + constants are
> "kept untouched for rebase hygiene", so the off-by-one is still fixed **locally in
> `tab_shell.page.dart`** (via a fork-local helper), leaving `constants.dart` untouched.
> The fix is safe either way and does not require a decision/stop.

### Root of LOW#14

The fork converted `TabShellPage.build` to a 3-tab layout (Photos=0, Spaces=1, Library=2)
but left `_onNavigationSelected` keyed on the upstream 4-tab constants
(`kSpacesTabIndex=2`, `kLibraryTabIndex=3`). Result: tapping **Spaces** (index 1)
invalidates **nothing**; tapping **Library** (index 2) invalidates the **Spaces** provider;
index 3 never occurs. `TabEnum.values[index]` (line 125) is off-by-one too (index 1 → `search`).

---

## Step B — files / tests / impl

### Files changed

1. `mobile/lib/providers/view_intent/view_intent_handler_android.dart:100` — `TabShellRoute` → `GalleryTabShellRoute` (H2)
2. `mobile/lib/presentation/pages/drift_locked_folder.page.dart:46` — `TabShellRoute` → `GalleryTabShellRoute` (M4)
3. `mobile/lib/pages/common/tab_shell.page.dart` — extract fork-local `TabShellSection` +
   `tabShellSectionForIndex(int)`, route `_onNavigationSelected` invalidations + the
   `tabProvider` write through it (3-tab: Photos=0, Spaces=1, Library=2). `constants.dart` untouched. (LOW#14)
4. `tools/upstream-preflight/src/mobile-nav.spec.ts` — new guard.
5. `mobile/test/pages/common/tab_shell_page_test.dart` — new behavioral unit test.
6. `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` — H2/M4/LOW#14 Status → FIXED (slice S7).

### Test 1 — guard (repo-invariant), RED first

`tools/upstream-preflight/src/mobile-nav.spec.ts`: recursively scan `mobile/lib/**/*.dart`
excluding `*.gr.dart`; strip per-line `//` comments; assert **zero** matches of
`/(?<![A-Za-z])TabShellRoute\s*\(/` (bare legacy route constructor, not `GalleryTabShellRoute(`,
not `TabShellRoute.page`, not comments).

- **Expected RED:** exactly 2 offending lines — `view_intent_handler_android.dart:100`,
  `drift_locked_folder.page.dart:46`.
- **Command:** `cd tools/upstream-preflight && pnpm test -- --run src/mobile-nav.spec.ts`

### Test 2 — behavioral (pure helper), RED first

`mobile/test/pages/common/tab_shell_page_test.dart` unit-tests `tabShellSectionForIndex`:

- `tabShellSectionForIndex(0) == TabShellSection.photos`
- `tabShellSectionForIndex(1) == TabShellSection.spaces` (RED: buggy returns `other`)
- `tabShellSectionForIndex(2) == TabShellSection.library` (RED: buggy returns `spaces`)
- `tabShellSectionForIndex(3) == TabShellSection.other` and `(-1) == other` (boundary/out-of-range)

**Why a pure helper:** `_onNavigationSelected` is side-effectful (invalidations, haptic,
router mutation) and needs the full auto*route runtime, so a widget test is impractical;
the spec explicitly blesses the extract-a-pure-helper route. To make the RED demonstrate
the \_actual* off-by-one (not a bare "undefined symbol"), the helper is first introduced
mirroring the current buggy mapping (keyed on `kSpacesTabIndex=2`/`kLibraryTabIndex=3`),
which fails the Spaces→1 / Library→2 assertions, then flipped to the 3-tab mapping for GREEN.

- **Command:** `cd mobile && mise exec -- flutter test test/pages/common/tab_shell_page_test.dart`

### Minimal impl (GREEN)

- Rename the two call-sites.
- `tab_shell.page.dart`: add `enum TabShellSection { photos, spaces, library, other }` +
  `TabShellSection tabShellSectionForIndex(int)` (0/1/2/other). Route the three invalidation
  branches and the `tabProvider` write through the section (photos→home, spaces→spaces,
  library→library, other→home). Keep the Photos re-tap ScrollToTop. `constants.dart` untouched.

### Edge cases covered

- Android share/"open with" deep-link lands on the 3-tab `GalleryTabShellRoute` (H2 rename + guard).
- Locked-folder pause/resume returns to `GalleryTabShellRoute` (M4 rename + guard).
- Spaces→1, Library→2 invalidation mapping (helper test).
- Boundary (index 3, the vanished 4th tab) and out-of-range (-1) → `other` (no invalidation, no crash).
- `GalleryTabShellPage` unaffected (shares no constants; guard/tests do not touch it).

### GREEN commands

```
cd tools/upstream-preflight && pnpm test -- --run src/mobile-nav.spec.ts
cd mobile && mise exec -- flutter test test/pages/common/tab_shell_page_test.dart
cd mobile && mise exec -- dart analyze lib/providers/view_intent/view_intent_handler_android.dart lib/presentation/pages/drift_locked_folder.page.dart lib/pages/common/tab_shell.page.dart test/pages/common/tab_shell_page_test.dart
```

### Commit

`fix(mobile): route intents through GalleryTabShellRoute + 3-tab index (H2/M4/#14)`
