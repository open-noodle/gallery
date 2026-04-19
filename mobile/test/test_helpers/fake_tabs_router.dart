import 'package:auto_route/auto_route.dart';
import 'package:mocktail/mocktail.dart';

/// Minimal TabsRouter fake used by the gallery-nav tests. Records
/// setActiveIndex calls and exposes a mutable activeIndex.
class FakeTabsRouter extends Fake implements TabsRouter {
  int _active;
  final List<int> setCalls = [];

  FakeTabsRouter({int initialIndex = 0}) : _active = initialIndex;

  @override
  int get activeIndex => _active;

  @override
  void setActiveIndex(int index, {bool notify = true}) {
    setCalls.add(index);
    _active = index;
  }
}
