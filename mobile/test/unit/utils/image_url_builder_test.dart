import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:openapi/api.dart' as api;

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  group('getFaceThumbnailUrl', () {
    test('builds the owner-only person thumbnail endpoint', () {
      expect(getFaceThumbnailUrl('person-1'), 'http://localhost:0/people/person-1/thumbnail');
    });
  });

  group('getSpacePersonThumbnailUrl', () {
    test('builds the membership-gated space person thumbnail endpoint', () {
      expect(
        getSpacePersonThumbnailUrl('space-1', 'space-person-1'),
        'http://localhost:0/shared-spaces/space-1/people/space-person-1/thumbnail',
      );
    });
  });

  group('getPersonThumbnailUrl', () {
    test('routes a personal person (null spaceId) to the owner endpoint', () {
      expect(getPersonThumbnailUrl('person-1'), 'http://localhost:0/people/person-1/thumbnail');
    });

    test('routes a space person (non-null spaceId) to the space endpoint', () {
      expect(
        getPersonThumbnailUrl('space-person-1', spaceId: 'space-1'),
        'http://localhost:0/shared-spaces/space-1/people/space-person-1/thumbnail',
      );
    });
  });

  // A photos-filter suggestion person carries a tokenized id (`person:<uuid>` / `space-person:<uuid>`)
  // when withSharedSpaces resolves via the identity path — routing the avatar off that tokenized id
  // 404s. Route via primaryProfile instead, mirroring web getPhotosPersonFilterThumbnailUrl.
  group('photosFilterPersonThumbnailUrl', () {
    test('routes a space-person profile to the membership-gated space endpoint', () {
      final person = api.FilterSuggestionsPersonDto(
        id: 'space-person:profile-1',
        name: 'Alice',
        primaryProfile: api.Optional.present(
          api.ScopedPrimaryProfile(
            id: 'profile-1',
            spaceId: const api.Optional.present('space-1'),
            type: api.ScopedPrimaryProfileTypeEnum.spacePerson,
          ),
        ),
      );
      expect(
        photosFilterPersonThumbnailUrl(person),
        'http://localhost:0/shared-spaces/space-1/people/profile-1/thumbnail',
      );
    });

    test('routes a user-person profile to the owner endpoint using the raw profile id', () {
      final person = api.FilterSuggestionsPersonDto(
        id: 'person:profile-2',
        name: 'Bob',
        primaryProfile: api.Optional.present(
          api.ScopedPrimaryProfile(id: 'profile-2', type: api.ScopedPrimaryProfileTypeEnum.userPerson),
        ),
      );
      expect(photosFilterPersonThumbnailUrl(person), 'http://localhost:0/people/profile-2/thumbnail');
    });

    test('strips a person: prefix when no primaryProfile is present', () {
      final person = api.FilterSuggestionsPersonDto(id: 'person:raw-uuid', name: 'Carol');
      expect(photosFilterPersonThumbnailUrl(person), 'http://localhost:0/people/raw-uuid/thumbnail');
    });

    test('falls back to a bare id (owner endpoint) when there is no prefix or profile', () {
      final person = api.FilterSuggestionsPersonDto(id: 'raw-uuid', name: 'Dave');
      expect(photosFilterPersonThumbnailUrl(person), 'http://localhost:0/people/raw-uuid/thumbnail');
    });
  });

  // The photos-filter picker/recent/chip surfaces store the tokenized filter id
  // (`person:<uuid>` / `space-person:<uuid>`) on FilterPerson.id and the Space scope on
  // FilterPerson.spaceId. This helper de-tokenizes to the raw profile id and routes a Space
  // person to the membership-gated space endpoint, everyone else to the owner endpoint.
  // Mirrors web getPhotosPersonFilterThumbnailUrl.
  group('getFilterPersonThumbnailUrl', () {
    test('routes a space-person token (with spaceId) to the membership-gated space endpoint', () {
      expect(
        getFilterPersonThumbnailUrl('space-person:sp-1', spaceId: 'space-1'),
        'http://localhost:0/shared-spaces/space-1/people/sp-1/thumbnail',
      );
    });

    test('routes a person: token (no spaceId) to the owner endpoint using the de-tokenized id', () {
      expect(getFilterPersonThumbnailUrl('person:p-1'), 'http://localhost:0/people/p-1/thumbnail');
    });

    test('routes a bare id (no prefix, no spaceId) to the owner endpoint', () {
      expect(getFilterPersonThumbnailUrl('p-1'), 'http://localhost:0/people/p-1/thumbnail');
    });

    test('de-tokenizes a space-person token even when spaceId is unexpectedly null (owner endpoint)', () {
      expect(getFilterPersonThumbnailUrl('space-person:sp-1'), 'http://localhost:0/people/sp-1/thumbnail');
    });
  });
}
