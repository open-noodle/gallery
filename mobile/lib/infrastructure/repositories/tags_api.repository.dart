import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/infrastructure/repositories/api.repository.dart';
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
}
