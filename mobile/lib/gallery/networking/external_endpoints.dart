import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/models/auth/auxilary_endpoint.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';

/// Reachability is a status, not proof that an address can be saved for another network.
bool isExternalEndpointUrl(String value) {
  final uri = Uri.tryParse(value.trim());
  return uri != null && (uri.scheme == 'https' || uri.scheme == 'http') && uri.host.isNotEmpty;
}

List<String> externalEndpointUrls(List<AuxilaryEndpoint> entries) =>
    entries.map((entry) => entry.url.trim()).where(isExternalEndpointUrl).toList();

Future<void> saveExternalEndpointList(WidgetRef ref, List<AuxilaryEndpoint> entries) async {
  await ref.read(settingsProvider).write(SettingsKey.networkExternalEndpointList, externalEndpointUrls(entries));
  if (ref.context.mounted) {
    await ref.read(apiServiceProvider).updateHeaders();
  }
}
