# Mobile action-model adoption + `use_build_context_synchronously` — design

**Date**: 2026-07-31
**Context**: releases the batch-27 quarantine on `rebase/upstream-rolling-v3.1.1`

## Problem

Two upstream commits are quarantined on the rolling branch, and because they sit at positions 4–5 of
the 12 commits that arrived mid-session, **everything after them is blocked** — including the
`js-yaml` v5 security bumps (#30440/#30441), the fourth codegen-removal commit (#30426), and the
partner-asset ownership fix (#30137). Nine commits in total.

| Commit        | What it does                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `405020eeeed` | `chore: enable use_build_context_synchronously lint (#30367)` — flips the rule to `true` and fixes 59 upstream files |
| `fe5c8ed0fb8` | `refactor: base action (#29617)` — introduces a new action model and migrates two upstream buttons onto it           |

Both touch surfaces the fork extends, so both needed a decision rather than a blind rebase.

## What the measurements showed

Neither is as large as its diffstat suggests.

### The lint is 34 fork sites, and none of them are live bugs

Enabling the rule on the current branch produces **159** violations, but **125 of them are in the 56
files upstream's own commit fixes** — they resolve on rebase. The fork sweep is **34 sites in 4
files**:

| File                                                                    | Sites |
| ----------------------------------------------------------------------- | ----: |
| `mobile/lib/pages/library/spaces/space_detail.page.dart`                |    18 |
| `mobile/lib/pages/library/spaces/space_album_detail.page.dart`          |    14 |
| `mobile/lib/utils/action_button.utils.dart`                             |     1 |
| `mobile/lib/presentation/widgets/memory/memory_bottom_info.widget.dart` |     1 |

They are **not** missing guards. The diagnostic is specific:

> Don't use 'BuildContext's across async gaps, **guarded by an unrelated 'mounted' check**. Guard a
> 'State.context' use with a 'mounted' check **on the State**, and other BuildContext use with a
> 'mounted' check on the BuildContext.

The fork writes `if (context.mounted)` inside `State` subclasses (e.g.
`_SpaceDetailPageState extends ConsumerState<SpaceDetailPage>`) where the analyzer requires the
State's own `mounted`. Runtime behaviour is already correct; only the guard **form** is wrong.

### The refactor is a gradual migration, not a rewrite

`base_action_button.widget.dart` **survives**. Upstream added a parallel model and migrated only two
of its own buttons, deleting just `favorite_action_button.widget.dart` and
`unfavorite_action_button.widget.dart`. The fork's `addToSpace` / `removeFromSpace` on
`action.provider.dart` and `removeFromSpace` on `action.service.dart` are untouched.

So the fork's two buttons would keep compiling untouched. Porting them is a deliberate choice to stay
on upstream's path rather than a forced migration.

## Decisions

1. **Take both commits**, in upstream order, as one arc — then the nine held commits flow in the same
   pass.
2. **Fix all 34 lint sites and keep the rule enabled.** The rule does catch genuine async-gap bugs;
   these particular sites just aren't examples. Disabling it (as the fork does for
   `always_put_control_body_on_new_line`) would forfeit that for no benefit.
3. **Port both fork action buttons onto the new model now**, rather than leaving them on the
   surviving `BaseActionButton` path. Avoids a second migration when upstream eventually deletes it.

## Design

### The upstream model

An action splits into **data** and **presentation**:

```dart
class ActionItem {
  final IconData icon;
  final String label;
  final FutureOr<void> Function() onAction;
  final FutureOr<void> Function()? onSecondaryAction;
}

abstract class ActionBuilder {
  // null when the action is not applicable for the current context
  ActionItem? create(BuildContext context, WidgetRef ref);
}

abstract class AssetActionBuilder extends ActionBuilder {
  final ActionSource source;
}
```

`ActionWidget` subclasses (`ActionColumnButton`, `ActionIconButton`, `ActionMenuItem`) render whatever
`create()` returns, and render nothing when it returns `null`.

The template to follow is `mobile/lib/presentation/actions/favorite.action.dart`: a private
`Provider.family.autoDispose` derives applicability + payload from `ownedAssetsActionProvider(source)`
and returns `null` when the action does not apply; the work method resolves services **before** any
await and reports through `toastServiceProvider` / `handleError`.

### Port 1 — `RemoveFromSpaceAction`

`AssetActionBuilder` subclass, adding two fields beyond `source`:

- **`spaceId`** — required; the action is space-scoped.
- **`onComplete`** — kept as a builder field. `space_bottom_sheet.widget.dart` passes
  `widget.onAssetsRemoved` and genuinely needs the hook. Upstream's `ActionItem` has no completion
  callback, and inventing one into the shared model to serve a single fork call site is the wrong
  trade; a fork-local field is honest and contained.

Behaviour is preserved: call `removeFromSpace`, toast the result, clear selection, fire `onComplete`.
What changes is the plumbing — `toastServiceProvider` instead of `ImmichToast.show(context: ...)`,
`clearSelectionProvider(source)` instead of `multiSelectProvider.notifier.reset()`, `handleError` on
failure. That removes the button's `BuildContext`-across-async-gap handling entirely.

#### Hard constraint: removal is **not** owner-scoped

`ActionNotifier.removeFromSpace` uses `_getRemoteIdsForSource(source)`, **not**
`_getOwnedRemoteIdsForSource`. Removing an asset from a Shared Space is not deleting it, so a space
editor may remove another member's photo. This is deliberate fork behaviour.

Upstream's `AssetActionBuilder` template (`favorite.action.dart`) derives its state from
`ownedAssetsActionProvider(source)`. **Following that template naively would silently make
remove-from-space owner-only and break editors managing a multi-owner space.**

`RemoveFromSpaceAction` must therefore derive from `assetsActionProvider(source)` — all remote assets
for the source — and `create()` returns `null` only when the selection contains no remote assets.
A test pins this explicitly (see Testing).

### Port 2 — `SimilarPhotosAction`

`ActionBuilder` subclass keeping `assetId`. Its body is synchronous (invalidate the asset viewer, set
the photos filter, navigate), so it needs no toast, no selection clearing and no error handling.

Its `iconOnly` and `menuItem` flags **are dropped**. In the new model the call site picks the widget —
which is exactly what upstream did when it rewrote `action_button.utils.dart` to
`ActionMenuItem(action: AssetDebugAction(source: context.source))`.

### Call-site migration

`mobile/lib/utils/action_button.utils.dart` moves from `ActionMenuItemWidget(action: X(assets: [...]))`
to `ActionMenuItem(action: X(source: context.source))`, and the two old fork widget files are deleted.

### Testing — TDD

The fork's two buttons have **no test coverage today**, and this is a behaviour-preserving rewrite of
working code. Tests are therefore written **first**, against the _current_ behaviour, and must fail
before the port exists.

**Cycle, per action:**

1. **RED** — write the test file against the new API (`RemoveFromSpaceAction` / `SimilarPhotosAction`).
   It fails to compile, because the action does not exist yet. That is the red state.
2. **GREEN** — write the minimum action code to make every test pass.
3. **REFACTOR** — delete the old widget file and migrate call sites; tests stay green throughout.

Do not write the action first and add tests after. The whole value here is catching a silent
behavioural drift — like the ownership constraint above — and a test written after the code tends to
encode whatever the code already does.

**Harness** (all arrives with `fe5c8ed0fb8`):
`mobile/test/unit/presentation/presentation_context.dart` — `PresentationContext.create()`,
`context.selected(assets)`, `context.currentUser`, and `tester.pumpTestAction(...)` /
`tester.pumpTestWidget(...)`. Asset fixtures come from `RemoteAssetFactory.create(ownerId: …)`.
`service.mocks.dart` needs a mock registered for the fork's shared-space path.

#### `RemoveFromSpaceAction` — required cases

| #   | Case                                          | Assertion                                                                                                                                                                                                |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Empty selection                               | `create()` returns `null` — action hidden                                                                                                                                                                |
| 2   | Selection has no **remote** assets            | hidden (local-only assets cannot be in a space)                                                                                                                                                          |
| 3   | **Selection includes assets owned by others** | `removeFromSpace` called with **all** remote ids, not just owned — the constraint above                                                                                                                  |
| 4   | Correct `spaceId` threaded                    | service called with the action's `spaceId`, not the current space                                                                                                                                        |
| 5   | Success                                       | success toast carrying the removed **count** from `ActionResult.count`                                                                                                                                   |
| 6   | Result `success == false`                     | error toast                                                                                                                                                                                              |
| 7   | Service **throws**                            | `handleError` invoked; no unhandled exception escapes                                                                                                                                                    |
| 8   | Selection clearing                            | matches current behaviour — cleared after the call **regardless** of success (current code calls `reset()` unconditionally). If this is judged wrong, change it deliberately and record it, not silently |
| 9   | `onComplete` fired                            | fired exactly once, with the same unconditional timing as today                                                                                                                                          |
| 10  | `onComplete` is `null`                        | no crash — it is optional                                                                                                                                                                                |
| 11  | `source == viewer`                            | `clearSelectionProvider` is a no-op there; must not throw                                                                                                                                                |

#### `SimilarPhotosAction` — required cases

| #   | Case                           | Assertion                                                                               |
| --- | ------------------------------ | --------------------------------------------------------------------------------------- |
| 1   | Visible with a valid `assetId` | `create()` returns an `ActionItem` with the `view_similar_photos` label                 |
| 2   | Invalidates the asset viewer   | `assetViewerProvider` invalidated before navigation                                     |
| 3   | Sets the filter                | `photosFilterProvider.notifier.setSimilarTo(assetId)` called with the right id          |
| 4   | Navigates                      | routes to `MainTimelineRoute`                                                           |
| 5   | Ordering                       | filter is set **before** navigation, or the timeline opens unfiltered                   |
| 6   | Rendered as a menu item        | call site wrapping in `ActionMenuItem` renders, replacing the old `menuItem: true` flag |

#### Lint sweep — verification, not unit tests

The 34 sites are behaviour-preserving, so the analyzer is the oracle: `dart analyze --fatal-infos lib
test` must reach zero with the rule enabled, and `flutter test` must stay green. Three edge cases must
be checked **per site** rather than bulk-replaced:

- **Enclosing class is a `State`** → `mounted` is correct.
- **Enclosing class is a plain `ConsumerWidget`/`StatelessWidget`** → it has no `mounted`; keep
  `context.mounted`.
- **The guarded use is a _different_ `BuildContext`** — e.g. the `ctx` of a
  `showModalBottomSheet(builder: (ctx) => …)` or a dialog builder. Guarding that with the State's
  `mounted` is the same "unrelated mounted check" defect in reverse, and the analyzer will keep
  complaining. These need `ctx.mounted`.

## Risks

| Risk                                                                       | Handling                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A bulk regex corrupts the 34 lint sites, as the batch-24 scanner did twice | Analyzer-driven loop: apply, re-analyze, repeat to zero. Verify each enclosing class is a `State` before rewriting — a plain `ConsumerWidget` must keep `context.mounted` |
| The port silently changes behaviour                                        | TDD: tests written first against current behaviour and failing, then the port made to satisfy them                                                                        |
| Following upstream's template makes removal owner-only                     | Hard constraint above + case 3 in the RemoveFromSpaceAction table: derive from `assetsActionProvider`, never `ownedAssetsActionProvider`                                  |
| `onComplete` has no equivalent in the new model                            | Kept as a fork-local builder field; not pushed into upstream's shared `ActionItem`                                                                                        |
| Nine commits land at once after the gate opens                             | Rebase batch-by-batch with the existing audits between each, as in arcs 1–3                                                                                               |

## Out of scope

- Porting other fork surfaces onto the action model. Only the two buttons upstream's refactor makes
  relevant.
- Re-litigating `always_put_control_body_on_new_line`, which stays disabled per the fork's existing
  decision.
- Landing the rolling branch on `main` — a separate decision needing the ruleset bypass lever.

## Success criteria

1. `dart analyze --fatal-infos lib test` clean with `use_build_context_synchronously: true`.
2. `dart format` idempotent; `flutter test` green with every **distinct behaviour** in the two tables
   above covered. Cases that reduce to an already-tested branch may be folded together, provided the
   reduction is recorded in the implementation plan. Writing two tests that exercise one branch is
   not coverage — the review rubric treats duplicated assertions as a defect in their own right.
3. The two old fork button widgets are gone and their behaviour is reachable through the new model.
4. All nine previously-held upstream commits are integrated.
5. Full CI set green.
