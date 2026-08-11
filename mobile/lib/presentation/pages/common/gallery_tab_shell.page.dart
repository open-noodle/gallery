import 'package:auto_route/auto_route.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_nav_destination.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

@RoutePage()
class GalleryTabShellPage extends ConsumerStatefulWidget {
  const GalleryTabShellPage({super.key});

  @override
  ConsumerState<GalleryTabShellPage> createState() => _GalleryTabShellPageState();
}

class _GalleryTabShellPageState extends ConsumerState<GalleryTabShellPage> {
  TabsRouter? _router;
  GalleryTabEnum? _lastTab;
  List<GalleryTabEnum>? _lastSlots;

  /// Mirrors the tab OCCUPYING tabsRouter.activeIndex → galleryTabProvider.
  /// Does NOT fire any other side effects: invalidations and ScrollToTopEvent
  /// live in GalleryBottomNav._onTabTap because they also need to fire on
  /// same-tab re-taps (which the listener wouldn't catch).
  ///
  /// Deduped on the resulting TAB, not on the router index: flipping
  /// SettingsKey.navShowSpaces swaps slot 1's occupant while the index stays
  /// put, so an index guard would early-return and leave this provider
  /// reporting the OUTGOING tab. That was unreachable while the slot→tab
  /// mapping was constant.
  void _syncTab() {
    final router = _router;
    if (router == null || !mounted) return;
    final slots = ref.read(galleryNavSlotsProvider);
    // The clamp is unreachable while `routes:` below is built from these same
    // slots — it only guards the frame between a slots change and auto_route
    // rebuilding the tab stack from the new list.
    final tab = slots[router.activeIndex.clamp(0, slots.length - 1)];
    if (tab == _lastTab) return;
    _lastTab = tab;
    ref.read(galleryTabProvider.notifier).state = tab;
  }

  /// Keeps the user on the SLOT they were standing on when the routes list
  /// changes under them, and reconciles galleryTabProvider with its new
  /// occupant.
  ///
  /// auto_route rebuilds the whole tab stack when `AutoTabsRouter.routes`
  /// changes (`_AutoTabsRouterIndexedStackState.didUpdateWidget` →
  /// `TabsRouter.replaceAll`) and re-derives the active index by looking the
  /// OUTGOING route's name up in the new list. Slot 1's occupant is precisely
  /// the route that is no longer in that list, so the lookup misses and
  /// auto_route falls back to index 0 — dropping the user on Photos because
  /// they toggled an unrelated setting. Slot identity is what survives a swap
  /// here, not route identity, so restore the index once the swap has landed.
  ///
  /// Post-frame because the swap happens in auto_route's `didUpdateWidget`,
  /// i.e. after this build returns. The single intervening frame is not
  /// user-visible in practice: the only way to flip the setting is the
  /// Preferences switch, which is pushed over this shell.
  void _restoreSlotAfterSwap() {
    final index = _router?.activeIndex;
    if (index == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _router?.setActiveIndex(index);
      // Not redundant with the listener: setActiveIndex is a no-op (and so
      // notifies nothing) whenever auto_route already landed on `index`, which
      // is every swap that happens off slot 1 — and would be every swap at all
      // if auto_route ever learned to keep the index itself.
      _syncTab();
    });
  }

  @override
  void dispose() {
    _router?.removeListener(_syncTab);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isLandscape = context.orientation == Orientation.landscape;
    final slots = ref.watch(galleryNavSlotsProvider);
    if (_lastSlots != null && !listEquals(_lastSlots, slots)) {
      _restoreSlotAfterSwap();
    }
    _lastSlots = slots;
    return AutoTabsRouter(
      // Built from the same destinations the nav renders, so a slot's tab
      // route and its nav segment can never disagree about what it holds.
      routes: [for (final tab in slots) GalleryNavDestination.forTab(tab).routeBuilder()],
      duration: const Duration(milliseconds: 600),
      transitionBuilder: (_, child, animation) => FadeTransition(opacity: animation, child: child),
      builder: (context, child) {
        final tabsRouter = AutoTabsRouter.of(context);
        if (_router != tabsRouter) {
          _router?.removeListener(_syncTab);
          _router = tabsRouter;
          tabsRouter.addListener(_syncTab);
          WidgetsBinding.instance.addPostFrameCallback((_) => _syncTab());
        }
        return PopScope(
          canPop: tabsRouter.activeIndex == 0,
          onPopInvokedWithResult: (didPop, _) {
            if (!didPop) tabsRouter.setActiveIndex(0);
          },
          child: Scaffold(
            resizeToAvoidBottomInset: false,
            extendBody: true,
            body: isLandscape
                ? Row(
                    children: [
                      GalleryBottomNav(tabsRouter: tabsRouter),
                      const VerticalDivider(),
                      Expanded(child: child),
                    ],
                  )
                : child,
            bottomNavigationBar: isLandscape ? null : GalleryBottomNav(tabsRouter: tabsRouter),
          ),
        );
      },
    );
  }
}
