// Gallery-fork: family relationships, mobile slice 13 — the focus card (Task 2). Read-only.
//
// "Mobile widget tests pass suspiciously easily" — every negative assertion here (does-not-show,
// renders-nothing) is paired with a positive control on the same fixture shape, so a test that
// can't fail is caught rather than trusted.
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/family_focus.model.dart';
import 'package:immich_mobile/presentation/widgets/people/family_focus_card.widget.dart';
import 'package:immich_mobile/providers/infrastructure/family.provider.dart';
import 'package:immich_mobile/repositories/family_api.repository.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  Future<void> pumpCard(WidgetTester tester, AsyncValue<FamilyFocusResult> Function(String personId) resolve) =>
      tester.pumpConsumerWidget(
        const FamilyFocusCard(personId: 'lena'),
        overrides: [
          familyFocusProvider.overrideWith((ref, personId) {
            final value = resolve(personId);
            return switch (value) {
              AsyncData(:final value) => Future.value(value),
              AsyncError(:final error) => Future.error(error),
              _ => Future.value(const FamilyFocusUnavailable()),
            };
          }),
        ],
      );

  const ruth = FamilyRelationEntry.known(personId: 'ruth', name: 'Ruth', relation: 'parent');
  const anton = FamilyRelationEntry.known(personId: 'anton', name: 'Anton', relation: 'parent');
  const oskar = FamilyRelationEntry.known(personId: 'oskar', name: 'Oskar', relation: 'partner');
  const juno = FamilyRelationEntry.known(personId: 'juno', name: 'Juno', relation: 'child');

  const fullFocus = FamilyFocus(parents: [ruth, anton], partners: [oskar], children: [juno]);

  testWidgets('shows parents above, partner beside and children below', (tester) async {
    await pumpCard(tester, (_) => const AsyncData(FamilyFocusAvailable(fullFocus)));

    final parentsRow = find.byKey(const Key('family-focus-parents-row'));
    final partnersRow = find.byKey(const Key('family-focus-partners-row'));
    final childrenRow = find.byKey(const Key('family-focus-children-row'));
    expect(parentsRow, findsOneWidget);
    expect(partnersRow, findsOneWidget);
    expect(childrenRow, findsOneWidget);

    final parentsY = tester.getTopLeft(parentsRow).dy;
    final partnersY = tester.getTopLeft(partnersRow).dy;
    final childrenY = tester.getTopLeft(childrenRow).dy;
    expect(parentsY, lessThan(partnersY));
    expect(partnersY, lessThan(childrenY));

    // Positive anchor: every named relative actually renders, not just the row containers.
    expect(find.text('Ruth'), findsOneWidget);
    expect(find.text('Anton'), findsOneWidget);
    expect(find.text('Oskar'), findsOneWidget);
    expect(find.text('Juno'), findsOneWidget);
  });

  testWidgets('shows each relation with its derived label', (tester) async {
    await pumpCard(tester, (_) => const AsyncData(FamilyFocusAvailable(fullFocus)));

    // "parent" appears twice (Ruth and Anton); "partner" and "child" once each.
    expect(find.text('parent'), findsNWidgets(2));
    expect(find.text('partner'), findsOneWidget);
    expect(find.text('child'), findsOneWidget);
  });

  group('A5 — anonymous participant', () {
    const anonymous = FamilyRelationEntry.anonymous(relation: 'parent', anonymousSlot: 7);
    const focusWithAnonymousParent = FamilyFocus(parents: [anonymous, anton], partners: [], children: []);

    testWidgets('shows an anonymous entry for a participant the viewer cannot resolve', (tester) async {
      await pumpCard(tester, (_) => const AsyncData(FamilyFocusAvailable(focusWithAnonymousParent)));

      expect(find.text('Someone'), findsOneWidget);
      // Positive control on the same fixture: the resolvable sibling participant in the same
      // row still renders by name, so "Someone" is a deliberate anonymous-seat rendering, not a
      // sign that nothing loaded.
      expect(find.text('Anton'), findsOneWidget);
    });

    testWidgets('never renders an identity id for an anonymous entry', (tester) async {
      await pumpCard(tester, (_) => const AsyncData(FamilyFocusAvailable(focusWithAnonymousParent)));

      // The model's own anonymousSlot (7) is an opaque per-union index; it must never be
      // shown as visible text anywhere on the card, unlike a real relative's name.
      expect(find.text('7'), findsNothing);
      // Positive control: a resolvable person's own identity IS shown by name — proving text
      // rendering itself works and this is not an accident of an empty widget tree.
      expect(find.text('Anton'), findsOneWidget);
    });
  });

  group('E54 — offline vs empty', () {
    testWidgets('explains that relationships are not stored on the device when offline', (tester) async {
      await pumpCard(tester, (_) => AsyncError(Exception('Failed host lookup'), StackTrace.empty));

      expect(find.text('family_mobile_offline_title'.tr()), findsOneWidget);
      expect(find.text('family_mobile_offline_message'.tr()), findsOneWidget);
    });

    // Positive control, same test group: when data loads fine, the offline explanation must be
    // ABSENT — otherwise the offline copy could be permanently on-screen and this suite would
    // never notice.
    testWidgets('does not show the offline explanation when relations load fine', (tester) async {
      await pumpCard(tester, (_) => const AsyncData(FamilyFocusAvailable(fullFocus)));

      expect(find.text('family_mobile_offline_title'.tr()), findsNothing);
      expect(find.text('family_mobile_offline_message'.tr()), findsNothing);
    });
  });

  group('A12 — effective access none', () {
    testWidgets('renders no relations section when the viewer has no family access', (tester) async {
      await pumpCard(tester, (_) => const AsyncData(FamilyFocusUnavailable()));

      expect(find.byKey(const Key('family-focus-card')), findsNothing);
      // The absence must not be mistaken for the offline/error state either.
      expect(find.text('family_mobile_offline_title'.tr()), findsNothing);
    });

    // Paired positive control: same widget, same personId, only the access level differs.
    testWidgets('renders it for a viewer with view access', (tester) async {
      await pumpCard(tester, (_) => const AsyncData(FamilyFocusAvailable(fullFocus)));

      expect(find.byKey(const Key('family-focus-card')), findsOneWidget);
    });
  });
}
