import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/platform/permission_api.g.dart';
import 'package:immich_mobile/repositories/permission.repository.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = BasicMessageChannel<Object?>(
    'dev.flutter.pigeon.immich_mobile.PermissionApi.manageMediaPermission',
    PermissionApi.pigeonChannelCodec,
  );

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockDecodedMessageHandler<Object?>(
      channel,
      null,
    );
  });

  group('DevicePermissionRepository.manageMediaPermission', () {
    test('requests manage media settings through the permission API channel', () async {
      final repository = DevicePermissionRepository(PermissionApi());
      final calls = <Object?>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockDecodedMessageHandler<Object?>(channel, (
        Object? message,
      ) async {
        calls.add(message);
        return <Object?>[true];
      });

      final result = await repository.manageMediaPermission();

      expect(result, isTrue);
      expect(calls, hasLength(1));
      expect(calls.single, isNull);
    });

    test('throws when the native permission API handler is missing', () async {
      final repository = DevicePermissionRepository(PermissionApi());

      await expectLater(
        repository.manageMediaPermission(),
        throwsA(isA<PlatformException>().having((e) => e.code, 'code', 'channel-error')),
      );
    });
  });
}
