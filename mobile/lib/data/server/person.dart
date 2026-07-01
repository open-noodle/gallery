import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/server/api_repository.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

final personApiRepositoryProvider = Provider((ref) => PersonApiRepository(ref.watch(apiServiceProvider)));

class PersonApiRepository extends ApiRepository {
  final ApiService _apiService;

  const PersonApiRepository(this._apiService);

  PeopleApi get _api => _apiService.peopleApi;

  /// Fetches the people visible on [assetId] from the server.
  ///
  /// The local sync DB only ever receives faces for assets the viewer owns, so for an
  /// asset shared with the viewer through a Space this must go to the server. The
  /// asset-info endpoint resolves those faces to the Space's people exactly like the web
  /// app (see `AssetService.get`), which keeps mobile at parity with web. See issue #727.
  Future<List<Person>> getAssetPeople(String assetId) async {
    final info = await checkNull(_apiService.assetsApi.getAssetInfo(assetId));
    return info.people.where((person) => !person.isHidden).map(_toAssetPerson).toList();
  }

  // The unified Person model carries no owner/created/face-asset/hidden/colour fields, and
  // updatedAt is nullable — so the epoch-0 sentinel the old DriftPerson mapping needed is gone.
  static Person _toAssetPerson(PersonWithFacesResponseDto dto) =>
      Person(id: dto.id, name: dto.name, updatedAt: dto.updatedAt, birthDate: dto.birthDate);

  Future<Person> update(String id, {String? name, DateTime? birthday}) async {
    final birthdayUtc = birthday == null ? null : DateTime.utc(birthday.year, birthday.month, birthday.day);
    final dto = PersonUpdateDto(
      name: name == null ? const Optional.absent() : Optional.present(name),
      birthDate: birthdayUtc == null ? const Optional.absent() : Optional.present(birthdayUtc),
    );
    final response = await checkNull(_api.updatePerson(id, dto));
    return _toPerson(response);
  }

  static Person _toPerson(PersonResponseDto dto) =>
      .new(birthDate: dto.birthDate, id: dto.id, name: dto.name, updatedAt: dto.updatedAt.orElse(null));
}
