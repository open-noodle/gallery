import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// maplibre_gl 0.27 tears the platform down even when the platform view was never created —
/// 0.26 only disposed through the controller — and `MapLibreMethodChannel.dispose` touches a
/// `late` MethodChannel that is assigned only in `onPlatformViewCreated`. A widget test never
/// creates a real platform view, so unmounting any map throws a `LateInitializationError`
/// while the tree is finalized, failing the test after its assertions have already passed.
///
/// Answering the platform-views channel makes `onPlatformViewCreated` fire, which assigns that
/// channel and leaves `dispose` with something to tear down. Call this at the top of `main()`
/// in any test that mounts a widget containing a `MapLibreMap`.
void useFakeMapLibrePlatformView() {
  final opened = <MethodChannel>[];

  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(SystemChannels.platform_views, (call) async {
      if (call.method == 'create') {
        final id = (call.arguments as Map)['id'] as int;
        final channel = MethodChannel('plugins.flutter.io/maplibre_gl_$id');
        opened.add(channel);
        // The map's own channel: onPlatformViewCreated immediately awaits `map#waitForMap`,
        // which would otherwise raise MissingPluginException.
        messenger.setMockMethodCallHandler(channel, (_) async => null);
      }
      return null;
    });
  });

  tearDown(() {
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(SystemChannels.platform_views, null);
    for (final channel in opened) {
      messenger.setMockMethodCallHandler(channel, null);
    }
    opened.clear();
  });
}
