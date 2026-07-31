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

`create()` returns `null` when there are no owned assets for the source, matching how upstream hides
inapplicable actions.

### Port 2 — `SimilarPhotosAction`

`ActionBuilder` subclass keeping `assetId`. Its body is synchronous (invalidate the asset viewer, set
the photos filter, navigate), so it needs no toast, no selection clearing and no error handling.

Its `iconOnly` and `menuItem` flags **are dropped**. In the new model the call site picks the widget —
which is exactly what upstream did when it rewrote `action_button.utils.dart` to
`ActionMenuItem(action: AssetDebugAction(source: context.source))`.

### Call-site migration

`mobile/lib/utils/action_button.utils.dart` moves from `ActionMenuItemWidget(action: X(assets: [...]))`
to `ActionMenuItem(action: X(source: context.source))`, and the two old fork widget files are deleted.

### Testing

The fork's two buttons have **no test coverage today**. Since this is a behaviour-preserving rewrite,
tests are the safety net that makes the port verifiable rather than hopeful. Add one file per action,
modelled on upstream's `mobile/test/unit/presentation/actions/favorite_action_test.dart`:

- `create()` returns `null` when the action should not appear
- `create()` returns a correctly-labelled `ActionItem` when it should
- success path — service called with the right arguments, toast shown, selection cleared, and (for
  remove-from-space) `onComplete` fired
- failure path — `handleError` invoked, selection **not** cleared

## Risks

| Risk                                                                       | Handling                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A bulk regex corrupts the 34 lint sites, as the batch-24 scanner did twice | Analyzer-driven loop: apply, re-analyze, repeat to zero. Verify each enclosing class is a `State` before rewriting — a plain `ConsumerWidget` must keep `context.mounted` |
| The port silently changes behaviour                                        | Tests written first for the current behaviour, then the port made to satisfy them                                                                                         |
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
2. `dart format` idempotent; `flutter test` green including the new action tests.
3. The two old fork button widgets are gone and their behaviour is reachable through the new model.
4. All nine previously-held upstream commits are integrated.
5. Full CI set green.
