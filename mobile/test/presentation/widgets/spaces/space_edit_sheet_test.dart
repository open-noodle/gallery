import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_edit_sheet.widget.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';

class MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

void main() {
  late MockSharedSpaceApiRepository repo;

  SharedSpaceResponseDto space({
    String name = 'Family Photos',
    Optional<String?> description = const Optional.present('Our shared album'),
    Optional<UserAvatarColor?> color = const Optional.present(UserAvatarColor.blue),
  }) => SharedSpaceResponseDto(
    id: 'space-1',
    name: name,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    createdById: 'user-1',
    description: description,
    color: color,
  );

  SharedSpaceResponseDto saved() => SharedSpaceResponseDto(
    id: 'space-1',
    name: 'Saved',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    createdById: 'user-1',
  );

  /// Pumps the sheet and records every onClose call.
  Future<List<bool?>> pumpSheet(WidgetTester tester, {SharedSpaceResponseDto? withSpace}) async {
    final closes = <bool?>[];
    await tester.pumpConsumerWidget(
      SpaceEditSheet(space: withSpace ?? space(), onClose: closes.add),
      overrides: [sharedSpaceApiRepositoryProvider.overrideWithValue(repo)],
    );
    return closes;
  }

  Finder nameField() => find.byKey(const Key('space-edit-name'));
  Finder descriptionField() => find.byKey(const Key('space-edit-description'));
  Finder saveButton() => find.byKey(const Key('space-edit-save'));

  bool saveEnabled(WidgetTester tester) => tester.widget<FilledButton>(saveButton()).onPressed != null;

  /// `ImmichToast` schedules a 3s fluttertoast Timer outside the frame scheduler, so a
  /// plain `pumpAndSettle()` leaves it pending and teardown fails with "A Timer is still
  /// pending". Pump past its lifetime instead of dropping the toast from the widget.
  Future<void> settleToast(WidgetTester tester) async {
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
  }

  setUpAll(() {
    registerFallbackValue(UserAvatarColor.primary);
  });

  setUp(() {
    repo = MockSharedSpaceApiRepository();
    when(
      () => repo.update(
        any(),
        name: any(named: 'name'),
        description: any(named: 'description'),
        color: any(named: 'color'),
      ),
    ).thenAnswer((_) async => saved());
  });

  testWidgets('prefills name, description and colour from the space', (tester) async {
    await pumpSheet(tester);

    expect(tester.widget<TextField>(nameField()).controller!.text, 'Family Photos');
    expect(tester.widget<TextField>(descriptionField()).controller!.text, 'Our shared album');
    expect(find.byKey(const Key('space-edit-color-blue-selected')), findsOneWidget);
  });

  testWidgets('defaults to the primary swatch when the space has no colour', (tester) async {
    await pumpSheet(tester, withSpace: space(color: const Optional.absent()));

    expect(find.byKey(const Key('space-edit-color-primary-selected')), findsOneWidget);
  });

  testWidgets('disables save for an empty name', (tester) async {
    await pumpSheet(tester);

    await tester.enterText(nameField(), '');
    await tester.pump();

    expect(saveEnabled(tester), isFalse);
  });

  testWidgets('disables save for a whitespace-only name', (tester) async {
    await pumpSheet(tester);

    await tester.enterText(nameField(), '   ');
    await tester.pump();

    expect(saveEnabled(tester), isFalse, reason: 'a required flag alone would let "   " through');
  });

  testWidgets('focuses the name with its text selected on open, and does not reselect on a later tap', (tester) async {
    await pumpSheet(tester);

    final controller = tester.widget<TextField>(nameField()).controller!;
    expect(controller.selection.baseOffset, 0);
    expect(controller.selection.extentOffset, 'Family Photos'.length);

    // Simulate the user placing the caret mid-word, then the field regaining focus.
    controller.selection = const TextSelection.collapsed(offset: 3);
    await tester.tap(nameField());
    await tester.pump();

    expect(controller.selection, const TextSelection.collapsed(offset: 3), reason: 'select-once only');
  });

  testWidgets('caps the name at 100 and the description at 500 characters', (tester) async {
    await pumpSheet(tester);

    await tester.enterText(nameField(), 'x' * 150);
    await tester.enterText(descriptionField(), 'y' * 600);
    await tester.pump();

    expect(tester.widget<TextField>(nameField()).controller!.text.length, 100);
    expect(tester.widget<TextField>(descriptionField()).controller!.text.length, 500);
  });

  testWidgets('renders an over-long existing name in full and keeps save enabled', (tester) async {
    // Truncating a name the user already has would be data loss.
    await pumpSheet(tester, withSpace: space(name: 'z' * 120));

    expect(tester.widget<TextField>(nameField()).controller!.text.length, 120);
    expect(saveEnabled(tester), isTrue);
  });

  testWidgets('sends no description when only the name changed', (tester) async {
    await pumpSheet(tester);

    await tester.enterText(nameField(), 'Renamed');
    await tester.pump();
    await tester.tap(saveButton());
    await settleToast(tester);

    verify(() => repo.update('space-1', name: 'Renamed', description: null, color: UserAvatarColor.blue)).called(1);
  });

  testWidgets('sends an empty description when the user cleared it', (tester) async {
    await pumpSheet(tester);

    await tester.enterText(descriptionField(), '');
    await tester.pump();
    await tester.tap(saveButton());
    await settleToast(tester);

    verify(() => repo.update('space-1', name: 'Family Photos', description: '', color: UserAvatarColor.blue)).called(1);
  });

  testWidgets('saving with nothing edited sends absent name-only fields and still closes', (tester) async {
    final closes = await pumpSheet(tester);

    await tester.tap(saveButton());
    await settleToast(tester);

    verify(
      () => repo.update('space-1', name: 'Family Photos', description: null, color: UserAvatarColor.blue),
    ).called(1);
    expect(closes, [true], reason: 'a no-op save is not an error');
  });

  testWidgets('sends the chosen colour', (tester) async {
    await pumpSheet(tester);

    await tester.tap(find.byKey(const Key('space-edit-color-amber')));
    await tester.pump();
    await tester.tap(saveButton());
    await settleToast(tester);

    verify(
      () => repo.update('space-1', name: 'Family Photos', description: null, color: UserAvatarColor.amber),
    ).called(1);
  });

  testWidgets('a double-tap on save issues exactly one request', (tester) async {
    final completer = Completer<SharedSpaceResponseDto>();
    when(
      () => repo.update(
        any(),
        name: any(named: 'name'),
        description: any(named: 'description'),
        color: any(named: 'color'),
      ),
    ).thenAnswer((_) => completer.future);

    await pumpSheet(tester);

    await tester.tap(saveButton());
    await tester.pump();
    await tester.tap(saveButton(), warnIfMissed: false);
    await tester.pump();

    completer.complete(saved());
    await settleToast(tester);

    verify(
      () => repo.update(
        any(),
        name: any(named: 'name'),
        description: any(named: 'description'),
        color: any(named: 'color'),
      ),
    ).called(1);
  });

  testWidgets('resolves true on success and null on cancel', (tester) async {
    final closes = await pumpSheet(tester);

    await tester.tap(saveButton());
    await settleToast(tester);
    expect(closes, [true]);

    final cancels = await pumpSheet(tester);
    await tester.tap(find.byKey(const Key('space-edit-cancel')));
    await settleToast(tester);
    expect(cancels, [null]);
    verifyNever(() => repo.update('space-2', name: any(named: 'name')));
  });

  testWidgets('stays open and does not resolve when the save fails', (tester) async {
    when(
      () => repo.update(
        any(),
        name: any(named: 'name'),
        description: any(named: 'description'),
        color: any(named: 'color'),
      ),
    ).thenThrow(Exception('403'));

    final closes = await pumpSheet(tester);

    await tester.tap(saveButton());
    await tester.pumpAndSettle();

    // Asserted before settleToast pumps past the toast's 3s lifetime. The sheet merely
    // staying open is not feedback -- a revoked role has to say so out loud.
    expect(find.text('Unable to update space'), findsOneWidget);

    await settleToast(tester);

    expect(closes, isEmpty, reason: 'a revoked role must not look like a successful save');
    expect(nameField(), findsOneWidget);
    expect(saveEnabled(tester), isTrue, reason: 'the in-flight guard must be released so the user can retry');
  });

  testWidgets('every colour swatch is labelled and meets the minimum tap target', (tester) async {
    await pumpSheet(tester);

    for (final color in UserAvatarColor.values) {
      final swatch = find.byKey(Key('space-edit-color-${color.value}'));
      expect(swatch, findsOneWidget, reason: '${color.value} swatch');
      expect(
        find.descendant(of: swatch, matching: find.bySemanticsLabel(color.value)),
        findsOneWidget,
        reason: '${color.value} needs a semantics label -- colour alone is invisible to a screen reader',
      );
      expectTapTargetMin(tester, swatch);
    }
  });
}
