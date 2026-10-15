import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockApiService extends Mock implements ApiService {}

class _MockSpacesApi extends Mock implements SharedSpacesApi {}

void main() {
  late _MockApiService apiService;
  late _MockSpacesApi spacesApi;
  late SharedSpaceApiRepository repository;

  setUpAll(() => registerFallbackValue(SharedSpaceUpdateDto()));

  setUp(() {
    apiService = _MockApiService();
    spacesApi = _MockSpacesApi();
    when(() => apiService.sharedSpacesApi).thenReturn(spacesApi);
    when(() => spacesApi.updateSpace(any(), any())).thenAnswer(
      (_) async => SharedSpaceResponseDto(
        id: 's1',
        name: 'Space',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        createdById: 'u1',
      ),
    );
    repository = SharedSpaceApiRepository(apiService);
  });

  SharedSpaceUpdateDto captureDto() =>
      verify(() => spacesApi.updateSpace('s1', captureAny())).captured.single as SharedSpaceUpdateDto;

  test('turning the daily on sends present(true) and touches nothing else', () async {
    await repository.update('s1', dailyChallengeEnabled: true);

    final dto = captureDto();
    expect(dto.dailyChallengeEnabled.orElse(null), isTrue);
    expect(dto.name.isPresent, isFalse);
    expect(dto.description.isPresent, isFalse);
    expect(dto.color.isPresent, isFalse);
  });

  test('turning it off sends present(false), not absent', () async {
    await repository.update('s1', dailyChallengeEnabled: false);

    expect(captureDto().dailyChallengeEnabled.orElse(null), isFalse);
  });

  test('a rename leaves the daily setting absent rather than clobbering it', () async {
    await repository.update('s1', name: 'Renamed');

    expect(captureDto().dailyChallengeEnabled.isPresent, isFalse);
  });
}
