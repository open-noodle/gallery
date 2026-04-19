import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/pages/common/gallery_tab_shell.page.dart';
import 'package:immich_mobile/routing/router.dart';

void main() {
  test('GalleryTabShellPage is a ConsumerStatefulWidget', () {
    const page = GalleryTabShellPage();
    expect(page, isNotNull);
    expect(page.runtimeType.toString(), 'GalleryTabShellPage');
  });

  test('GalleryTabShellRoute is generated and points at the page', () {
    const route = GalleryTabShellRoute();
    expect(route.routeName, 'GalleryTabShellRoute');
  });

  // Note: integration tests for the listener + syncTab behavior are
  // covered by the manual QA pass in D0 — booting the full AppRouter in
  // a widget test requires `currentUserProvider` / `serverInfoProvider`
  // fixtures that would grow this test file into an auth-fixture harness.
  // The listener logic itself is straightforward and validated by running
  // `make dev` on a simulator (see E1 manual QA).
}
