import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/infrastructure/repositories/memory.repository.dart';
import 'package:immich_mobile/repositories/memory_api.repository.dart';
import 'package:logging/logging.dart';

/// Accesses Memories; a specialized collection of assets with some novel display mechanism
class MemoryService {
  final log = Logger("MemoryService");

  final MemoryRepository _repository;
  final MemoryApiRepository _apiRepository;

  MemoryService(this._repository, this._apiRepository);

  /// The memory lane: the viewer's own memories AND memories built from photos shared with
  /// them through a Space, matching the web memory lane (which calls the server).
  ///
  /// Memories are generated per owner and the memory sync streams are owner-scoped, so the
  /// local sync DB never receives a Space-shared memory — reading the server's unified,
  /// RBAC-projected list is what keeps mobile at parity with web. See issue #997.
  Future<List<Memory>> getMemoryLane(String ownerId) async {
    try {
      return await _apiRepository.getMemoryLane();
    } catch (error, stackTrace) {
      // Offline / server failure: fall back to the owner-scoped local list so the viewer's
      // own memories still render (their Space-shared memories are unavailable offline).
      log.warning("Failed to fetch memories from the server; using the local sync DB", error, stackTrace);
      return _repository.getAll(ownerId);
    }
  }

  Future<List<Memory>> getAll(String ownerId, {bool onlyFavorites = false}) {
    return _repository.getAll(ownerId, onlyToday: false, onlyFavorites: onlyFavorites);
  }

  Future<Memory?> get(String memoryId) {
    return _repository.get(memoryId);
  }

  Future<int> getCount() {
    return _repository.getCount();
  }
}
