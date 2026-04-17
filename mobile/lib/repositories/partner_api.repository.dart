import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/infrastructure/utils/user.converter.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

enum Direction { sharedWithMe, sharedByMe }

final partnerApiRepositoryProvider = Provider((ref) => PartnerApiRepository(ref.watch(apiServiceProvider)));

class PartnerApiRepository extends ApiRepository {
  final ApiService _apiService;

  PartnerApiRepository(this._apiService);

  PartnersApi get _api => _apiService.partnersApi;

  Future<List<UserDto>> getAll(Direction direction) async {
    final response = await checkNull(
      _api.getPartners(direction == Direction.sharedByMe ? PartnerDirection.by : PartnerDirection.with_),
    );
    return response.map(UserConverter.fromPartnerDto).toList();
  }

  Future<UserDto> create(String sharedWithId) async {
    final dto = await checkNull(_api.createPartner(PartnerCreateDto(sharedWithId: sharedWithId)));
    return UserConverter.fromPartnerDto(dto);
  }

  Future<void> delete(String id) => _api.removePartner(id);

  Future<UserDto> update(String id, {required bool inTimeline}) async {
    final dto = await checkNull(_api.updatePartner(id, PartnerUpdateDto(inTimeline: inTimeline)));
    return UserConverter.fromPartnerDto(dto);
  }
}
