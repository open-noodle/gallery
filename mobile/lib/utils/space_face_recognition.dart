import 'package:openapi/api.dart';

/// Whether a space's People surfaces should be offered for [space].
///
/// `faceRecognitionEnabled` is `Optional<bool?>` and `Absent.value` THROWS, so it is read via
/// `orElse(null)`. Only an explicit `false` hides People, mirroring the web `SpaceTabs`. An absent
/// or null flag shows it: absent only happens against a server that omits the field, and the server
/// returns an empty list for a face-recognition-disabled space, so the worst case is a correct
/// empty state rather than a silently missing feature.
///
/// Widget-free so the `Optional` edge cases can be covered without pumping a widget, following the
/// precedent set by `utils/people_sort.dart`.
bool spacePeopleVisible(SharedSpaceResponseDto space) => space.faceRecognitionEnabled.orElse(null) ?? true;
