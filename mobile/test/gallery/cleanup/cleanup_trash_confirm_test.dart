import 'dart:async';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_session_state.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_trash_confirm.dart';

import '../../widget_tester_extensions.dart';

// "Trash confirmation" (specs/2026-10-29-mobile-library-cleanup-design.md), ported from the web's
// `confirmCleanupTrash` (web/src/lib/gallery/cleanup/cleanup-actions.ts): the prompt is made of the same sentences.
//
//   Given nothing needs confirming                    Then there is no prompt
//   Given the trash on and photos in a space          Then the space sentence, confirmed with "Trash"
//   Given the trash on and only external photos       Then the external-library sentence alone is the prompt
//   Given the trash on, space and external photos     Then the space sentence, then the external one
//   Given the trash off                               Then "Permanently delete", the permanent sentence, then the space
//                                                     and external sentences when they apply
//   When the dialog is cancelled                      Then it resolves false; confirming resolves true

LibraryCleanupTrashCheck check({int trash = 3, int spaces = 0, int external = 0, bool trashOn = true}) =>
    LibraryCleanupTrashCheck(trashCount: trash, inSpacesCount: spaces, externalCount: external, trashEnabled: trashOn);

const _space1 = '1 photo is also in a shared space. Trashing removes it for space members too.';
const _external2 =
    '2 photos are from an external library. If the server can only read that folder, they come back at the next '
    'library scan and no space is freed.';

void main() {
  late BuildContext context;

  Future<void> pumpHost(WidgetTester tester) async {
    await tester.pumpWidget(
      localizedForTest(
        Builder(
          builder: (outer) => MaterialApp(
            localizationsDelegates: outer.localizationDelegates,
            supportedLocales: outer.supportedLocales,
            locale: outer.locale,
            home: Scaffold(
              body: Builder(
                builder: (inner) {
                  context = inner;
                  return const SizedBox.expand();
                },
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('nothing to confirm: no prompt', (tester) async {
    await pumpHost(tester);
    expect(libraryCleanupTrashPrompt(context, check()), isNull);
  });

  testWidgets('the trash on, a photo in a space: the space sentence, confirmed with "Trash"', (tester) async {
    await pumpHost(tester);
    final prompt = libraryCleanupTrashPrompt(context, check(spaces: 1))!;
    expect([prompt.title, prompt.message, prompt.confirm, prompt.permanent], [null, _space1, 'Trash', false]);
  });

  testWidgets('the trash on, only external photos: that sentence alone is the prompt', (tester) async {
    await pumpHost(tester);
    final prompt = libraryCleanupTrashPrompt(context, check(external: 2))!;
    expect([prompt.title, prompt.message, prompt.confirm], [null, _external2, 'Trash']);
  });

  testWidgets('the trash on, space and external photos: the space sentence, then the external one', (tester) async {
    await pumpHost(tester);
    expect(libraryCleanupTrashPrompt(context, check(spaces: 1, external: 2))!.message, '$_space1 $_external2');
  });

  testWidgets('the trash off: a permanent delete, with the space and external sentences added', (tester) async {
    await pumpHost(tester);
    final plain = libraryCleanupTrashPrompt(context, check(trashOn: false))!;
    expect(
      [plain.title, plain.message, plain.confirm, plain.permanent],
      [
        'Permanently delete',
        'The trash is turned off on this server, so these 3 photos are deleted permanently. This cannot be undone.',
        'Permanently delete',
        true,
      ],
    );

    final all = libraryCleanupTrashPrompt(context, check(trash: 1, spaces: 1, external: 2, trashOn: false))!;
    expect(
      all.message,
      'The trash is turned off on this server, so this photo is deleted permanently. This cannot be undone. '
      '1 photo is also in a shared space and will be removed for space members too. $_external2',
    );
  });

  testWidgets('the dialog resolves false when cancelled and true when confirmed', (tester) async {
    await pumpHost(tester);

    final cancelled = showLibraryCleanupTrashConfirm(context, check(spaces: 1));
    await tester.pumpAndSettle();
    expect(find.text(_space1), findsOneWidget);
    await tester.tap(find.byKey(const Key('cleanup-trash-confirm-cancel')));
    await tester.pumpAndSettle();
    expect(await cancelled, isFalse);

    final confirmed = showLibraryCleanupTrashConfirm(context, check(external: 2));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cleanup-trash-confirm-ok')));
    await tester.pumpAndSettle();
    expect(await confirmed, isTrue);

    // Nothing to confirm resolves at once, without a dialog.
    expect(await showLibraryCleanupTrashConfirm(context, check()), isTrue);
    unawaited(Future<void>.value());
  });
}
