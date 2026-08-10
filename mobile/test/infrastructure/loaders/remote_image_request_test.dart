import 'dart:ffi';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:ffi/ffi.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/infrastructure/loaders/image_request.dart';
import 'package:immich_mobile/platform/remote_image_api.g.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = BasicMessageChannel<Object?>(
    'dev.flutter.pigeon.immich_mobile.RemoteImageApi.requestImage',
    RemoteImageApi.pigeonChannelCodec,
  );
  late List<Object?> args;

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockDecodedMessageHandler(channel, (
      message,
    ) async {
      args = message! as List<Object?>;
      return <Object?>[null];
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockDecodedMessageHandler(channel, null);
  });

  Future<ui.Image> loadEncoded(String path, ui.Size decodeSize) async {
    final bytes = await File(path).readAsBytes();
    final pointer = malloc<Uint8>(bytes.length)..asTypedList(bytes.length).setAll(0, bytes);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockDecodedMessageHandler(channel, (
      message,
    ) async {
      return <Object?>[
        <Object?, Object?>{'pointer': pointer.address, 'length': bytes.length},
      ];
    });
    final request = RemoteImageRequest(uri: 'https://example.test/fallback', decodeSize: decodeSize);

    return (await request.load((_, {getTargetSize}) => throw UnimplementedError()))!.image;
  }

  test('passes the requested decode size to the platform', () async {
    final request = RemoteImageRequest(uri: 'https://example.test/thumbnail', decodeSize: const ui.Size(319.1, 179.1));

    await request.load((_, {getTargetSize}) => throw UnimplementedError());

    expect(args[0], 'https://example.test/thumbnail');
    expect(args[2], isFalse);
    expect(args[3], 320);
    expect(args[4], 180);
  });

  test('leaves requests without a size unbounded', () async {
    final request = RemoteImageRequest(uri: 'https://example.test/thumbnail');

    await request.load((_, {getTargetSize}) => throw UnimplementedError());

    expect(args[3], isNull);
    expect(args[4], isNull);
  });

  test('leaves encoded animation requests unbounded', () async {
    final request = RemoteImageRequest(uri: 'https://example.test/animation', decodeSize: const ui.Size(320, 180));

    await request.loadCodec();

    expect(args[2], isTrue);
    expect(args[3], isNull);
    expect(args[4], isNull);
  });

  test('keeps portrait cover quality in a wide tile', () async {
    final image = await loadEncoded('assets/feature_message/ocr.webp', const ui.Size(963, 642));

    expect(image.width, 963);
    expect(image.height, 1453);
    image.dispose();
  });

  test('preserves cover quality for extreme aspect ratios', () async {
    // Cover-fitting a square box keeps the source aspect ratio, so the expected
    // width is tied to whichever artwork ships at this path. The fork replaces it
    // with the Gallery mark (984x328, 3:1) where upstream ships 3038x742 (~4.09:1),
    // so this is 960 here and 1311 upstream. Re-derive as `320 * width / height` if
    // branding swaps the logo again.
    final image = await loadEncoded('assets/immich-logo-inline-light.png', const ui.Size.square(320));

    expect(image.width, 960);
    expect(image.height, 320);
    image.dispose();
  });

  test('does not upscale encoded fallback', () async {
    final image = await loadEncoded('assets/feature_message/ocr.webp', const ui.Size.square(2000));

    expect(image.width, 1206);
    expect(image.height, 1819);
    image.dispose();
  });

  test('uses the decode size in the provider cache key', () {
    final small = RemoteImageProvider(url: 'https://example.test/thumbnail', decodeSize: const ui.Size.square(160));
    final large = RemoteImageProvider(url: 'https://example.test/thumbnail', decodeSize: const ui.Size.square(320));

    expect(small, isNot(large));
  });

  test('shares the cache key when no decode size is set', () {
    final first = RemoteImageProvider(url: 'https://example.test/thumbnail');
    final second = RemoteImageProvider(url: 'https://example.test/thumbnail');

    expect(first, second);
    expect(first.hashCode, second.hashCode);
  });
}
