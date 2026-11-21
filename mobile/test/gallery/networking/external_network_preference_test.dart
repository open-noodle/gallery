import 'dart:async';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/models/auth/auxilary_endpoint.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/auth.provider.dart';
import 'package:immich_mobile/widgets/settings/networking_settings/endpoint_input.dart';
import 'package:immich_mobile/widgets/settings/networking_settings/external_network_preference.dart';
import 'package:mocktail/mocktail.dart';

import '../../service.mocks.dart';
import '../../widget_tester_extensions.dart';

class _TestAuthNotifier extends AuthNotifier {
  _TestAuthNotifier(Ref ref, this.check)
    : super(
        MockAuthService(),
        MockApiService(),
        MockUserService(),
        MockSecureStorageService(),
        MockWidgetService(),
        ref,
      );

  final Future<bool> Function(String) check;

  @override
  Future<bool> validateAuxilaryServerUrl(String url) => check(url);
}

void main() {
  late Drift db;
  late SettingsRepository settings;
  late MockApiService api;
  final input = find.byWidgetPredicate((widget) => widget is EndpointInput);
  const endpoint = 'https://photos.example.com';

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await SettingsRepository.reset();
    settings = await SettingsRepository.ensureInitialized(db);
  });

  setUp(() async {
    await settings.clear([SettingsKey.networkExternalEndpointList]);
    api = MockApiService();
    when(() => api.updateHeaders()).thenAnswer((_) async {});
  });

  tearDownAll(() async {
    await SettingsRepository.reset();
    await db.close();
  });

  Future<void> mount(WidgetTester tester, {Future<bool> Function(String)? check}) => tester.pumpConsumerWidget(
    const Scaffold(body: SingleChildScrollView(child: ExternalNetworkPreference(enabled: true))),
    overrides: [
      apiServiceProvider.overrideWithValue(api),
      authProvider.overrideWith((ref) => _TestAuthNotifier(ref, check ?? (_) async => false)),
    ],
  );

  for (final status in [AuxCheckStatus.valid, AuxCheckStatus.error, AuxCheckStatus.loading, AuxCheckStatus.unknown]) {
    testWidgets('saves a valid URL with ${status.name} reachability', (tester) async {
      await mount(tester);
      await tester.widget<EndpointInput>(input.first).onValidated(endpoint, 0, status);
      await tester.pumpAndSettle();
      expect(settings.appConfig.network.externalEndpointList, [endpoint]);
      verify(() => api.updateHeaders()).called(1);
    });
  }

  testWidgets('does not save malformed or unsupported URLs', (tester) async {
    await mount(tester);
    for (final value in ['not-a-url', 'ftp://photos.example.com', 'https://', '']) {
      await tester.widget<EndpointInput>(input.first).onValidated(value, 0, AuxCheckStatus.error);
      await tester.pumpAndSettle();
      expect(settings.appConfig.network.externalEndpointList, isEmpty);
    }
  });

  testWidgets('retains other entries when one URL fails its live check', (tester) async {
    await settings.write(SettingsKey.networkExternalEndpointList, ['https://first.example.com', endpoint]);
    await mount(tester);
    await tester.widget<EndpointInput>(input.last).onValidated(endpoint, 1, AuxCheckStatus.error);
    await tester.pumpAndSettle();
    expect(settings.appConfig.network.externalEndpointList, ['https://first.example.com', endpoint]);
  });

  testWidgets('persists the entered URL before the live check finishes and keeps the failure status', (tester) async {
    final checked = <String>[];
    final response = Completer<bool>();
    await mount(
      tester,
      check: (url) {
        checked.add(url);
        return response.future;
      },
    );
    await tester.enterText(find.byType(TextFormField).first, endpoint);
    await tester.pump();
    tester.state<EndpointInputState>(input.first).focusNode.unfocus();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(settings.appConfig.network.externalEndpointList, [endpoint]);
    expect(checked, [endpoint]);
    response.complete(false);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('error')), findsOneWidget);
    expect(settings.appConfig.network.externalEndpointList, [endpoint]);
    expect(tester.takeException(), isNull);
  });

  testWidgets('does not apply a late check result after the row is disposed', (tester) async {
    final response = Completer<bool>();
    await mount(tester, check: (_) => response.future);
    await tester.enterText(find.byType(TextFormField).first, endpoint);
    await tester.pump();
    tester.state<EndpointInputState>(input.first).focusNode.unfocus();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pumpWidget(const SizedBox.shrink());
    response.complete(false);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(settings.appConfig.network.externalEndpointList, [endpoint]);
  });

  testWidgets('an older check cannot replace a newer address or its success status', (tester) async {
    const newer = 'https://new.example.com';
    final first = Completer<bool>();
    final second = Completer<bool>();
    await mount(tester, check: (url) => url == endpoint ? first.future : second.future);
    await tester.enterText(find.byType(TextFormField).first, endpoint);
    await tester.pump();
    tester.state<EndpointInputState>(input.first).focusNode.unfocus();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.enterText(find.byType(TextFormField).first, newer);
    await tester.pump();
    tester.state<EndpointInputState>(input.first).focusNode.unfocus();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    second.complete(true);
    await tester.pumpAndSettle();
    first.complete(false);
    await tester.pumpAndSettle();
    expect(settings.appConfig.network.externalEndpointList, [newer]);
    expect(find.byKey(const ValueKey('success')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an unexpected live-check error leaves the saved URL and shows failure', (tester) async {
    await mount(tester, check: (_) => Future<bool>.error(StateError('Connection failed')));
    await tester.enterText(find.byType(TextFormField).first, endpoint);
    await tester.pump();
    tester.state<EndpointInputState>(input.first).focusNode.unfocus();
    await tester.pumpAndSettle();
    expect(settings.appConfig.network.externalEndpointList, [endpoint]);
    expect(find.byKey(const ValueKey('error')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
