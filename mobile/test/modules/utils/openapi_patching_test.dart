import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/models/server_info/server_features.model.dart';
import 'package:immich_mobile/utils/openapi_patching.dart';
import 'package:openapi/api.dart';

void main() {
  group('Test OpenApi Patching', () {
    test('upgradeDto', () {
      dynamic value;
      String targetType;

      targetType = 'UserPreferencesResponseDto';
      value = jsonDecode("""
{
  "download": {
    "archiveSize": 4294967296,
    "includeEmbeddedVideos": false
  }
}
""");

      upgradeDto(value, targetType);
      expect(value['tags'], TagsResponse(enabled: false, sidebarWeb: false).toJson());
      expect(value['download']['includeEmbeddedVideos'], false);
    });

    // Payloads below carry only the keys a stock Immich v3.3.1 server sends; fromJson must
    // fill the fork-only required ones through upgradeDto instead of throwing.
    test('parses stock Immich /server/features', () {
      final dto = ServerFeaturesDto.fromJson({
        'configFile': false,
        'duplicateDetection': true,
        'email': false,
        'facialRecognition': true,
        'importFaces': false,
        'map': false,
        'oauth': true,
        'oauthAutoLaunch': false,
        'ocr': true,
        'passwordLogin': false,
        'realtimeTranscoding': false,
        'reverseGeocoding': true,
        'search': true,
        'sidecar': true,
        'smartSearch': true,
        'trash': false,
      })!;
      final features = ServerFeatures.fromDto(dto);

      expect(dto.peopleStatistics, false);
      expect(dto.smartSearchHasCutoff, false);
      expect(features.oauthEnabled, true);
      expect(features.passwordLogin, false);
      expect(features.map, false);
      expect(features.trash, false);
      expect(features.ocr, true);
      expect(features.syncRequestTypes, isNull);
      expect(features.localTakenRange, false);
    });

    test('parses stock Immich /users/me/preferences', () {
      final dto = UserPreferencesResponseDto.fromJson(
        jsonDecode("""
{
  "albums": {"defaultAssetOrder": "desc"},
  "folders": {"enabled": false, "sidebarWeb": false},
  "memories": {"enabled": false, "duration": 7, "sidebarWeb": false},
  "people": {"enabled": true, "sidebarWeb": false, "minimumFaces": 3, "updateStrategy": "everyone"},
  "sharedLinks": {"enabled": true, "sidebarWeb": false},
  "ratings": {"enabled": false},
  "tags": {"enabled": false, "sidebarWeb": false},
  "emailNotifications": {"enabled": true, "albumInvite": true, "albumUpdate": true},
  "download": {"archiveSize": 4294967296, "includeEmbeddedVideos": false},
  "purchase": {"showSupportBadge": true, "hideBuyButtonUntil": "2022-02-12T00:00:00.000Z"},
  "cast": {"gCastEnabled": false},
  "recentlyAdded": {"sidebarWeb": false}
}
"""),
      )!;

      expect(dto.memories.enabled, false);
      expect(dto.memories.duration, 7);
      expect(dto.memories.types, isEmpty);
    });

    test('addDefault', () {
      final dynamic value = jsonDecode("""
{
  "download": {
    "archiveSize": 4294967296,
    "includeEmbeddedVideos": false
  }
}
""");
      String keys = 'download.unknownKey';
      dynamic defaultValue = 69420;

      addDefault(value, keys, defaultValue);
      expect(value['download']['unknownKey'], 69420);

      keys = 'alpha.beta';
      defaultValue = 'gamma';
      addDefault(value, keys, defaultValue);
      expect(value['alpha']['beta'], 'gamma');
    });

    test('addDefault with null', () {
      final dynamic value = jsonDecode("""
{
  "download": {
    "archiveSize": 4294967296,
    "includeEmbeddedVideos": false
  }
}
""");
      expect(value['download']['unknownKey'], isNull);
    });
  });
}
