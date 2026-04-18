import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

extension PumpConsumerWidget on WidgetTester {
  /// Wraps the provided [widget] with Material app such that it becomes:
  ///
  /// ProviderScope
  ///   |-MaterialApp
  ///     |-Material
  ///       |-[widget]
  Future<void> pumpConsumerWidget(
    Widget widget, {
    Duration? duration,
    EnginePhase phase = EnginePhase.sendSemanticsUpdate,
    List<Override> overrides = const [],
  }) async {
    return pumpWidget(
      ProviderScope(
        overrides: overrides,
        child: MaterialApp(debugShowCheckedModeBanner: false, home: Material(child: widget)),
      ),
      duration: duration,
      phase: phase,
    );
  }
}

extension PumpConsumerWidgetDark on WidgetTester {
  /// Same shape as pumpConsumerWidget but forces MaterialApp(theme: dark).
  Future<void> pumpConsumerWidgetDark(Widget widget, {List<Override> overrides = const []}) async {
    return pumpWidget(
      ProviderScope(
        overrides: overrides,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: ThemeData.dark(useMaterial3: true),
          home: Material(child: widget),
        ),
      ),
    );
  }
}

/// Assert a widget's size meets the Material 44×44 minimum tap target.
void expectTapTargetMin(WidgetTester tester, Finder finder, {double min = 44}) {
  final size = tester.getSize(finder);
  expect(size.width, greaterThanOrEqualTo(min), reason: '${finder.description} width');
  expect(size.height, greaterThanOrEqualTo(min), reason: '${finder.description} height');
}
