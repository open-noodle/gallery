import 'package:pigeon/pigeon.dart';

@ConfigurePigeon(
  PigeonOptions(
    dartOut: 'lib/platform/camera_bubble_api.g.dart',
    kotlinOut: 'android/app/src/main/kotlin/app/alextran/immich/camerabubble/CameraBubble.g.kt',
    kotlinOptions: KotlinOptions(package: 'app.alextran.immich.camerabubble'),
    dartOptions: DartOptions(),
    dartPackageName: 'immich_mobile',
  ),
)
/// A destination the bubble can route new photos to.
///
/// Spaces and albums are one type here: the overlay only draws a target, and [id] is the
/// encoded target Dart hands back. [colorHex] stands in for a thumbnail, which would need the
/// image pipeline in a service with no Flutter engine.
class OverlayTarget {
  final String id;
  final String name;
  final String colorHex;

  const OverlayTarget({required this.id, required this.name, required this.colorHex});
}

@HostApi()
abstract class CameraBubbleHostApi {
  bool isOverlayPermissionGranted();

  /// Opens the system screen. Android reports no result, so the user switches it on again.
  void requestOverlayPermission();

  /// Optional. Without it the bubble cannot tell a camera app from anything else using the
  /// back camera.
  bool isUsageAccessGranted();

  void requestUsageAccess();

  /// [notificationTitle] and [notificationBody] arrive localized: the service has no Flutter engine.
  @async
  void start(List<OverlayTarget> targets, List<String> selectedIds, String notificationTitle, String notificationBody);

  void stop();

  /// Push a new target list / selection into a running overlay without restarting it.
  void update(List<OverlayTarget> targets, List<String> selectedIds);

  bool isRunning();

  /// Dismiss the drawer, handing the foreground back to the camera.
  void closePicker();
}
