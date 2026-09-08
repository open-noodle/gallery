import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:openapi/api.dart';

part 'server_config.model.freezed.dart';

@freezed
abstract class ServerConfig with _$ServerConfig {
  const factory ServerConfig({
    required int trashDays,
    required String oauthButtonText,
    required String externalDomain,
    required String mapDarkStyleUrl,
    required String mapLightStyleUrl,
    // Server-advertised chunk size (bytes) for the chunked-upload protocol. 0 means unsupported.
    @Default(0) int uploadChunkSize,
  }) = _ServerConfig;

  factory ServerConfig.fromDto(ServerConfigDto dto) => ServerConfig(
    trashDays: dto.trashDays,
    oauthButtonText: dto.oauthButtonText,
    externalDomain: dto.externalDomain,
    mapDarkStyleUrl: dto.mapDarkStyleUrl,
    mapLightStyleUrl: dto.mapLightStyleUrl,
    uploadChunkSize: dto.uploadChunkSize,
  );
}
