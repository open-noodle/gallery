import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/presentation/widgets/timeline/header.widget.dart';
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:intl/date_symbol_data_local.dart';
// easy_localization initializes shared_preferences internally; the mobile app
// gets it transitively, but tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

class _FakeReadonly extends ReadOnlyModeNotifier {
  @override
  bool build() => false;

  @override
  void setMode(bool value) {}

  @override
  void setReadonlyMode(bool isEnabled) {}

  @override
  void toggleReadonlyMode() {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    await initializeDateFormatting('en');
  });

  testWidgets('year header renders year label and bulk-select affordance', (tester) async {
    final timelineService = TimelineService((
      assetSource: (_, _) async => const [],
      bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: 3)]),
      origin: TimelineOrigin.main,
    ));
    addTearDown(timelineService.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          timelineServiceProvider.overrideWithValue(timelineService),
          readonlyModeProvider.overrideWith(_FakeReadonly.new),
        ],
        child: EasyLocalization(
          supportedLocales: const [Locale('en')],
          path: '../i18n',
          fallbackLocale: const Locale('en'),
          child: MaterialApp(
            home: Material(
              child: TimelineHeader(
                bucket: TimeBucket(date: DateTime(2025), assetCount: 3),
                header: HeaderType.year,
                height: 80,
                assetOffset: 0,
              ),
            ),
          ),
        ),
      ),
    );

    await tester.pump();

    expect(find.text('2025'), findsOneWidget);
    expect(find.byType(IconButton), findsOneWidget);
  });
}
