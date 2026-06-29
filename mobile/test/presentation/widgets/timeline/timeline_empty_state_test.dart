import 'dart:convert';

import 'package:easy_localization/easy_localization.dart' hide TextDirection;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_empty_state.widget.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/sync_status.provider.dart';
import 'package:immich_mobile/widgets/common/immich_loading_indicator.dart';

import '../../../widget_tester_extensions.dart';

/// Notifier override that always yields a fixed [SearchFilter] from build(),
/// while keeping the real reset() behaviour.
class _FixedFilter extends PhotosFilterNotifier {
  _FixedFilter(this._initial);

  final SearchFilter _initial;

  @override
  SearchFilter build() => _initial;
}

class _FixedSync extends SyncStatusNotifier {
  _FixedSync(this._initial);

  final SyncStatusState _initial;

  @override
  SyncStatusState build() => _initial;
}

/// 1×1 transparent PNG so Image.asset resolves without the real asset bundle.
final _transparentPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
);

class _FakeAssetBundle extends CachingAssetBundle {
  final ByteData _emptyManifest = const StandardMessageCodec().encodeMessage(<String, Object>{})!;

  @override
  Future<ByteData> load(String key) async {
    // Image.asset first resolves the binary asset manifest; serving PNG bytes
    // for it corrupts the decode, so return a valid empty manifest instead.
    if (key == 'AssetManifest.bin' || key == 'AssetManifest.bin.json' || key == 'AssetManifest.json') {
      return _emptyManifest;
    }
    return ByteData.view(Uint8List.fromList(_transparentPng).buffer);
  }

  @override
  Future<String> loadString(String key, {bool cache = true}) async => '';
}

void main() {
  Widget withFakeAssets(Widget child) => DefaultAssetBundle(bundle: _FakeAssetBundle(), child: child);

  SearchFilter activeFilter() => SearchFilter.empty().copyWith()..context = 'beach';

  testWidgets('first-run state shows the onboarding title and an Enable Backup action', (tester) async {
    await tester.pumpConsumerWidget(
      withFakeAssets(const TimelineEmptyState()),
      overrides: [
        photosFilterProvider.overrideWith(() => _FixedFilter(SearchFilter.empty())),
        syncStatusProvider.overrideWith(() => _FixedSync(const SyncStatusState())),
      ],
    );
    await tester.pumpAndSettle();

    expect(find.text('timeline_empty_title'.tr()), findsOneWidget);
    expect(find.byType(FilledButton), findsOneWidget);
    expect(find.byType(ImmichLoadingIndicator), findsNothing);
  });

  testWidgets('while the initial remote sync runs it shows a loader, not the onboarding', (tester) async {
    await tester.pumpConsumerWidgetRaw(
      const TimelineEmptyState(),
      overrides: [
        photosFilterProvider.overrideWith(() => _FixedFilter(SearchFilter.empty())),
        syncStatusProvider.overrideWith(() => _FixedSync(const SyncStatusState(remoteSyncStatus: SyncStatus.syncing))),
      ],
    );
    await tester.pump();

    expect(find.byType(ImmichLoadingIndicator), findsOneWidget);
    expect(find.text('timeline_empty_title'), findsNothing);
  });

  testWidgets('an active filter shows the no-results state and clearing it resets the filter', (tester) async {
    await tester.pumpConsumerWidget(
      const TimelineEmptyState(),
      overrides: [
        photosFilterProvider.overrideWith(() => _FixedFilter(activeFilter())),
        // syncing so that after the reset we deterministically land on the loader
        // (no asset/router needed) rather than the first-run state.
        syncStatusProvider.overrideWith(() => _FixedSync(const SyncStatusState(remoteSyncStatus: SyncStatus.syncing))),
      ],
    );
    await tester.pump();

    expect(find.text('timeline_empty_filtered_title'.tr()), findsOneWidget);
    expect(find.text('timeline_empty_clear_filters'.tr()), findsOneWidget);

    await tester.tap(find.text('timeline_empty_clear_filters'.tr()));
    await tester.pump();

    expect(find.text('timeline_empty_filtered_title'.tr()), findsNothing);
    expect(find.byType(ImmichLoadingIndicator), findsOneWidget);
  });
}
