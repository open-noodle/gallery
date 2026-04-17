import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/entities/asset.entity.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:logging/logging.dart';
import 'package:openapi/api.dart';

final folderApiRepositoryProvider = Provider((ref) => FolderApiRepository(ref.watch(apiServiceProvider)));

class FolderApiRepository extends ApiRepository {
  final ApiService _apiService;
  final Logger _log = Logger("FolderApiRepository");

  FolderApiRepository(this._apiService);

  ViewsApi get _api => _apiService.viewApi;

  Future<List<String>> getAllUniquePaths() async {
    try {
      final list = await _api.getUniqueOriginalPaths();
      return list ?? [];
    } catch (e, stack) {
      _log.severe("Failed to fetch unique original links", e, stack);
      return [];
    }
  }

  Future<List<Asset>> getAssetsForPath(String? path) async {
    try {
      final list = await _api.getAssetsByOriginalPath(path ?? '/');
      return list != null ? list.map(Asset.remote).toList() : [];
    } catch (e, stack) {
      _log.severe("Failed to fetch Assets by original path", e, stack);
      return [];
    }
  }
}
