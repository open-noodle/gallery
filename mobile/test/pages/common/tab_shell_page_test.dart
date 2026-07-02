import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/pages/common/tab_shell.page.dart';

// Slice 7 (finding LOW #14): the fork converted the legacy TabShellPage to a
// 3-tab layout ([MainTimelineRoute, SpacesRoute, DriftLibraryRoute] →
// Photos = 0, Spaces = 1, Library = 2) but left its tab-switch logic keyed on
// the upstream 4-tab constants (kSpacesTabIndex = 2, kLibraryTabIndex = 3), so
// tapping Spaces invalidated nothing and tapping Library invalidated Spaces.
void main() {
  group('tabShellSectionForIndex (fork 3-tab legacy shell)', () {
    test('maps Photos to index 0', () {
      expect(tabShellSectionForIndex(0), TabShellSection.photos);
    });

    test('maps Spaces to index 1 (not the upstream 4-tab index 2)', () {
      expect(tabShellSectionForIndex(1), TabShellSection.spaces);
    });

    test('maps Library to index 2 (not the upstream 4-tab index 3)', () {
      expect(tabShellSectionForIndex(2), TabShellSection.library);
    });

    test('returns other for the vanished 4th tab and out-of-range indices', () {
      expect(tabShellSectionForIndex(3), TabShellSection.other);
      expect(tabShellSectionForIndex(-1), TabShellSection.other);
    });
  });
}
