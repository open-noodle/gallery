import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/download_action_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/remove_from_album_action_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/share_action_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.state.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

Widget _wrap(Widget widget, {List<Override> overrides = const []}) {
  return ProviderScope(
    overrides: [
      timelineStateProvider.overrideWith(TimelineStateNotifier.new),
      multiSelectProvider.overrideWith(MultiSelectNotifier.new),
      ...overrides,
    ],
    child: EasyLocalization(
      supportedLocales: const [Locale('en')],
      path: '../i18n',
      fallbackLocale: const Locale('en'),
      child: MaterialApp(home: Scaffold(body: widget)),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  setUpAll(() async {
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
  });

  testWidgets('canEdit:true — has Download, Share, and RemoveFromAlbum buttons', (tester) async {
    await tester.pumpWidget(_wrap(const SpaceAlbumBottomSheet(canEdit: true, albumId: 'a1')));
    await tester.pump();

    expect(find.byType(DownloadActionButton), findsOneWidget);
    expect(find.byType(ShareActionButton), findsOneWidget);
    expect(find.byType(RemoveFromAlbumActionButton), findsOneWidget);
  });

  testWidgets('canEdit:false — has Download and Share but NO RemoveFromAlbum button', (tester) async {
    await tester.pumpWidget(_wrap(const SpaceAlbumBottomSheet(canEdit: false, albumId: 'a1')));
    await tester.pump();

    expect(find.byType(DownloadActionButton), findsOneWidget);
    expect(find.byType(ShareActionButton), findsOneWidget);
    expect(find.byType(RemoveFromAlbumActionButton), findsNothing);
  });

  testWidgets('canEdit:true — does NOT have Favorite, Archive, Trash, or MoveToLockFolder buttons', (tester) async {
    await tester.pumpWidget(_wrap(const SpaceAlbumBottomSheet(canEdit: true, albumId: 'a1')));
    await tester.pump();

    // Verify forbidden action buttons are absent by checking for their label text
    expect(find.text('Favorite'), findsNothing);
    expect(find.text('Archive'), findsNothing);
    expect(find.text('Trash'), findsNothing);
    expect(find.text('Lock'), findsNothing);
  });
}
