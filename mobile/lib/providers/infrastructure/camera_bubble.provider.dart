import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/services/camera_bubble.service.dart';

/// Singleton for the app's lifetime: constructing it registers the Pigeon FlutterApi handler,
/// so a second instance would silently steal the overlay's callbacks from the first.
final cameraBubbleServiceProvider = Provider<CameraBubbleService>((ref) => CameraBubbleService());
