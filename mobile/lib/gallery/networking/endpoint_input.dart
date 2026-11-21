import 'package:immich_mobile/gallery/networking/external_endpoints.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/models/auth/auxilary_endpoint.model.dart';
import 'package:immich_mobile/providers/auth.provider.dart';
import 'package:immich_mobile/widgets/settings/networking_settings/endpoint_input.dart';

/// Keep upstream's input, icons and controls; save independently of its live connection check.
class GalleryEndpointInput extends EndpointInput {
  const GalleryEndpointInput({
    super.key,
    required super.initialValue,
    required super.index,
    required super.onValidated,
    required super.onDismissed,
    super.enabled,
  });

  @override
  EndpointInputState createState() => _GalleryEndpointInputState();
}

class _GalleryEndpointInputState extends EndpointInputState {
  int _checkSequence = 0;

  @override
  String? validateUrl(String? url) {
    isInputValid = url != null && isExternalEndpointUrl(url);
    return isInputValid ? null : context.t.validate_endpoint_error;
  }

  @override
  Future<void> validateAuxilaryServerUrl() async {
    final url = controller.text.trim();
    if (!isExternalEndpointUrl(url)) {
      return;
    }
    final sequence = ++_checkSequence;
    setState(() => auxCheckStatus = AuxCheckStatus.loading);
    await widget.onValidated(url, widget.index, AuxCheckStatus.loading);
    if (!mounted || sequence != _checkSequence || controller.text.trim() != url) {
      return;
    }

    var valid = false;
    try {
      valid = await ref.read(authProvider.notifier).validateAuxilaryServerUrl(url);
    } catch (_) {
      // An unexpected check failure is still only a reachability result.
    }
    if (!mounted || sequence != _checkSequence || controller.text.trim() != url) {
      return;
    }
    setState(() => auxCheckStatus = valid ? AuxCheckStatus.valid : AuxCheckStatus.error);
    await widget.onValidated(url, widget.index, auxCheckStatus);
  }
}
