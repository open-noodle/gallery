import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/platform_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/match_count_label.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';

class MatchCountFooter extends ConsumerWidget {
  const MatchCountFooter({super.key});

  /// Breathing room under the Done button when nothing is drawn below it.
  static const double _basePadding = 20;

  /// Height the footer occupies over the scrolling content it is stacked on
  /// top of, so DeepContent can reserve exactly that much at
  /// the bottom of their lists. Anything less and the last filter row sits
  /// permanently behind the Done bar, unreachable.
  static double reservedHeightFor(BuildContext context) => 88 + systemNavBarInset(context);

  /// Space the device's system navigation bar takes at the bottom of the sheet.
  ///
  /// Android draws that bar ON TOP of the sheet, so on devices still using the
  /// 3-button (back / home / recents) row it covers the Done button and makes
  /// it hard to tap (#1003). Push the button up by whatever the system
  /// reports — 0 on a device that draws no bottom bar at all, so nothing moves
  /// there.
  ///
  /// iOS reports a bottom inset too, but it is the home indicator: nothing is
  /// drawn over the sheet, so honouring it only left dead space under the
  /// button, and a footer that tall also hid the last filter rows behind
  /// itself. Keep iOS on the flat padding it had before #1003.
  ///
  /// Read from [View], NOT from [MediaQuery] — both of MediaQuery's bottom
  /// insets are unusable in this subtree, in opposite directions. Measured on a
  /// 3-button device whose real inset is 48:
  ///
  ///  * `padding.bottom` is inflated, to 100. The sheet lives in the body of a
  ///    `Scaffold(extendBody: true, bottomNavigationBar: GalleryBottomNav)`,
  ///    and such a Scaffold raises the body's bottom padding to the nav bar's
  ///    own height so extended-body content can clear it. That is what the
  ///    original `SafeArea` fix read, so it reserved room for the nav pill —
  ///    which `GalleryBottomNav` hides for as long as this sheet is open.
  ///  * `viewPadding.bottom` is zeroed. Consuming that padding goes through
  ///    `MediaQuery.removePadding`, which also drops viewPadding by the amount
  ///    consumed, `max(0, 48 - 48)`. It reads 0 here with the keyboard down,
  ///    and only springs back to 48 while the keyboard is up (which zeroes the
  ///    padding being consumed).
  ///
  /// `View.of(context).viewPadding` is the engine's own value, ahead of any
  /// MediaQuery rewriting, and measures a stable 48 in both states. It is in
  /// physical pixels, hence the [FlutterView.devicePixelRatio] division.
  @visibleForTesting
  static double systemNavBarInset(BuildContext context) {
    if (!CurrentPlatform.isAndroid) {
      return 0;
    }
    // Subscribe to metrics changes. `View.of` does not: the view's identity is
    // stable across a rotation or a nav-mode switch, so it notifies nobody — and
    // both content widgets hold this footer in a `const` constructor, which a
    // parent rebuild alone will not refresh. The value read below still has to
    // come from the view, for the reasons above.
    MediaQuery.maybeViewPaddingOf(context);
    final view = View.of(context);
    return view.viewPadding.bottom / view.devicePixelRatio;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surface,
      elevation: 6,
      child: Padding(
        padding: EdgeInsets.fromLTRB(20, 12, 12, _basePadding + systemNavBarInset(context)),
        child: Row(
          children: [
            const Expanded(child: MatchCountLabel()),
            FilledButton.tonal(
              key: const Key('match-count-footer-done'),
              onPressed: () => ref.read(photosFilterSheetProvider.notifier).state = FilterSheetVisibility.hidden,
              child: Text(context.t.filter_sheet_done),
            ),
          ],
        ),
      ),
    );
  }
}
