import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:immich_mobile/presentation/widgets/map/map_utils.dart' as presentation_map;
import 'package:immich_mobile/utils/map_utils.dart' as legacy_map;

import '../test_utils.dart';

typedef LocationChecker =
    Future<(Position?, LocationPermission?)> Function({required BuildContext context, bool silent});

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
  });

  for (final testCase in [
    (name: 'presentation map utils', checkLocation: presentation_map.MapUtils.checkPermAndGetLocation),
    (name: 'legacy map utils', checkLocation: legacy_map.MapUtils.checkPermAndGetLocation),
  ]) {
    testWidgets('${testCase.name} discloses deniedForever location usage before opening settings', (tester) async {
      final geolocator = _FakeGeolocatorPlatform(permission: LocationPermission.deniedForever);
      final originalGeolocator = GeolocatorPlatform.instance;
      GeolocatorPlatform.instance = geolocator;
      addTearDown(() {
        GeolocatorPlatform.instance = originalGeolocator;
      });

      late BuildContext context;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (builderContext) {
              context = builderContext;
              return const SizedBox();
            },
          ),
        ),
      );

      final resultFuture = testCase.checkLocation(context: context);
      await tester.pumpAndSettle();

      expect(find.text('map_no_location_permission_title'), findsOneWidget);
      expect(geolocator.openAppSettingsCallCount, 0);

      await tester.tap(find.text('yes'));
      await tester.pumpAndSettle();

      final result = await resultFuture;
      expect(result.$1, isNull);
      expect(result.$2, LocationPermission.deniedForever);
      expect(geolocator.openAppSettingsCallCount, 1);
      expect(geolocator.requestPermissionCallCount, 0);
    });

    testWidgets('${testCase.name} treats declined deniedForever disclosure as no consent', (tester) async {
      final geolocator = _FakeGeolocatorPlatform(permission: LocationPermission.deniedForever);
      final originalGeolocator = GeolocatorPlatform.instance;
      GeolocatorPlatform.instance = geolocator;
      addTearDown(() {
        GeolocatorPlatform.instance = originalGeolocator;
      });

      late BuildContext context;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (builderContext) {
              context = builderContext;
              return const SizedBox();
            },
          ),
        ),
      );

      final resultFuture = testCase.checkLocation(context: context);
      await tester.pumpAndSettle();

      expect(find.text('map_no_location_permission_title'), findsOneWidget);

      await tester.tap(find.text('cancel'));
      await tester.pumpAndSettle();

      final result = await resultFuture;
      expect(result.$1, isNull);
      expect(result.$2, LocationPermission.deniedForever);
      expect(geolocator.openAppSettingsCallCount, 0);
      expect(geolocator.requestPermissionCallCount, 0);
    });
  }
}

class _FakeGeolocatorPlatform extends GeolocatorPlatform {
  _FakeGeolocatorPlatform({required this.permission});

  final LocationPermission permission;
  int openAppSettingsCallCount = 0;
  int requestPermissionCallCount = 0;

  @override
  Future<bool> isLocationServiceEnabled() async => true;

  @override
  Future<LocationPermission> checkPermission() async => permission;

  @override
  Future<LocationPermission> requestPermission() async {
    requestPermissionCallCount++;
    return permission;
  }

  @override
  Future<bool> openAppSettings() async {
    openAppSettingsCallCount++;
    return true;
  }
}
