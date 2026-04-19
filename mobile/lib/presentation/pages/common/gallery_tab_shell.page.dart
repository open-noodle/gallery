import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/routing/router.dart';

@RoutePage()
class GalleryTabShellPage extends ConsumerStatefulWidget {
  const GalleryTabShellPage({super.key});

  @override
  ConsumerState<GalleryTabShellPage> createState() => _GalleryTabShellPageState();
}

class _GalleryTabShellPageState extends ConsumerState<GalleryTabShellPage> {
  TabsRouter? _router;
  int? _lastIndex;

  /// Mirrors tabsRouter.activeIndex → galleryTabProvider whenever the index
  /// changes. Does NOT fire any other side effects: invalidations and
  /// ScrollToTopEvent live in GalleryBottomNav._onTabTap because they also
  /// need to fire on same-tab re-taps (which the listener wouldn't catch).
  void _syncTab() {
    final router = _router;
    if (router == null || !mounted) return;
    final i = router.activeIndex;
    if (i == _lastIndex) return;
    _lastIndex = i;
    ref.read(galleryTabProvider.notifier).state = GalleryTabEnum.values[i];
  }

  @override
  void dispose() {
    _router?.removeListener(_syncTab);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isLandscape = context.orientation == Orientation.landscape;
    return AutoTabsRouter(
      routes: const [MainTimelineRoute(), DriftAlbumsRoute(), DriftLibraryRoute()],
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
