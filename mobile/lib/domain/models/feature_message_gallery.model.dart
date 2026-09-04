/// The Gallery fork's "What's new" batch.
///
/// `feature_message.model.dart` is upstream's (immich-29388) and ships upstream's own batch —
/// six Immich 3.0 highlights, stamped `SemVer(3, 0, 0)`. Gallery has its own release line and its
/// own features to announce, so the CONTENT lives here and the upstream file only delegates to
/// it. Two reasons that seam is worth a file:
///
///  1. **Rebases stay cheap.** Upstream edits its list and its release constant every time it
///     publishes a batch. If the fork's content sat in that file, every one of those edits would
///     conflict on exactly the lines the fork rewrote. Delegating means the conflict is two
///     lines that always resolve the same way.
///
///  2. **The version cannot be silently clobbered.** `FeatureMessageService.shouldShow()` is
///     `release > seenRelease`, so adopting upstream's LOWER constant during a rebase would not
///     fail loudly — it would just mean the dialog never fires again for anyone who already saw
///     a Gallery batch. Keeping the number on this side of the seam makes that a deliberate act
///     rather than a merge accident.
///
/// The upstream list is deliberately NOT merged in. It is upstream's batch for upstream's
/// release; re-showing six Immich 3.0 cards to a Gallery user who dismissed them long ago is not
/// what this dialog is for.
///
/// The import back to `feature_message.model.dart` (for [FeatureHighlight]) makes the two
/// libraries mutually importing. That is legal Dart and evaluates fine — the const values do not
/// reference each other in a cycle, only the type does.
library;

import 'package:immich_mobile/domain/models/feature_message.model.dart';
import 'package:immich_mobile/utils/semver.dart';

/// The Gallery release this batch was authored for.
///
/// Content-defined: bump it only when publishing a NEW batch, never from the running app
/// version, and never downward — `shouldShow()` compares it against what the user has already
/// seen. Must stay above upstream's `SemVer(3, 0, 0)` for the same reason.
const galleryFeatureMessageRelease = SemVer(major: 5, minor: 6, patch: 0);

/// Highlights for [galleryFeatureMessageRelease].
///
/// Replace this list wholesale when starting a new batch — it IS the batch, not an archive.
/// Settings → What's new renders the same list, so a stale entry lingers there too.
///
/// `image: null` renders `FeatureMessagePlaceholder` rather than a broken tile, which is the
/// supported way to ship a highlight before its screenshot exists (upstream's own
/// `upload_to_album` entry does the same). Prefer a real one: the image box is a fixed 256dp
/// whether or not it holds anything, so a placeholder costs the same vertical space as a
/// screenshot that actually shows the user what moved.
const List<FeatureHighlight> galleryFeatureMessageHighlights = [
  // The bottom nav's middle slot changed under existing users: Spaces took the slot Albums held.
  // This dialog is the only place they are told, so the body has to carry the way back —
  // Settings → Preferences → Navigation → 'setting_nav_show_spaces'. Keep the copy in step with
  // that switch's own label if it is ever reworded.
  //
  // ROLLING: upstream (immich-31038) turned FeatureHighlight into an ENUM, so a batch entry is an
  // enum MEMBER rather than a `FeatureHighlight(...)` const construction, and the copy lives in the
  // enum's title/body switch (`t.spaces_in_nav_title` / `_body`) instead of titleKey/bodyKey. The
  // seam this file exists for is unchanged: the BATCH and the VERSION stay fork-owned here.
  FeatureHighlight.spacesInNav,
];
