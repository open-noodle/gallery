import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/pages/library/spaces/space_album_folder_errors.dart';

/// The real server messages, verbatim. If these ever stop matching what
/// `server/src/services/shared-space.service.ts` produces, the mapping below is decoration —
/// which is why the server spec asserts each message still contains its fragment from the other
/// side. These are the strings that pairing protects.
const _depthMessage = 'Folder nesting is limited to 10 levels (this would be 11)';
const _capMessage = 'A space is limited to 500 folders';
const _nameTakenMessage = 'A folder with that name already exists here';

const _fallback = 'space_album_folder_error_create';

/// Immich's API errors arrive as a JSON envelope; this is the shape the page hands over.
String _envelope(String message) => jsonEncode({'message': message, 'error': 'Bad Request', 'statusCode': 400});

void main() {
  group('spaceAlbumFolderErrorKey', () {
    test('maps each server rejection to its own toast key', () {
      expect(spaceAlbumFolderErrorKey(_envelope(_depthMessage), _fallback), 'space_album_folder_depth_exceeded');
      expect(spaceAlbumFolderErrorKey(_envelope(_capMessage), _fallback), 'space_album_folder_limit_reached');
      expect(spaceAlbumFolderErrorKey(_envelope(_nameTakenMessage), _fallback), 'space_album_folder_name_taken');
    });

    // The cap fragment 'is limited to' is a substring of the depth message, so a naive ordering
    // reports every depth error as a folder-cap error. This is the test that pins the ordering.
    test('a depth error is not mistaken for a folder-cap error', () {
      expect(spaceAlbumFolderErrorKey(_envelope(_depthMessage), _fallback), isNot('space_album_folder_limit_reached'));
    });

    // Not every 400 body is JSON — a proxy or a non-Nest handler can return plain text. Matching
    // must fall through to the raw string rather than throwing on the failed decode.
    test('matches a plain-text body, not just a JSON envelope', () {
      expect(spaceAlbumFolderErrorKey(_nameTakenMessage, _fallback), 'space_album_folder_name_taken');
      expect(spaceAlbumFolderErrorKey(_depthMessage, _fallback), 'space_album_folder_depth_exceeded');
    });

    // jsonDecode succeeds on a bare string or number too, so the `is Map` guard is doing real
    // work — without it, `decoded['message']` would throw on a body like `"42"`.
    test('survives a body that is valid JSON but not an object', () {
      expect(spaceAlbumFolderErrorKey('42', _fallback), _fallback);
      expect(spaceAlbumFolderErrorKey('"just a string"', _fallback), _fallback);
      expect(spaceAlbumFolderErrorKey('[1, 2, 3]', _fallback), _fallback);
    });

    test('survives a JSON object with no usable message field', () {
      expect(spaceAlbumFolderErrorKey(jsonEncode({'error': 'Bad Request'}), _fallback), _fallback);
      expect(spaceAlbumFolderErrorKey(jsonEncode({'message': 42}), _fallback), _fallback);
      // A message ARRAY is what class-validator style errors look like; unrecognised, so generic.
      expect(spaceAlbumFolderErrorKey(jsonEncode({'message': <String>[]}), _fallback), _fallback);
    });

    test('falls back for a null, empty, or unrecognised message', () {
      expect(spaceAlbumFolderErrorKey(null, _fallback), _fallback);
      expect(spaceAlbumFolderErrorKey('', _fallback), _fallback);
      expect(spaceAlbumFolderErrorKey(_envelope('Folder not found'), _fallback), _fallback);
      expect(spaceAlbumFolderErrorKey(_envelope('Internal server error'), _fallback), _fallback);
    });

    test('returns whichever fallback the calling action supplied', () {
      expect(spaceAlbumFolderErrorKey(null, 'space_album_folder_error_delete'), 'space_album_folder_error_delete');
      expect(spaceAlbumFolderErrorKey(null, 'space_album_folder_error_move'), 'space_album_folder_error_move');
    });

    // Guards the constants themselves: a fragment that no longer appears in the message it was
    // written for is a silent downgrade to the generic toast, and nothing else here would catch
    // a typo introduced in SpaceAlbumFolderErrors.
    test('every declared fragment actually occurs in the message it targets', () {
      expect(_depthMessage, contains(SpaceAlbumFolderErrors.depthFragment));
      for (final fragment in SpaceAlbumFolderErrors.capFragments) {
        expect(_capMessage, contains(fragment));
      }
      expect(_nameTakenMessage, contains(SpaceAlbumFolderErrors.nameTakenFragment));
    });
  });
}
