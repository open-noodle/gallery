import 'package:auto_route/auto_route.dart';
import 'package:flutter/widgets.dart';
import 'package:mocktail/mocktail.dart';

/// Records the routes a page pushes or replaces, without an app router behind it.
///
/// `context.pushRoute` resolves `StackRouterScope.of(context)!.controller`, and a widget test has
/// no router at all — so every page path that ends in a navigation used to be untestable, and the
/// success half of "create a game, then open it" was simply left uncovered. Wrapping the widget in
/// [withFakeRouter] supplies a controller that records instead of navigating, which makes those
/// paths assertable and keeps the push from throwing into the zone as an unhandled async error.
///
/// `Fake`, not `Mock`: anything this does not implement throws loudly rather than silently
/// returning null, so a page that starts using some other router method cannot pass by accident.
class FakeStackRouter extends Fake implements StackRouter {
  final List<PageRouteInfo> pushed = [];
  final List<PageRouteInfo> replaced = [];

  @override
  Future<T?> push<T extends Object?>(PageRouteInfo route, {OnNavigationFailure? onFailure}) async {
    pushed.add(route);
    return null;
  }

  @override
  Future<T?> replace<T extends Object?>(PageRouteInfo route, {OnNavigationFailure? onFailure}) async {
    replaced.add(route);
    return null;
  }
}

/// Wraps [child] so `context.pushRoute` / `context.replaceRoute` below it reach [router].
Widget withFakeRouter(FakeStackRouter router, Widget child) =>
    StackRouterScope(controller: router, stateHash: 0, child: child);
