import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/models/server_info/server_info.model.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_mobile/services/server_info.service.dart';
import 'package:immich_mobile/widgets/common/app_bar_dialog/server_update_notification.dart';
import 'package:mocktail/mocktail.dart';

import '../widget_tester_extensions.dart';

class _MockServerInfoService extends Mock implements ServerInfoService {}

class _OutOfDateServerInfoNotifier extends ServerInfoNotifier {
  _OutOfDateServerInfoNotifier(super.serverInfoService) {
    state = state.copyWith(versionStatus: VersionStatus.serverOutOfDate);
  }
}

// url_launcher's default platform under test is its method channel; record what it is asked to open.
const _urlLauncherChannel = MethodChannel('plugins.flutter.io/url_launcher');

void main() {
  final launched = <String>[];

  setUp(() {
    launched.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(_urlLauncherChannel, (
      call,
    ) async {
      if (call.method == 'launch') {
        launched.add((call.arguments as Map)['url'] as String);
      }
      return true;
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      _urlLauncherChannel,
      null,
    );
  });

  // Discussion #1199: "View" on the server-update notice opened Immich's releases.
  testWidgets('View on an out-of-date server opens the Gallery releases page', (tester) async {
    await tester.pumpConsumerWidget(
      const ServerUpdateNotification(),
      overrides: [serverInfoProvider.overrideWith((ref) => _OutOfDateServerInfoNotifier(_MockServerInfoService()))],
    );

    await tester.tap(find.text('View'));
    await tester.pumpAndSettle();

    expect(launched, ['https://github.com/open-noodle/gallery/releases/latest']);
  });
}
