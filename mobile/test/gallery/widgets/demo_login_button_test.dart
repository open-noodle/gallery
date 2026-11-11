import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/widgets/demo_login_button.dart';
import 'package:immich_mobile/models/auth/login_response.model.dart';
import 'package:immich_mobile/models/server_info/server_info.model.dart';
import 'package:immich_mobile/models/server_info/server_version.model.dart';
import 'package:immich_mobile/providers/auth.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';

import '../../infrastructure/repository.mock.dart';
import '../../service.mocks.dart';
import '../../widget_tester_extensions.dart';

const _demoResponse = LoginResponse(
  accessToken: 'demo-token',
  isAdmin: false,
  name: 'Demo User',
  profileImagePath: '',
  shouldChangePassword: false,
  userEmail: 'demo@example.com',
  userId: 'demo-user',
);

// Kept outside the notifier: the button's invalidation rebuilds it mid-login.
final _validatedUrls = <String>[];

/// Like the real one, it depends on an api repository the button invalidates, and uses its own ref while
/// logging in. A notifier read before that invalidation is stale, and Riverpod rejects its ref.
class _FakeAuthNotifier extends AuthNotifier {
  _FakeAuthNotifier(this._ref)
    : super(
        MockAuthService(),
        MockApiService(),
        MockUserService(),
        MockSecureStorageService(),
        MockWidgetService(),
        _ref,
      ) {
    _ref.watch(userApiRepositoryProvider);
  }

  final Ref _ref;

  @override
  Future<String> validateServerUrl(String url) async {
    _validatedUrls.add(url);
    return url;
  }

  @override
  Future<LoginResponse> demoLogin() async {
    await Future<void>.delayed(Duration.zero);
    // The real login saves the session through its ref.
    _ref.read(userApiRepositoryProvider);
    return _demoResponse;
  }
}

/// Fetching server info changes the provider's state, as the real one does once the server answers.
class _FakeServerInfoNotifier extends ServerInfoNotifier {
  _FakeServerInfoNotifier() : super(MockServerInfoService());

  @override
  Future<ServerInfo> getServerInfo() async {
    await Future<void>.delayed(Duration.zero);
    state = state.copyWith(serverVersion: const ServerVersion(major: 5, minor: 10, patch: 0));
    // A real fetch spans frames, so the form rebuilds before the login continues. Wait for one here.
    await WidgetsBinding.instance.endOfFrame;
    return state;
  }
}

/// Mirrors how the upstream login form (lib/widgets/forms/login/login_form.dart) hosts the button: it
/// watches serverInfoProvider and builds a new GlobalKey for its Form on every build, so a server-info
/// change recreates everything inside the Form, the button included, while the login is still running.
class _LoginFormShape extends HookConsumerWidget {
  const _LoginFormShape({required this.onLoggedIn});

  final Future<void> Function(LoginResponse) onLoggedIn;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(serverInfoProvider);
    final controller = useTextEditingController();
    final formKey = GlobalKey<FormState>();

    return Form(
      key: formKey,
      child: GalleryDemoLoginButton(serverEndpointController: controller, onLoggedIn: onLoggedIn),
    );
  }
}

void main() {
  testWidgets('Try Demo finishes the login when the form rebuilds around it mid-login', (tester) async {
    _validatedUrls.clear();
    final loggedIn = <LoginResponse>[];

    await tester.pumpConsumerWidget(
      _LoginFormShape(onLoggedIn: (result) async => loggedIn.add(result)),
      overrides: [
        authProvider.overrideWith(_FakeAuthNotifier.new),
        serverInfoProvider.overrideWith((_) => _FakeServerInfoNotifier()),
        userApiRepositoryProvider.overrideWith((_) => MockUserApiRepository()),
      ],
    );

    await tester.tap(find.text('Try Demo'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(_validatedUrls, ['https://demo.opennoodle.de']);
    expect(loggedIn, [_demoResponse]);
  });
}
