import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/gallery/networking/endpoint_input.dart';
import 'package:immich_mobile/gallery/networking/external_endpoints.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/models/auth/auxilary_endpoint.model.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';

class ExternalNetworkPreference extends HookConsumerWidget {
  const ExternalNetworkPreference({super.key, required this.enabled});

  final bool enabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final entries = useState([const AuxilaryEndpoint(url: '', status: AuxCheckStatus.unknown)]);
    Future<void> saveEndpointList() => saveExternalEndpointList(ref, entries.value);

    Future<void> updateValidationStatus(String url, int index, AuxCheckStatus status) async {
      entries.value[index] = entries.value[index].copyWith(url: url, status: status);

      await saveEndpointList();
    }

    void handleReorder(int oldIndex, int newIndex) {
      final entry = entries.value.removeAt(oldIndex);
      entries.value.insert(newIndex, entry);
      entries.value = [...entries.value];

      unawaited(saveEndpointList());
    }

    void handleDismiss(int index) {
      entries.value = [...entries.value..removeAt(index)];

      unawaited(saveEndpointList());
    }

    Widget proxyDecorator(Widget child, int _, Animation<double> animation) {
      return AnimatedBuilder(
        animation: animation,
        builder: (BuildContext context, Widget? child) {
          return Material(
            color: context.colorScheme.surfaceContainerHighest,
            shadowColor: context.colorScheme.primary.withValues(alpha: 0.2),
            child: child,
          );
        },
        child: child,
      );
    }

    useEffect(() {
      final urls = ref.read(appConfigProvider).network.externalEndpointList;

      if (urls.isEmpty) {
        return null;
      }

      // gallery-fork: a saved URL may never have passed its check (#1220), so it loads unchecked.
      entries.value = urls.map((url) => AuxilaryEndpoint(url: url, status: .unknown)).toList();
      return null;
    }, const []);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16.0),
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          borderRadius: const BorderRadius.all(Radius.circular(16)),
          color: context.colorScheme.surfaceContainerLow,
          border: Border.all(color: context.colorScheme.surfaceContainerHighest, width: 1),
        ),
        child: Stack(
          children: [
            Positioned(
              bottom: -36,
              right: -36,
              child: Icon(Icons.dns_rounded, size: 120, color: context.primaryColor.withValues(alpha: 0.05)),
            ),
            ListView(
              padding: const EdgeInsets.symmetric(vertical: 16.0),
              physics: const ClampingScrollPhysics(),
              shrinkWrap: true,
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4.0, horizontal: 24),
                  child: Text(context.t.external_network_sheet_info, style: context.textTheme.bodyMedium),
                ),
                const SizedBox(height: 4),
                Divider(color: context.colorScheme.surfaceContainerHighest),
                Form(
                  key: GlobalKey<FormState>(),
                  child: ReorderableListView.builder(
                    buildDefaultDragHandles: false,
                    proxyDecorator: proxyDecorator,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: entries.value.length,
                    onReorderItem: handleReorder,
                    itemBuilder: (context, index) {
                      return GalleryEndpointInput(
                        key: Key(index.toString()),
                        index: index,
                        initialValue: entries.value[index],
                        onValidated: updateValidationStatus,
                        onDismissed: handleDismiss,
                        enabled: enabled,
                      );
                    },
                  ),
                ),
                const SizedBox(height: 24),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24.0),
                  child: SizedBox(
                    height: 48,
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.add),
                      label: Text(context.t.add_endpoint),
                      onPressed: enabled
                          ? () {
                              entries.value = [
                                ...entries.value,
                                const AuxilaryEndpoint(url: '', status: AuxCheckStatus.unknown),
                              ];
                            }
                          : null,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
