import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/sessions/session_create_response.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

final sessionsAPIRepositoryProvider = Provider((ref) => SessionsAPIRepository(ref.watch(apiServiceProvider)));

class SessionsAPIRepository extends ApiRepository {
  final ApiService _apiService;

  SessionsAPIRepository(this._apiService);

  SessionsApi get _api => _apiService.sessionsApi;

  Future<SessionCreateResponse> createSession(String deviceType, String deviceOS, {int? duration}) async {
    final dto = await checkNull(
      _api.createSession(
        SessionCreateDto(
          deviceType: Optional.present(deviceType),
          deviceOS: Optional.present(deviceOS),
          duration: duration == null ? const Optional.absent() : Optional.present(duration),
        ),
      ),
    );

    return SessionCreateResponse(
      id: dto.id,
      current: dto.current,
      deviceType: deviceType,
      deviceOS: deviceOS,
      expiresAt: dto.expiresAt.orElse(null),
      createdAt: dto.createdAt,
      updatedAt: dto.updatedAt,
      token: dto.token,
    );
  }
}
