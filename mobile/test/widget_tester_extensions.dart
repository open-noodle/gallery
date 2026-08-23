import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/locales.dart';
import 'package:immich_mobile/generated/codegen_loader.g.dart';

extension PumpConsumerWidget on WidgetTester {
  /// Wraps the provided [widget] with a localized Material app such that it
  /// becomes:
  ///
  /// EasyLocalization
  ///   |-ProviderScope
  ///     |-MaterialApp (localization delegates wired up)
  ///       |-Material
  ///         |-[widget]
  ///
  Future<void> pumpConsumerWidget(
    Widget widget, {
    Duration? duration,
    EnginePhase phase = EnginePhase.sendSemanticsUpdate,
    List<Override> overrides = const [],
  }) async {
    await pumpWidget(
      _localized(
        ProviderScope(
          overrides: overrides,
          child: _MaterialHost(child: widget),
        ),
      ),
      duration: duration,
      phase: phase,
    );
    await pumpAndSettle();
  }
}

extension PumpConsumerWidgetRaw on WidgetTester {
  /// Fork helper: `pumpConsumerWidget` without the trailing `pumpAndSettle()`.
  /// Use this for tests that assert a still-animating state (e.g. a loading
  /// spinner) where the localized helper's automatic `pumpAndSettle()` would
  /// never settle and time out. The caller controls settling via `pump()` /
  /// `pumpAndSettle()`.
  ///
  /// It still wraps in [EasyLocalization]: upstream's translations migration
  /// (#30667..#30672) routes every string through `context.t`, which resolves via
  /// `EasyLocalization.of(context)!` and therefore throws without that ancestor.
  /// Skipping `pumpAndSettle()` — not skipping localization — is this helper's
  /// reason to exist.
  Future<void> pumpConsumerWidgetRaw(
    Widget widget, {
    Duration? duration,
    EnginePhase phase = EnginePhase.sendSemanticsUpdate,
    List<Override> overrides = const [],
  }) async {
    await pumpWidget(
      _localized(
        ProviderScope(
          overrides: overrides,
          child: _MaterialHost(child: widget),
        ),
      ),
      duration: duration,
      phase: phase,
    );
    // One frame lets EasyLocalization's async bundle load resolve so the child is
    // mounted. Deliberately NOT pumpAndSettle() — that is what this helper avoids.
    await pump();
  }
}

extension PumpConsumerWidgetDark on WidgetTester {
  /// Same shape as pumpConsumerWidget but forces MaterialApp(theme: dark).
  /// Localized for the same reason as [PumpConsumerWidgetRaw.pumpConsumerWidgetRaw].
  Future<void> pumpConsumerWidgetDark(Widget widget, {List<Override> overrides = const []}) async {
    await pumpWidget(
      _localized(
        ProviderScope(
          overrides: overrides,
          child: _MaterialHost(theme: ThemeData.dark(useMaterial3: true), child: widget),
        ),
      ),
    );
    await pumpAndSettle();
  }
}

/// Wraps [child] in the same [EasyLocalization] configuration the app uses, so
/// `context.t` resolves in widget tests.
///
/// Use this for tests that build their own `MaterialApp`/`ProviderScope` tree
/// instead of going through the pump helpers above. Without it, upstream's
/// generated accessor (`context.t`) throws, because it resolves via
/// `EasyLocalization.of(context)!`.
Widget localizedForTest(Widget child) => _localized(child);

Widget _localized(Widget child) => EasyLocalization(
  supportedLocales: locales.values.toList(),
  path: translationsPath,
  startLocale: locales.values.first,
  fallbackLocale: locales.values.first,
  saveLocale: false,
  useFallbackTranslations: true,
  assetLoader: const CodegenLoader(),
  child: child,
);

// The timeline embeds a [BackButtonListener] (upstream immich-30689), which resolves its dispatcher
// via `Router.of(context)` and throws without a [Router] ancestor. The running app always has one
// via `MaterialApp.router`; this host is a plain [MaterialApp], so supply a minimal Router. Mirrors
// the stub upstream added to its own timeline test for the same reason.
class _StubRouterDelegate extends RouterDelegate<void> with ChangeNotifier {
  _StubRouterDelegate(this.child);

  final Widget child;

  @override
  Widget build(BuildContext context) => child;

  @override
  Future<bool> popRoute() => Future.value(false);

  @override
  Future<void> setNewRoutePath(void configuration) => Future.value();
}

/// Wrap [child] in a minimal [Router] so a [BackButtonListener] beneath it can resolve its
/// dispatcher. Tests that build their own [MaterialApp] around a timeline-bearing page need this;
/// [pumpConsumerWidget] and friends already apply it.
Widget withStubRouter(Widget child) =>
    Router<void>(routerDelegate: _StubRouterDelegate(child), backButtonDispatcher: RootBackButtonDispatcher());

class _MaterialHost extends StatelessWidget {
  const _MaterialHost({required this.child, this.theme});

  final Widget child;
  final ThemeData? theme;

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: theme,
    localizationsDelegates: context.localizationDelegates,
    supportedLocales: context.supportedLocales,
    locale: context.locale,
    home: Material(child: withStubRouter(child)),
  );
}

/// Assert a widget's size meets the Material 48×48 minimum tap target (kMinInteractiveDimension).
void expectTapTargetMin(WidgetTester tester, Finder finder, {double min = 48}) {
  final size = tester.getSize(finder);
  final desc = finder.describeMatch(Plurality.one);
  expect(size.width, greaterThanOrEqualTo(min), reason: '$desc width');
  expect(size.height, greaterThanOrEqualTo(min), reason: '$desc height');
}
