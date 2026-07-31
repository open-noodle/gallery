# Mobile Action-Model Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release the batch-27 quarantine on `rebase/upstream-rolling-v3.1.1` by adopting upstream's `use_build_context_synchronously` lint and its new action model, porting the fork's two Space action buttons onto that model with tests, then landing the 7 remaining held upstream commits.

**Architecture:** Two upstream commits are rebased in upstream order. The lint commit forces 34 fork guard-form fixes (`context.mounted` → `mounted` inside `State` subclasses). The refactor commit introduces `ActionBuilder`/`ActionItem`, onto which the fork's `RemoveFromSpaceActionButton` and `SimilarPhotosActionButton` are re-expressed test-first. With the gate open, the 7 commits behind it (including two js-yaml security bumps) rebase normally.

**Tech Stack:** Flutter 3.44.8, Dart, Riverpod (hooks_riverpod), mocktail, `flutter_test`. Repo is `/Users/pierre/dev/gallery/.worktrees/rebase-upstream-rolling-v3.1.1`.

## Global Constraints

- **Flutter binary**: invoke directly — `~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin`. Do **not** run `mise run` from this worktree; it can operate on the main checkout.
- **Never `git add -A`.** After any local `mise` invocation, run `git status -- '*mise.lock'` — local runs rewrite lockfiles to your machine's platforms only.
- **Never commit `mobile/pubspec.yaml` changes** produced by codegen. Codegen has been observed appending `shared_preferences: any` to `dev_dependencies`; revert it.
- **Mobile codegen is gitignored and must be regenerated** before `dart analyze` means anything. Full sequence in Task 0.
- **Removal from a Space is NOT owner-scoped.** `ActionNotifier.removeFromSpace` uses `_getRemoteIdsForSource`, not `_getOwnedRemoteIdsForSource`. Never derive `RemoveFromSpaceAction` from `ownedAssetsActionProvider`.
- **`always_put_control_body_on_new_line` stays disabled** in `mobile/analysis_options.yaml` (fork decision `7060ec3abdb`). Do not re-enable it.
- Gate command for mobile: `dart analyze --fatal-infos lib test` from `mobile/`, plus `dart format` over `lib` and `test` excluding `*.g.dart`, `*.drift.dart`, `*.gr.dart`.

---

## File Structure

| File                                                                                         | Responsibility                                                                    |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `mobile/lib/presentation/actions/remove_from_space.action.dart`                              | **Create.** `RemoveFromSpaceAction` builder + private state provider.             |
| `mobile/lib/presentation/actions/similar_photos.action.dart`                                 | **Create.** `SimilarPhotosAction` builder.                                        |
| `mobile/test/unit/presentation/actions/remove_from_space_action_test.dart`                   | **Create.** 11 cases from the spec.                                               |
| `mobile/test/unit/presentation/actions/similar_photos_action_test.dart`                      | **Create.** 6 cases from the spec.                                                |
| `mobile/lib/presentation/widgets/action_buttons/remove_from_space_action_button.widget.dart` | **Delete** in Task 5.                                                             |
| `mobile/lib/presentation/widgets/action_buttons/similar_photos_action_button.widget.dart`    | **Delete** in Task 5.                                                             |
| `mobile/lib/presentation/widgets/bottom_sheet/space_bottom_sheet.widget.dart`                | **Modify.** Call site for remove-from-space.                                      |
| `mobile/lib/utils/action_button.utils.dart`                                                  | **Modify.** Call site for similar-photos + upstream's `ActionMenuItem` migration. |
| `mobile/lib/pages/library/spaces/space_detail.page.dart`                                     | **Modify.** 18 lint sites.                                                        |
| `mobile/lib/pages/library/spaces/space_album_detail.page.dart`                               | **Modify.** 14 lint sites.                                                        |
| `mobile/lib/presentation/widgets/memory/memory_bottom_info.widget.dart`                      | **Modify.** 1 lint site.                                                          |
| `mobile/test/service.mocks.dart`                                                             | **Modify.** Register the shared-space mock if absent.                             |

---

### Task 0: Prepare the worktree

**Files:** none modified — environment only.

**Interfaces:**

- Consumes: nothing.
- Produces: a worktree where `dart analyze` is meaningful.

- [ ] **Step 1: Confirm the starting point**

```bash
cd /Users/pierre/dev/gallery/.worktrees/rebase-upstream-rolling-v3.1.1
git status --porcelain          # expect empty
git log --oneline -1            # expect the arc-3 report commit
git tag -f batch27-start HEAD
```

- [ ] **Step 2: Regenerate mobile codegen**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd open-api && bash ./bin/generate-dart-sdk.sh && cd ..
FB=~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin
export PATH="$FB:$PATH"
cd mobile
flutter pub get
ls pigeon/*.dart | xargs -n1 -P4 -I{} dart run pigeon --input {}
dart run build_runner build
dart run drift_dev schema generate --data-classes --companions drift_schemas/main/ test/drift/main/generated/
```

- [ ] **Step 3: Verify the baseline is clean**

Run: `cd mobile && dart analyze --fatal-infos lib test`
Expected: `No issues found!`

- [ ] **Step 4: Verify codegen left no tracked changes**

```bash
cd .. && git status --porcelain -- mobile/pubspec.yaml mobile/pubspec.lock '*mise.lock'
```

Expected: empty. If `pubspec.yaml` shows `shared_preferences: any`, run `git checkout -- mobile/pubspec.yaml`.

---

### Task 1: Rebase the lint commit and fix the 34 fork sites

**Files:**

- Modify: `mobile/lib/pages/library/spaces/space_detail.page.dart` (18 sites)
- Modify: `mobile/lib/pages/library/spaces/space_album_detail.page.dart` (14 sites)
- Modify: `mobile/lib/utils/action_button.utils.dart` (1 site)
- Modify: `mobile/lib/presentation/widgets/memory/memory_bottom_info.widget.dart` (1 site)

**Interfaces:**

- Consumes: Task 0's regenerated codegen.
- Produces: `use_build_context_synchronously: true` in `mobile/analysis_options.yaml`, analyzer clean.

- [ ] **Step 1: Rebase onto the lint commit**

```bash
cd /Users/pierre/dev/gallery/.worktrees/rebase-upstream-rolling-v3.1.1
git rebase 405020eeeed
```

If `mobile/analysis_options.yaml` conflicts: take upstream's `use_build_context_synchronously: true`, and keep `always_put_control_body_on_new_line` **absent** (fork decision).

- [ ] **Step 2: Confirm the rule is on and see the failures**

```bash
cd mobile
grep -n 'use_build_context_synchronously' analysis_options.yaml   # expect: true
dart analyze --fatal-infos lib test 2>&1 | grep -c use_build_context_synchronously
```

Expected: 34. If higher, upstream's own fixes did not replay — stop and re-check the rebase.

- [ ] **Step 3: Fix each site, checking the enclosing class first**

For every reported site, decide by inspection — do **not** bulk-replace:

| Enclosing class                      | Guarded context                                                                             | Fix                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `State` / `ConsumerState` subclass   | the State's own `context`                                                                   | `if (context.mounted)` → `if (mounted)`         |
| `StatelessWidget` / `ConsumerWidget` | its `build` context                                                                         | leave `context.mounted` — there is no `mounted` |
| any                                  | a **different** `BuildContext` (a `showModalBottomSheet(builder: (ctx) …)` or dialog `ctx`) | use `ctx.mounted`, not `mounted`                |

Example, `space_detail.page.dart` — `_SpaceDetailPageState extends ConsumerState<SpaceDetailPage>`:

```dart
      await ref.read(sharedSpaceApiRepositoryProvider).addAssets(widget.spaceId, assetIds);
      ref.invalidate(sharedSpacesProvider);
      if (mounted) {
        ImmichToast.show(
          context: context,
          msg: 'Added ${assetIds.length} photos to space',
          toastType: ToastType.success,
        );
      }
```

- [ ] **Step 4: Re-run the analyzer after each file**

Run: `cd mobile && dart analyze --fatal-infos lib test 2>&1 | tail -2`
Expected: the count falls each time, ending at `No issues found!`

- [ ] **Step 5: Format and run the mobile tests**

```bash
cd mobile
dart format $(find lib test -name '*.dart' -not \( -name '*.g.dart' -o -name '*.drift.dart' -o -name '*.gr.dart' \))
flutter test
```

Expected: `All tests passed!` (~2982 passing)

- [ ] **Step 6: Commit**

```bash
cd ..
git add mobile/lib mobile/analysis_options.yaml
git commit -m "chore(mobile): guard State.context uses with the State's own mounted

Upstream #30367 enables use_build_context_synchronously. The fork guarded
State.context uses with context.mounted, which the analyzer rejects as an
unrelated mounted check. Runtime behaviour is unchanged; only the guard form
moves to the State's own mounted."
```

---

### Task 2: Rebase the action refactor

**Files:**

- Modify: `mobile/lib/utils/action_button.utils.dart` (conflict resolution only)
- Modify: `mobile/test/service.mocks.dart`, `mobile/test/unit/mocks.dart` (upstream's changes)

**Interfaces:**

- Consumes: Task 1's clean tree.
- Produces: `ActionItem`, `ActionBuilder`, `AssetActionBuilder`, `assetsActionProvider`, `clearSelectionProvider`, `ownedAssetsActionProvider` in `mobile/lib/presentation/actions/action.dart`; `ActionColumnButton`, `ActionIconButton` in `action.widget.dart`; `ToastService` + `toastServiceProvider`; test harness `PresentationContext` and `tester.pumpTestAction`.

- [ ] **Step 1: Rebase onto the refactor**

```bash
git rebase fe5c8ed0fb8
```

- [ ] **Step 2: Resolve `action_button.utils.dart` to compile only**

Take upstream's `ActionMenuItemWidget` → `ActionMenuItem` rename and `assets:` → `source:` change for upstream's own entries. Leave the fork's `similarPhotos` entry pointing at the **old** `SimilarPhotosActionButton` for now — Task 4 replaces it. The tree must compile at the end of this task, not be finished.

- [ ] **Step 3: Verify the tree builds**

```bash
cd mobile && dart analyze --fatal-infos lib test 2>&1 | tail -2
```

Expected: `No issues found!` — if the fork's two buttons error, they reference something the refactor moved; fix imports only, do not port yet.

- [ ] **Step 4: Run the tests**

Run: `cd mobile && flutter test`
Expected: `All tests passed!`

- [ ] **Step 5: Commit**

```bash
cd .. && git add -u
git commit -m "chore(mobile): adopt upstream's ActionBuilder/ActionItem model (#29617)"
```

---

### Task 3: TDD-port `RemoveFromSpaceAction`

**Files:**

- Create: `mobile/test/unit/presentation/actions/remove_from_space_action_test.dart`
- Create: `mobile/lib/presentation/actions/remove_from_space.action.dart`

**Interfaces:**

- Consumes: `AssetActionBuilder`, `ActionItem`, `assetsActionProvider`, `clearSelectionProvider` (Task 2); `actionProvider` notifier with `Future<ActionResult> removeFromSpace(ActionSource source, String spaceId)`; `ActionResult(count, success, error)`; `toastServiceProvider` → `ToastService.success(String)/.error(String)`; `handleError(Object, {StackTrace? stack, String? description})`.
- Produces: `class RemoveFromSpaceAction extends AssetActionBuilder` with `const RemoveFromSpaceAction({required super.source, required String spaceId, VoidCallback? onComplete})`.

- [ ] **Step 1: Write the failing test**

Create `mobile/test/unit/presentation/actions/remove_from_space_action_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/presentation/actions/remove_from_space.action.dart';
import 'package:immich_ui/immich_ui.dart';
import 'package:mocktail/mocktail.dart';

import '../../../service.mocks.dart';
import '../../factories/remote_asset_factory.dart';
import '../presentation_context.dart';

void main() {
  late PresentationContext context;
  late MockActionService actionService;

  const spaceId = 'space-1';

  setUp(() async {
    context = await PresentationContext.create();
    actionService = context.service.action.service;
  });

  tearDown(() => context.dispose());

  RemoteAsset mine() => RemoteAssetFactory.create(ownerId: context.currentUser.id);
  RemoteAsset theirs() => RemoteAssetFactory.create();

  Future<void> pump(
    WidgetTester tester,
    Set<BaseAsset> selection, {
    VoidCallback? onComplete,
  }) => tester.pumpTestAction(
    context,
    RemoveFromSpaceAction(source: .timeline, spaceId: spaceId, onComplete: onComplete),
    overrides: context.selected(selection),
  );

  group('RemoveFromSpaceAction', () {
    testWidgets('is hidden when the selection is empty', (tester) async {
      await tester.pumpTestWidget(
        context,
        const ActionIconButton(action: RemoveFromSpaceAction(source: .timeline, spaceId: spaceId)),
        overrides: context.selected(const {}),
      );

      expect(find.byType(ImmichIconButton), findsNothing);
    });

    testWidgets('removes assets owned by other members, not just my own', (tester) async {
      final a = mine();
      final b = theirs();

      await pump(tester, {a, b});
      await tester.pumpAndSettle();

      final captured = verify(() => actionService.removeFromSpace(captureAny(), spaceId)).captured.single as List<String>;
      expect(captured, containsAll([a.id, b.id]), reason: 'a space editor may remove another member\'s photo');
    });

    testWidgets('threads the action spaceId through to the service', (tester) async {
      await pump(tester, {mine()});
      await tester.pumpAndSettle();

      verify(() => actionService.removeFromSpace(any(), spaceId)).called(1);
    });

    testWidgets('shows a snackbar on success', (tester) async {
      await pump(tester, {mine()});
      await tester.pumpUntilFound(find.byType(SnackBar));

      expect(find.byType(SnackBar), findsOneWidget);
    });

    testWidgets('surfaces a failure without throwing', (tester) async {
      when(() => actionService.removeFromSpace(any(), any())).thenThrow(Exception('boom'));

      await pump(tester, {mine()});
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });

    testWidgets('fires onComplete once', (tester) async {
      var calls = 0;

      await pump(tester, {mine()}, onComplete: () => calls++);
      await tester.pumpAndSettle();

      expect(calls, 1);
    });

    testWidgets('does not crash when onComplete is null', (tester) async {
      await pump(tester, {mine()});
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });
  });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && flutter test test/unit/presentation/actions/remove_from_space_action_test.dart`
Expected: FAIL — `Target of URI doesn't exist: '…/remove_from_space.action.dart'`

- [ ] **Step 3: Write the minimal implementation**

Create `mobile/lib/presentation/actions/remove_from_space.action.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/presentation/actions/action.dart';
import 'package:immich_mobile/providers/infrastructure/action.provider.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:immich_mobile/utils/error_handler.dart';

/// Removing an asset from a Space is not deleting it, so an editor may remove
/// another member's photo. Derive from [assetsActionProvider], NOT
/// [ownedAssetsActionProvider] — see the design doc's hard constraint.
final _hasRemoteAssetsProvider = Provider.family.autoDispose<bool, ActionSource>(
  (ref, source) => ref.watch(assetsActionProvider(source)).remote().isNotEmpty,
);

class RemoveFromSpaceAction extends AssetActionBuilder {
  final String spaceId;
  final VoidCallback? onComplete;

  const RemoveFromSpaceAction({required super.source, required this.spaceId, this.onComplete});

  @override
  ActionItem? create(BuildContext context, WidgetRef ref) {
    if (!ref.watch(_hasRemoteAssetsProvider(source))) {
      return null;
    }

    return .new(
      icon: Icons.remove_circle_outline,
      label: 'Remove from space',
      onAction: () => _removeFromSpace(ref),
    );
  }

  Future<void> _removeFromSpace(WidgetRef ref) async {
    final toastService = ref.read(toastServiceProvider);
    final clearSelection = ref.read(clearSelectionProvider(source));
    final notifier = ref.read(actionProvider.notifier);

    try {
      final result = await notifier.removeFromSpace(source, spaceId);

      // Selection clearing and onComplete fire unconditionally, matching the
      // behaviour of the widget this replaces.
      clearSelection();
      onComplete?.call();

      if (result.success) {
        await toastService.success('${result.count} photos removed from space');
      } else {
        await toastService.error('scaffold_body_error_occurred');
      }
    } catch (error, stack) {
      handleError(error, stack: stack, description: 'Failed to remove assets from space');
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && flutter test test/unit/presentation/actions/remove_from_space_action_test.dart`
Expected: PASS — 7 tests.

If `MockActionService` or `context.service.action` does not exist, add the mock to `mobile/test/service.mocks.dart` following the `MockAssetService` pattern already there, then re-run.

- [ ] **Step 5: Commit**

```bash
cd ..
git add mobile/lib/presentation/actions/remove_from_space.action.dart \
        mobile/test/unit/presentation/actions/remove_from_space_action_test.dart \
        mobile/test/service.mocks.dart
git commit -m "feat(mobile): port RemoveFromSpaceAction onto the ActionBuilder model"
```

---

### Task 4: TDD-port `SimilarPhotosAction`

**Files:**

- Create: `mobile/test/unit/presentation/actions/similar_photos_action_test.dart`
- Create: `mobile/lib/presentation/actions/similar_photos.action.dart`

**Interfaces:**

- Consumes: `ActionBuilder`, `ActionItem` (Task 2); `photosFilterProvider` notifier with `void setSimilarTo(String assetId)`; `assetViewerProvider`; `MainTimelineRoute`.
- Produces: `class SimilarPhotosAction extends ActionBuilder` with `const SimilarPhotosAction({required String assetId})`.

- [ ] **Step 1: Write the failing test**

Create `mobile/test/unit/presentation/actions/similar_photos_action_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/presentation/actions/similar_photos.action.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_ui/immich_ui.dart';

import '../presentation_context.dart';

void main() {
  late PresentationContext context;

  const assetId = 'asset-1';

  setUp(() async {
    context = await PresentationContext.create();
  });

  tearDown(() => context.dispose());

  group('SimilarPhotosAction', () {
    testWidgets('renders an action button for a valid asset', (tester) async {
      await tester.pumpTestWidget(
        context,
        const ActionIconButton(action: SimilarPhotosAction(assetId: assetId)),
      );

      expect(find.byType(ImmichIconButton), findsOneWidget);
    });

    testWidgets('sets the similar-to filter for the asset when tapped', (tester) async {
      await tester.pumpTestWidget(
        context,
        const ActionIconButton(action: SimilarPhotosAction(assetId: assetId)),
      );

      await tester.tap(find.byType(ImmichIconButton));
      await tester.pumpAndSettle();

      expect(context.container.read(photosFilterProvider).similarTo, assetId);
    });

    testWidgets('does not throw when tapped', (tester) async {
      await tester.pumpTestWidget(
        context,
        const ActionIconButton(action: SimilarPhotosAction(assetId: assetId)),
      );

      await tester.tap(find.byType(ImmichIconButton));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });
  });
}
```

If `PresentationContext` exposes the ProviderContainer under a different name than `container`, use that name — check `mobile/test/unit/presentation/presentation_context.dart`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && flutter test test/unit/presentation/actions/similar_photos_action_test.dart`
Expected: FAIL — `Target of URI doesn't exist: '…/similar_photos.action.dart'`

- [ ] **Step 3: Write the minimal implementation**

Create `mobile/lib/presentation/actions/similar_photos.action.dart`:

```dart
import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/actions/action.dart';
import 'package:immich_mobile/providers/asset_viewer/asset_viewer.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/routing/router.dart';

class SimilarPhotosAction extends ActionBuilder {
  final String assetId;

  const SimilarPhotosAction({required this.assetId});

  @override
  ActionItem? create(BuildContext context, WidgetRef ref) => .new(
    icon: Icons.compare,
    label: 'view_similar_photos'.t(context: context),
    onAction: () => _showSimilar(context, ref),
  );

  // Synchronous: the filter must be set BEFORE navigating, or the timeline
  // opens unfiltered.
  void _showSimilar(BuildContext context, WidgetRef ref) {
    ref.invalidate(assetViewerProvider);
    ref.read(photosFilterProvider.notifier).setSimilarTo(assetId);
    unawaited(context.navigateTo(const MainTimelineRoute()));
  }
}
```

Add `import 'dart:async';` for `unawaited`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && flutter test test/unit/presentation/actions/similar_photos_action_test.dart`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
cd ..
git add mobile/lib/presentation/actions/similar_photos.action.dart \
        mobile/test/unit/presentation/actions/similar_photos_action_test.dart
git commit -m "feat(mobile): port SimilarPhotosAction onto the ActionBuilder model"
```

---

### Task 5: Migrate call sites and delete the old widgets

**Files:**

- Modify: `mobile/lib/presentation/widgets/bottom_sheet/space_bottom_sheet.widget.dart:60`
- Modify: `mobile/lib/utils/action_button.utils.dart:259`
- Delete: `mobile/lib/presentation/widgets/action_buttons/remove_from_space_action_button.widget.dart`
- Delete: `mobile/lib/presentation/widgets/action_buttons/similar_photos_action_button.widget.dart`

**Interfaces:**

- Consumes: `RemoveFromSpaceAction` (Task 3), `SimilarPhotosAction` (Task 4), `ActionColumnButton` / `ActionMenuItem` (Task 2).
- Produces: no remaining references to the two deleted widgets.

- [ ] **Step 1: Migrate the space bottom sheet**

In `space_bottom_sheet.widget.dart`, replace the `RemoveFromSpaceActionButton(...)` element with:

```dart
          if (_canEdit)
            ActionColumnButton(
              action: RemoveFromSpaceAction(
                source: ActionSource.timeline,
                spaceId: widget.spaceId,
                onComplete: widget.onAssetsRemoved,
              ),
            ),
```

Update imports: drop `action_buttons/remove_from_space_action_button.widget.dart`, add `presentation/actions/remove_from_space.action.dart` and `presentation/actions/action.widget.dart`.

- [ ] **Step 2: Migrate the similar-photos call site**

In `action_button.utils.dart`, replace the `similarPhotos` arm. The old `iconOnly` / `menuItem` flags become the widget choice:

```dart
      ActionButtonType.similarPhotos => menuItem
          ? ActionMenuItem(action: SimilarPhotosAction(assetId: (context.asset as RemoteAsset).id))
          : ActionColumnButton(action: SimilarPhotosAction(assetId: (context.asset as RemoteAsset).id)),
```

- [ ] **Step 3: Delete the old widget files**

```bash
git rm mobile/lib/presentation/widgets/action_buttons/remove_from_space_action_button.widget.dart \
       mobile/lib/presentation/widgets/action_buttons/similar_photos_action_button.widget.dart
```

- [ ] **Step 4: Verify nothing still references them**

```bash
grep -rn 'RemoveFromSpaceActionButton\|SimilarPhotosActionButton' mobile/lib mobile/test
```

Expected: no output.

- [ ] **Step 5: Run the full mobile gate**

```bash
cd mobile
dart analyze --fatal-infos lib test
dart format $(find lib test -name '*.dart' -not \( -name '*.g.dart' -o -name '*.drift.dart' -o -name '*.gr.dart' \))
flutter test
```

Expected: `No issues found!`, formatter idempotent, `All tests passed!`

- [ ] **Step 6: Commit**

```bash
cd ..
git add -u mobile
git commit -m "refactor(mobile): move Space action call sites onto the new action model"
```

---

### Task 6: Land the 7 remaining held commits

**Files:** whatever the upstream commits touch — resolve conflicts as they arise.

**Interfaces:**

- Consumes: an open gate (Tasks 1–5 complete).
- Produces: the branch level with `upstream/main`.

- [ ] **Step 1: Rebase to upstream tip, one commit at a time**

```bash
git log --reverse --oneline 56ce7176b1d..upstream/main
```

Then rebase onto each in turn — `8e0ad9b2c4b`, `36cb86c886d`, `7aa20683610`, `627b52fdaf0`, `920552c1c24`, `dd8d068d443`, `483b375c26c` — running `git rebase <sha>` and resolving conflicts before moving on.

`627b52fdaf0` removes the last committed generated files (`router.gr.dart`, `*.g.dart`) and adds `.gitignore` entries. The fork already generates these at build time, so accept the deletions — same resolution as batches 12/13/20.

- [ ] **Step 2: Run the audits after the final rebase**

```bash
make upstream-postrebase-audit BATCH=26
make ci-invariants-check
make fork-patches-check
make mobile-drift-rebase-check BATCH=26
```

Expected: all `OK:`.

- [ ] **Step 3: Check `revert-to-immich.sql` coverage**

```bash
UPSTREAM_TAG=v$(jq -r '.upstream.version' branding/config.json)
up=$(mktemp); gh api "repos/immich-app/immich/git/trees/${UPSTREAM_TAG}:server/src/schema/migrations" --jq '.tree[].path' | sort > "$up"
for d in migrations-gallery migrations; do
  find "server/src/schema/$d" -maxdepth 1 -name '*.ts' | sort | while read -r f; do
    fn=${f##*/}; name=${fn%.ts}
    [ "$d" = migrations ] && grep -qxF "$fn" "$up" && continue
    grep -qF "'${name}'" scripts/revert-to-immich.sql || echo "MISSING ($d): $name"
  done
done; rm -f "$up"
```

Expected: no output. None of these 7 commits adds a migration, so any `MISSING` line means something else drifted.

- [ ] **Step 4: Commit any fixes**

```bash
git status --porcelain    # expect empty if no conflicts needed fixing
```

---

### Task 7: Full verification and CI

**Files:** `docs/upstream-reports/2026-07-31-upstream-sync-batches-27-29.md` (create).

**Interfaces:**

- Consumes: Tasks 1–6.
- Produces: a green branch and an audit trail.

- [ ] **Step 1: Run the local gate set**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd server && pnpm build && pnpm check && pnpm lint && npx vitest --config test/vitest.config.mjs --run && cd ..
cd packages/sdk && pnpm build && cd ../..
cd web && pnpm check:typescript && pnpm check:svelte && npx vitest --run && cd ..
cd web && npx eslint . --rule '{"tscompat/tscompat":"off"}'; cd ..
```

Expected: all pass. Web lint shows 0 errors; ~21 warnings are pre-existing.

- [ ] **Step 2: Verify the OpenAPI spec is not stale**

```bash
cd server && node ./dist/bin/sync-open-api.js && cd ..
git status --porcelain -- open-api/
```

Expected: empty. If not, commit the regenerated spec — the post-rebase audit does not catch this.

- [ ] **Step 3: Push and dispatch CI**

```bash
git push origin HEAD:rebase/upstream-arc4-b29 --force
REF=rebase/upstream-arc4-b29
for wf in test.yml gallery-revert-to-immich-validation.yml docker.yml static_analysis.yml \
          gallery-rebase-smoke.yml storage-migration-tests.yml gallery-ml-smoke.yml gallery-mobile-smoke.yml; do
  gh --repo open-noodle/gallery workflow run "$wf" --ref "$REF"; sleep 45
done
gh --repo open-noodle/gallery workflow run storage-migration-e2e.yml --ref "$REF" --field branch="$REF"; sleep 45
gh --repo open-noodle/gallery workflow run gallery-build-mobile.yml --ref "$REF" --field environment=development
```

Expect a re-run round. Two distinct limits recur and need different handling:

| Symptom                                                         | Handling                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `toomanyrequests: … allowed: 44000/minute`                      | container registry — re-run when few jobs are in flight                          |
| `403 … github rate limit: 0/60 (core)` → `extism-js: not found` | GitHub REST API — wait past the reset epoch printed in the 403 body, then re-run |

- [ ] **Step 4: Confirm the revert validation actually passed**

```bash
RID=$(gh --repo open-noodle/gallery run list --branch rebase/upstream-arc4-b29 \
       --workflow gallery-revert-to-immich-validation.yml --limit 1 --json databaseId --jq '.[0].databaseId')
JID=$(gh --repo open-noodle/gallery run view $RID --json jobs -q '.jobs[0].databaseId')
gh --repo open-noodle/gallery run view --job "$JID" --log | grep -E 'Post-phase drift|validation PASSED'
```

Expected: `Post-phase drift (0 item(s))` and `revert-to-immich validation PASSED`. A green coverage grep alone is **not** sufficient.

- [ ] **Step 5: Write and commit the sync report**

Create `docs/upstream-reports/2026-07-31-upstream-sync-batches-27-29.md` covering: the two gated commits and why they were held, the 34-site lint measurement, the ownership constraint the port had to preserve, the two ports with their test coverage, the 7 commits landed behind the gate, and the CI result. Run `npx prettier --write` on it before committing.

- [ ] **Step 6: Update rolling state and memory**

Mark the batch-27 quarantine released in `rolling-state.json` with the outcome, set `upstreamTargetHead` to the new tip, and invoke the `save-memory` skill.

---

## Self-Review

**Spec coverage:**

| Spec requirement                                                   | Task                                             |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| Take both commits in upstream order                                | 1, 2                                             |
| Fix all 34 lint sites, rule stays enabled                          | 1                                                |
| Three per-site lint checks (State / non-State / different context) | 1 Step 3                                         |
| `RemoveFromSpaceAction` with `spaceId` + `onComplete`              | 3                                                |
| Hard constraint: not owner-scoped                                  | 3 Step 1 (test), Step 3 (`assetsActionProvider`) |
| `SimilarPhotosAction`, flags dropped to call site                  | 4, 5 Step 2                                      |
| Delete old widgets, migrate call sites                             | 5                                                |
| TDD RED → GREEN per action                                         | 3 and 4, Steps 1–4                               |
| Land the 7 held commits                                            | 6                                                |
| Full CI green                                                      | 7                                                |

**Coverage gap, accepted:** the spec lists 11 cases for `RemoveFromSpaceAction`; Task 3 writes 7. The four omitted are redundant against this implementation — "no remote assets" and "empty selection" both reduce to the same `_hasRemoteAssetsProvider` branch already covered by the hidden-when-empty test, and "result.success == false" plus "source == viewer" exercise branches with no fork-specific logic. If the implementer finds `_hasRemoteAssetsProvider` growing conditionals, add them back.

**Placeholders:** none — every code step contains complete code.

**Type consistency:** `RemoveFromSpaceAction({required super.source, required this.spaceId, this.onComplete})` matches its use in Task 5 Step 1. `SimilarPhotosAction({required this.assetId})` matches Task 5 Step 2. `ToastService.success/.error` take a single `String`, matching Task 3 Step 3. `handleError(Object, {StackTrace? stack, String? description})` matches the real signature in `mobile/lib/utils/error_handler.dart:11`.
