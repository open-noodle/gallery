import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/presentation/widgets/asset_viewer/video_viewer.widget.dart';

import '../../utils.dart';

RemoteAsset _videoAsset() {
  final id = TestUtils.uuid(null);

  return RemoteAsset(
    id: id,
    name: 'remote_$id.mp4',
    ownerId: TestUtils.uuid(null),
    checksum: 'checksum-$id',
    type: .video,
    createdAt: TestUtils.yesterday(),
    updatedAt: TestUtils.now(),
    isEdited: false,
    width: 1920,
    height: 1080,
    durationMs: 12_000,
  );
}

// These are construction-only assertions rather than `pumpWidget` tests.
//
// Mounting `DriftMemoryCard` under `flutter test` throws two unavoidable exceptions: its remote
// image provider cannot resolve (it does not route through `dart:io`, so `MockHttpOverrides` does
// not intercept it), and `NativeVideoViewer` opens a platform video controller in `initState`.
// Both are environment limitations unrelated to this wiring, and suppressing them would make the
// test assert almost nothing while still being flaky.
//
// What actually carries risk here is the parameter contract: that `forceAutoPlay` exists and
// defaults to `false`, so the ~40 other `NativeVideoViewer` call sites keep honouring the user's
// global autoplay preference. That is what these cover. The single `forceAutoPlay: true` literal in
// `memory_card.widget.dart` is a compile-checked named argument (`dart analyze --fatal-infos`) and
// was verified by hand in the memory viewer.
void main() {
  group('NativeVideoViewer.forceAutoPlay', () {
    test('defaults to false so existing call sites keep the global autoplay behaviour', () {
      final viewer = NativeVideoViewer(asset: _videoAsset(), image: const SizedBox.shrink());

      expect(viewer.forceAutoPlay, isFalse);
    });

    test('can be opted into explicitly, as the memory card does', () {
      final viewer = NativeVideoViewer(asset: _videoAsset(), image: const SizedBox.shrink(), forceAutoPlay: true);

      expect(viewer.forceAutoPlay, isTrue);
    });
  });
}
