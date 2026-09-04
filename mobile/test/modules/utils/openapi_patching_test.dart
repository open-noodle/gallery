import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:openapi/api.dart';
import 'package:immich_mobile/utils/openapi_patching.dart';

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

    test('a server older than PhotoGuesser still yields a parsable, feature-off preference', () {
      // `photoGuesser` is in UserPreferencesResponseDto.requiredKeys and the generated model
      // deserialises it as `PhotoGuesserResponse.fromJson(json[r'photoGuesser'])!` — a bang on a
      // value an older server does not send at all. Updating the app from the store before
      // updating the server is an ordinary deployment order, and without this patch it hard-fails
      // the preferences fetch every login.
      final dynamic value = jsonDecode("""
{
  "download": {
    "archiveSize": 4294967296,
    "includeEmbeddedVideos": false
  }
}
""");

      upgradeDto(value, 'UserPreferencesResponseDto');

      // Off, matching the server's own default. A patch that defaulted either toggle on would
      // silently widen an old server's pool to photos the player never opted to play with.
      final photoGuesser = PhotoGuesserResponse.fromJson(value['photoGuesser'])!;
      expect(photoGuesser.includePartners, isFalse);
      expect(photoGuesser.includeSpaces, isFalse);
    });

    test('addDefault', () {
      dynamic value = jsonDecode("""
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
      dynamic value = jsonDecode("""
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
