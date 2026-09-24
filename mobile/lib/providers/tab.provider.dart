import 'package:hooks_riverpod/hooks_riverpod.dart';

// ignore: unused-code
enum TabEnum { home, search, spaces, library }

/// Provides the currently active tab
final tabProvider = StateProvider<TabEnum>((ref) => TabEnum.home);
