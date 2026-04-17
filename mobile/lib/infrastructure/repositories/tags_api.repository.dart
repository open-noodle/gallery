import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/server/api_repository.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

final tagsApiRepositoryProvider = Provider<TagsApiRepository>(
  (ref) => TagsApiRepository(ref.watch(apiServiceProvider)),
);

class TagsApiRepository extends ApiRepository {
  final ApiService _apiService;
  TagsApiRepository(this._apiService);

  TagsApi get _api => _apiService.tagsApi;

  Future<List<TagResponseDto>?> getAllTags() async {
    return await _api.getAllTags();
  }

  Future<int> bulkTagAssets(List<String> assetIds, List<String> tagIds) async {
    final response = await _api.bulkTagAssets(TagBulkAssetsDto(assetIds: assetIds, tagIds: tagIds));
    return response?.count ?? 0;
  }

  Future<List<TagResponseDto>?> upsertTags(List<String> tags) async {
    return _api.upsertTags(TagUpsertDto(tags: tags));
  }
}
