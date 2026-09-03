import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/match_count_footer.widget.dart';

import '../../../widget_tester_extensions.dart';

const _dpr = 3.0;
const _screen = Size(1080, 2400);
const _screenHeight = 800.0; // logical px

/// The footer's own breathing room under the Done button.
const _basePadding = 20.0;

/// Logical px — simulates the Android 3-button (back / home / recents) nav bar,
/// which is drawn ON TOP of the sheet.
const _navBarInset = 48.0;

/// Logical px — what iOS reports for the home indicator. Nothing is drawn over
/// the sheet there, so the footer must not reserve it.
const _homeIndicatorInset = 34.0;

/// Logical px — the filter sheet lives in the body of a
/// `Scaffold(extendBody: true, bottomNavigationBar: GalleryBottomNav)`, and such
/// a Scaffold inflates the body's `MediaQuery.padding.bottom` to the nav bar's
/// own height so extended-body content can clear it. The footer must not read
/// that: the nav pill it accounts for is hidden while the sheet is open.
/// Measured at 100 on the emulator against a real 48 system inset.
const _inflatedPadding = 100.0;

/// Sets the system inset ([FlutterView.viewPadding]) and, separately, the
/// Scaffold-inflated [FlutterView.padding] the footer must ignore.
void _fakeInsets(WidgetTester tester, {required double systemInset}) {
  tester.view.physicalSize = _screen;
  tester.view.devicePixelRatio = _dpr;
  tester.view.viewPadding = FakeViewPadding(bottom: systemInset * _dpr);
  tester.view.padding = const FakeViewPadding(bottom: _inflatedPadding * _dpr);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetViewPadding);
  addTearDown(tester.view.resetPadding);
}

/// Pins the target platform for one test. `TargetPlatformVariant` rather than a
/// setUp/tearDown pair: the binding asserts that foundation debug vars are unset
/// as soon as the test body returns, before any tearDown runs.
final _android = TargetPlatformVariant.only(TargetPlatform.android);
final _ios = TargetPlatformVariant.only(TargetPlatform.iOS);

Future<void> _pumpFooter(WidgetTester tester) =>
    tester.pumpConsumerWidget(const Align(alignment: Alignment.bottomCenter, child: MatchCountFooter()));

/// Pumps the footer under a `MediaQuery.removePadding`, reproducing what the
/// real tree does to it: consuming the bottom padding also drops
/// `MediaQuery.viewPadding.bottom` to `max(0, systemInset - consumed)`, which is
/// 0 once the inflated padding is consumed. Only the raw [View] still knows the
/// true inset.
Future<void> _pumpFooterUnderRemovedPadding(WidgetTester tester) => tester.pumpConsumerWidget(
  Align(
    alignment: Alignment.bottomCenter,
    child: Builder(
      builder: (ctx) => MediaQuery.removePadding(context: ctx, removeBottom: true, child: const MatchCountFooter()),
    ),
  ),
);

double _gapUnderButton(WidgetTester tester) =>
    _screenHeight - tester.getBottomLeft(find.byKey(const Key('match-count-footer-done'))).dy;

/// DeepContent pads the bottom of its list by this much to
/// clear the footer stacked on top of them. If it were smaller than the footer,
/// the last filter row would sit behind the Done bar, unreachable.
void _expectReserveCoversFooter(WidgetTester tester) {
  final reserved = MatchCountFooter.reservedHeightFor(tester.element(find.byType(MatchCountFooter)));
  expect(tester.getSize(find.byType(MatchCountFooter)).height, lessThanOrEqualTo(reserved));
}

void main() {
  group('MatchCountFooter on Android', () {
    testWidgets('keeps the Done button clear of the system nav bar', (tester) async {
      _fakeInsets(tester, systemInset: _navBarInset);

      await _pumpFooter(tester);

      // The nav bar occupies [screenHeight - inset, screenHeight]. The Done
      // button must not extend into that zone, or it becomes unreachable (#1003).
      final buttonBottom = tester.getBottomLeft(find.byKey(const Key('match-count-footer-done'))).dy;
      expect(buttonBottom, lessThanOrEqualTo(_screenHeight - _navBarInset));

      // ...and it clears the bar by exactly the bar, not by the Scaffold-inflated
      // padding: the nav pill that padding accounts for is hidden here.
      expect(_gapUnderButton(tester), closeTo(_basePadding + _navBarInset, 0.5));
    }, variant: _android);

    testWidgets('adds no inset on a device that reports no bottom bar', (tester) async {
      _fakeInsets(tester, systemInset: 0);

      await _pumpFooter(tester);

      expect(_gapUnderButton(tester), closeTo(_basePadding, 0.5));
    }, variant: _android);

    testWidgets('still clears the bar when an ancestor has consumed the padding', (tester) async {
      _fakeInsets(tester, systemInset: _navBarInset);

      await _pumpFooterUnderRemovedPadding(tester);

      // MediaQuery.viewPadding.bottom is 0 in this subtree; the engine's is not.
      expect(_gapUnderButton(tester), closeTo(_basePadding + _navBarInset, 0.5));
    }, variant: _android);

    testWidgets('reserves enough room for the taller footer', (tester) async {
      _fakeInsets(tester, systemInset: _navBarInset);

      await _pumpFooter(tester);

      _expectReserveCoversFooter(tester);
    }, variant: _android);
  });

  group('MatchCountFooter on iOS', () {
    testWidgets('does not reserve the home indicator under the Done button', (tester) async {
      _fakeInsets(tester, systemInset: _homeIndicatorInset);

      await _pumpFooter(tester);

      // iOS draws nothing over the sheet, so the button keeps only the footer's
      // own breathing room — not 20 + 34, and certainly not 20 + 90.
      expect(_gapUnderButton(tester), closeTo(_basePadding, 0.5));
    }, variant: _ios);

    testWidgets('reserves enough room for the footer', (tester) async {
      _fakeInsets(tester, systemInset: _homeIndicatorInset);

      await _pumpFooter(tester);

      _expectReserveCoversFooter(tester);
    }, variant: _ios);
  });
}
