import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/space_face_recognition.dart';
import 'package:openapi/api.dart' as api;

api.SharedSpaceResponseDto _space({api.Optional<bool?> faceRecognitionEnabled = const api.Optional.absent()}) =>
    api.SharedSpaceResponseDto(
      id: 'space-1',
      name: 'Family Trip',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      createdById: 'user-1',
      faceRecognitionEnabled: faceRecognitionEnabled,
    );

void main() {
  test('is visible when face recognition is explicitly enabled', () {
    expect(spacePeopleVisible(_space(faceRecognitionEnabled: const api.Optional.present(true))), isTrue);
  });

  test('is hidden when face recognition is explicitly disabled', () {
    expect(spacePeopleVisible(_space(faceRecognitionEnabled: const api.Optional.present(false))), isFalse);
  });

  test('is visible when the flag is absent, without reading Optional.value', () {
    // v3 openapi wraps optional fields in Optional<...?> whose `.value` THROWS when absent, so a
    // regression that reaches for `.value` fails loudly here instead of on the space detail page.
    // Absent means the server omitted the field; the server returns an empty people list for a
    // face-recognition-disabled space, so the worst case is a correct empty state.
    expect(spacePeopleVisible(_space()), isTrue);
  });

  test('is visible when the flag is present but null', () {
    // Optional.present(null) is distinct from absent: the field WAS sent, explicitly as null.
    // Neither is an explicit `false`, so both fall back to visible.
    expect(spacePeopleVisible(_space(faceRecognitionEnabled: const api.Optional.present(null))), isTrue);
  });
}
