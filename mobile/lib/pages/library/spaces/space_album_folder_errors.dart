/// The server's folder-write rejections, translated into toast keys.
///
/// The API reports every one of these as a plain 400 with an English message and no machine-
/// readable code, so substring matching is the only signal available. That makes these fragments
/// a real contract with the server, not an implementation detail:
/// `SHARED_SPACE_ALBUM_FOLDER_NAME_CONFLICT_MESSAGE`, `SHARED_SPACE_ALBUM_FOLDER_CAP_MESSAGE` and
/// `sharedSpaceAlbumFolderDepthMessage` in `server/src/services/shared-space.service.ts` carry a
/// pointer back here, and `shared-space.service.spec.ts` asserts each message still contains its
/// fragment. Reword a message past its fragment on either side and that test fails, rather than
/// the app quietly falling back to "something went wrong".
///
/// Collected here rather than inlined at the match site so both halves of the contract are one
/// grep apart, and so the mapper itself is unit-testable without a page.
library;

import 'dart:convert';

class SpaceAlbumFolderErrors {
  const SpaceAlbumFolderErrors._();

  /// `Folder nesting is limited to N levels (this would be M)`
  static const depthFragment = 'nesting is limited to';

  /// `A space is limited to N folders`. Two fragments, because the first alone also appears in
  /// the depth message — see [matchOrder].
  static const capFragments = ['is limited to', 'folders'];

  /// `A folder with that name already exists here`
  static const nameTakenFragment = 'already exists here';

  /// Order is load-bearing: [capFragments]'s first entry is a substring of the depth message, so
  /// depth must be tested first or every depth error would report as a folder-cap error. The
  /// server spec additionally pins that the depth message does not contain 'folders', so the two
  /// stay unambiguous even if this order were ever disturbed.
  static const matchOrder = ['depth', 'cap', 'nameTaken'];
}

/// Picks the specific toast key for a folder-write failure, or [fallbackKey] when the failure is
/// not one of the recognised rejections (a network error, a 500, an unrecognised 400).
///
/// [rawMessage] is the API error body: usually a JSON envelope with a `message` field, sometimes
/// plain text. Both are handled — an unparseable body is matched as-is rather than discarded.
String spaceAlbumFolderErrorKey(String? rawMessage, String fallbackKey) {
  var message = rawMessage ?? '';
  try {
    final decoded = jsonDecode(message);
    if (decoded is Map && decoded['message'] is String) {
      message = decoded['message'] as String;
    }
  } catch (_) {
    // Not JSON (e.g. a plain-text body) — match on the raw text as-is.
  }

  if (message.contains(SpaceAlbumFolderErrors.depthFragment)) {
    return 'space_album_folder_depth_exceeded';
  }
  if (SpaceAlbumFolderErrors.capFragments.every(message.contains)) {
    return 'space_album_folder_limit_reached';
  }
  if (message.contains(SpaceAlbumFolderErrors.nameTakenFragment)) {
    return 'space_album_folder_name_taken';
  }
  return fallbackKey;
}
