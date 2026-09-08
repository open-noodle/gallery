import 'package:openapi/api.dart';

class ServerConfig {
  final int trashDays;
  final String oauthButtonText;
  final String externalDomain;
  final String mapDarkStyleUrl;
  final String mapLightStyleUrl;
  // Server-advertised chunk size (bytes) for the chunked-upload protocol. 0 means unsupported.
  final int uploadChunkSize;

  const ServerConfig({
    required this.trashDays,
    required this.oauthButtonText,
    required this.externalDomain,
    required this.mapDarkStyleUrl,
    required this.mapLightStyleUrl,
    this.uploadChunkSize = 0,
  });

  ServerConfig copyWith({int? trashDays, String? oauthButtonText, String? externalDomain}) {
    return ServerConfig(
      trashDays: trashDays ?? this.trashDays,
      oauthButtonText: oauthButtonText ?? this.oauthButtonText,
      externalDomain: externalDomain ?? this.externalDomain,
      mapDarkStyleUrl: mapDarkStyleUrl,
      mapLightStyleUrl: mapLightStyleUrl,
      uploadChunkSize: uploadChunkSize,
    );
  }

  @override
  String toString() =>
      'ServerConfig(trashDays: $trashDays, oauthButtonText: $oauthButtonText, externalDomain: $externalDomain, uploadChunkSize: $uploadChunkSize)';

  ServerConfig.fromDto(ServerConfigDto dto)
    : trashDays = dto.trashDays,
      oauthButtonText = dto.oauthButtonText,
      externalDomain = dto.externalDomain,
      mapDarkStyleUrl = dto.mapDarkStyleUrl,
      mapLightStyleUrl = dto.mapLightStyleUrl,
      uploadChunkSize = dto.uploadChunkSize;

  @override
  bool operator ==(covariant ServerConfig other) {
    if (identical(this, other)) {
      return true;
    }

    return other.trashDays == trashDays &&
        other.oauthButtonText == oauthButtonText &&
        other.externalDomain == externalDomain;
  }

  @override
  int get hashCode => trashDays.hashCode ^ oauthButtonText.hashCode ^ externalDomain.hashCode;
}
