import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/services/background_backup_status.service.dart';

class BackgroundBackupHealthBanner extends ConsumerWidget {
  const BackgroundBackupHealthBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return FutureBuilder(
      future: ref.read(backgroundBackupStatusServiceProvider).read(),
      builder: (context, snapshot) {
        final status = snapshot.data;
        if (status == null) {
          return const SizedBox.shrink();
        }

        final health = status.deriveHealth(now: DateTime.now());
        if (health != BackgroundBackupHealth.warning &&
            health != BackgroundBackupHealth.stale &&
            health != BackgroundBackupHealth.blocked) {
          return const SizedBox.shrink();
        }

        final (title, body) = switch (health) {
          BackgroundBackupHealth.blocked => (
            'backup_background_blocked_title'.t(),
            'backup_background_blocked_body'.t(),
          ),
          BackgroundBackupHealth.stale => ('backup_background_stale_title'.t(), 'backup_background_stale_body'.t()),
          _ => ('backup_background_warning_title'.t(), 'backup_background_warning_body'.t()),
        };

        return Padding(
          padding: const EdgeInsets.only(top: 12),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: context.colorScheme.errorContainer,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.warning_rounded, color: context.colorScheme.onErrorContainer),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: context.textTheme.bodyMedium?.copyWith(
                            color: context.colorScheme.onErrorContainer,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          body,
                          style: context.textTheme.bodySmall?.copyWith(color: context.colorScheme.onErrorContainer),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
