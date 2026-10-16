import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart' hide Store;
import 'package:fluttertoast/fluttertoast.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/models/auth/login_response.model.dart';
import 'package:immich_mobile/providers/auth.provider.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_mobile/utils/provider_utils.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:immich_ui/immich_ui.dart';
import 'package:logging/logging.dart';

const _demoServerUrl = 'https://demo.opennoodle.de';

/// The login form's "Try the demo" button: signs into the Gallery demo server, then hands the
/// response to the form's [onLoggedIn] (the same post-login flow a password login runs).
class GalleryDemoLoginButton extends HookConsumerWidget {
  final TextEditingController serverEndpointController;
  final Future<void> Function(LoginResponse result) onLoggedIn;

  const GalleryDemoLoginButton({super.key, required this.serverEndpointController, required this.onLoggedIn});

  static final _log = Logger('LoginForm');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isDemoLoginLoading = useState<bool>(false);

    Future<void> demoLogin() async {
      if (isDemoLoginLoading.value) {
        return;
      }

      TextInput.finishAutofillContext();
      isDemoLoginLoading.value = true;

      try {
        serverEndpointController.text = _demoServerUrl;
        await ref.read(authProvider.notifier).validateServerUrl(_demoServerUrl);

        // Invalidate all api repository provider instance to take into account the demo endpoint and access token.
        invalidateAllApiRepositoryProviders(ref);

        await ref.read(serverInfoProvider.notifier).getServerInfo();
        final result = await ref.read(authProvider.notifier).demoLogin();
        await onLoggedIn(result);
      } catch (error, stack) {
        _log.severe('Error logging into demo mode: $error', error, stack);

        if (!context.mounted) {
          return;
        }

        ImmichToast.show(
          context: context,
          msg: context.t.login_form_failed_demo_login,
          toastType: ToastType.error,
          gravity: ToastGravity.TOP,
        );
      } finally {
        isDemoLoginLoading.value = false;
      }
    }

    return ImmichTextButton(
      labelText: context.t.login_form_try_demo,
      icon: Icons.travel_explore_rounded,
      variant: ImmichVariant.ghost,
      loading: isDemoLoginLoading.value,
      onPressed: demoLogin,
    );
  }
}
