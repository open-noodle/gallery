import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/events.model.dart';
import 'package:immich_mobile/domain/utils/event_stream.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/haptic_feedback.provider.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/tab.provider.dart';
import 'package:immich_mobile/routing/router.dart';

@RoutePage()
class TabShellPage extends ConsumerStatefulWidget {
  const TabShellPage({super.key});

  @override
  ConsumerState<TabShellPage> createState() => _TabShellPageState();
}

class _TabShellPageState extends ConsumerState<TabShellPage> {
  @override
  Widget build(BuildContext context) {
    final isScreenLandscape = context.orientation == Orientation.landscape;
    final isReadonlyModeEnabled = ref.watch(readonlyModeProvider);

    final navigationDestinations = [
      NavigationDestination(
        label: context.t.photos,
        icon: const Icon(Icons.photo_library_outlined),
        selectedIcon: Icon(Icons.photo_library, color: context.primaryColor),
      ),
      NavigationDestination(
        label: 'Spaces',
        icon: const Icon(Icons.workspaces_outlined),
        selectedIcon: Icon(Icons.workspaces, color: context.primaryColor),
        enabled: !isReadonlyModeEnabled,
      ),
      NavigationDestination(
        label: context.t.library$,
        icon: const Icon(Icons.space_dashboard_outlined),
        selectedIcon: Icon(Icons.space_dashboard_rounded, color: context.primaryColor),
        enabled: !isReadonlyModeEnabled,
      ),
    ];

    Widget navigationRail(TabsRouter tabsRouter) {
      return NavigationRail(
        destinations: navigationDestinations
            .map(
              (e) => NavigationRailDestination(
                icon: e.icon,
                label: Text(e.label),
                selectedIcon: e.selectedIcon,
                disabled: !e.enabled,
              ),
            )
            .toList(),
        onDestinationSelected: (index) => _onNavigationSelected(tabsRouter, index, ref),
        selectedIndex: tabsRouter.activeIndex,
        labelType: NavigationRailLabelType.all,
        groupAlignment: 0.0,
      );
    }

    return AutoTabsRouter(
      routes: const [MainTimelineRoute(), SpacesRoute(), LibraryRoute()],
      duration: const Duration(milliseconds: 600),
      transitionBuilder: (context, child, animation) => FadeTransition(opacity: animation, child: child),
      builder: (context, child) {
        final tabsRouter = AutoTabsRouter.of(context);
        return PopScope(
          canPop: tabsRouter.activeIndex == 0,
          onPopInvokedWithResult: (didPop, _) => !didPop ? tabsRouter.setActiveIndex(0) : null,
          child: Scaffold(
            resizeToAvoidBottomInset: false,
            body: isScreenLandscape
                ? Row(
                    children: [
                      navigationRail(tabsRouter),
                      const VerticalDivider(),
                      Expanded(child: child),
                    ],
                  )
                : child,
            bottomNavigationBar: _BottomNavigationBar(tabsRouter: tabsRouter, destinations: navigationDestinations),
          ),
        );
      },
    );
  }
}

/// A section of the fork's 3-tab legacy [TabShellPage] shell, whose
/// `AutoTabsRouter` routes are `[MainTimelineRoute, SpacesRoute,
/// LibraryRoute]` — Photos = 0, Spaces = 1, Library = 2.
enum TabShellSection { photos, spaces, library, other }

/// Maps a bottom-nav index to its [TabShellSection] for the fork's 3-tab
/// layout. Intentionally NOT keyed on the upstream 4-tab constants in
/// `constants.dart` (`kSpacesTabIndex = 2`, `kLibraryTabIndex = 3`), which are
/// left untouched for rebase hygiene (see `gallery_tab_enum.dart`) and describe
/// the upstream layout — using them here made tab switches off-by-one (finding
/// LOW #14: Spaces invalidated nothing, Library invalidated Spaces).
TabShellSection tabShellSectionForIndex(int index) {
  switch (index) {
    case 0:
      return TabShellSection.photos;
    case 1:
      return TabShellSection.spaces;
    case 2:
      return TabShellSection.library;
    default:
      return TabShellSection.other;
  }
}

TabEnum _tabEnumForSection(TabShellSection section) {
  switch (section) {
    case TabShellSection.photos:
    case TabShellSection.other:
      return TabEnum.home;
    case TabShellSection.spaces:
      return TabEnum.spaces;
    case TabShellSection.library:
      return TabEnum.library;
  }
}

void _onNavigationSelected(TabsRouter router, int index, WidgetRef ref) {
  final section = tabShellSectionForIndex(index);

  // On Photos page menu tapped
  if (router.activeIndex == index && section == TabShellSection.photos) {
    EventStream.shared.emit(const ScrollToTopEvent());
  }

  if (section == TabShellSection.photos) {
    ref.invalidate(memoryLaneProvider);
  }

  // Spaces page
  if (section == TabShellSection.spaces) {
    ref.invalidate(sharedSpacesProvider);
  }

  // Library page
  if (section == TabShellSection.library) {
    ref.invalidate(localAlbumProvider);
    // The local list is a Drift stream now, so upstream's invalidate of it is correctly gone.
    // The server-backed lists are NOT reactive and must still be invalidated here.
    ref.invalidateServerPeopleLists();
  }

  ref.read(hapticFeedbackProvider.notifier).selectionClick();
  router.setActiveIndex(index);
  ref.read(tabProvider.notifier).state = _tabEnumForSection(section);
}

class _BottomNavigationBar extends ConsumerStatefulWidget {
  const _BottomNavigationBar({required this.tabsRouter, required this.destinations});

  final List<Widget> destinations;
  final TabsRouter tabsRouter;

  @override
  ConsumerState createState() => _BottomNavigationBarState();
}

class _BottomNavigationBarState extends ConsumerState<_BottomNavigationBar> {
  bool hideNavigationBar = false;
  StreamSubscription? _eventSubscription;

  @override
  void initState() {
    super.initState();
    _eventSubscription = EventStream.shared.listen<MultiSelectToggleEvent>(_onEvent);
  }

  void _onEvent(MultiSelectToggleEvent event) {
    setState(() {
      hideNavigationBar = event.isEnabled;
    });
  }

  @override
  void dispose() {
    unawaited(_eventSubscription?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isScreenLandscape = context.orientation == Orientation.landscape;

    if (isScreenLandscape || hideNavigationBar) {
      return const SizedBox.shrink();
    }

    return NavigationBar(
      selectedIndex: widget.tabsRouter.activeIndex,
      onDestinationSelected: (index) => _onNavigationSelected(widget.tabsRouter, index, ref),
      destinations: widget.destinations,
    );
  }
}
