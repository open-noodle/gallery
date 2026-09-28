// Gallery-fork: family relationships, mobile slice 13 (person page focus card). Read-only.
//
// Mockup: `specs/mockups/2026-08-31-family-relationships.html` §9. Layout: parents above,
// partner(s) beside, children below — three rows, each only rendered when it has entries. A
// union the viewer cannot see contributes nothing (its relations simply aren't in the list);
// one with unresolvable participants contributes an anonymous "Someone" seat rather than being
// dropped (dropping would understate the family's size, which is worse than showing "Someone").
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/family_focus.model.dart';
import 'package:immich_mobile/providers/infrastructure/family.provider.dart';
import 'package:immich_mobile/repositories/family_api.repository.dart';

/// Shows [personId]'s parents/partner(s)/children, or nothing at all.
///
/// Three outcomes, deliberately distinct (E54/A12):
/// - the viewer's effective family access is `none` ([FamilyFocusUnavailable]) — render nothing,
///   exactly as if this widget were never placed on the page. No locked state, no empty state.
/// - the fetch failed for any other reason (offline, a 5xx, ...) — show an explanation that
///   relations are server-sourced and not stored on the device, never a blank "no family" card.
/// - the fetch succeeded and there is nothing recorded yet — also render nothing. This is a
///   legitimate state distinct from the two above; this slice does not own an empty-state
///   design for it ("Start with yourself" in the mockup is out of scope here).
class FamilyFocusCard extends ConsumerWidget {
  const FamilyFocusCard({super.key, required this.personId});

  final String personId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final focusAsync = ref.watch(familyFocusProvider(personId));

    return focusAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (error, stackTrace) => const _FamilyFocusOfflineNotice(),
      data: (result) => switch (result) {
        FamilyFocusUnavailable() => const SizedBox.shrink(),
        FamilyFocusAvailable(:final focus) when focus.isEmpty => const SizedBox.shrink(),
        FamilyFocusAvailable(:final focus) => _FamilyFocusGrid(focus: focus),
      },
    );
  }
}

class _FamilyFocusOfflineNotice extends StatelessWidget {
  const _FamilyFocusOfflineNotice();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      key: const Key('family-focus-offline'),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('family_mobile_offline_title'.tr(), style: theme.textTheme.titleSmall),
          const SizedBox(height: 4),
          Text('family_mobile_offline_message'.tr(), style: theme.textTheme.bodySmall),
        ],
      ),
    );
  }
}

class _FamilyFocusGrid extends StatelessWidget {
  const _FamilyFocusGrid({required this.focus});

  final FamilyFocus focus;

  @override
  Widget build(BuildContext context) {
    return Padding(
      key: const Key('family-focus-card'),
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (focus.parents.isNotEmpty) ...[
            _FamilyFocusRow(key: const Key('family-focus-parents-row'), entries: focus.parents),
            const SizedBox(height: 12),
          ],
          if (focus.partners.isNotEmpty) ...[
            _FamilyFocusRow(key: const Key('family-focus-partners-row'), entries: focus.partners),
            const SizedBox(height: 12),
          ],
          if (focus.children.isNotEmpty)
            _FamilyFocusRow(key: const Key('family-focus-children-row'), entries: focus.children),
        ],
      ),
    );
  }
}

class _FamilyFocusRow extends StatelessWidget {
  const _FamilyFocusRow({super.key, required this.entries});

  final List<FamilyRelationEntry> entries;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      alignment: WrapAlignment.center,
      spacing: 16,
      runSpacing: 8,
      children: [for (final entry in entries) _FamilyFocusEntryCard(entry: entry)],
    );
  }
}

class _FamilyFocusEntryCard extends StatelessWidget {
  const _FamilyFocusEntryCard({required this.entry});

  final FamilyRelationEntry entry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isAnonymous = entry.isAnonymous;
    // A5: an anonymous seat renders as a muted italic "Someone" with no id anywhere — not the
    // participant's `anonymousSlot` (an opaque per-union index, never meant to be displayed),
    // and not any other identifying value.
    final displayName = isAnonymous ? 'family_mobile_someone'.tr() : (entry.name ?? '');

    return Column(
      key: ValueKey(isAnonymous ? 'family-relation-anon-${entry.anonymousSlot}' : 'family-relation-${entry.personId}'),
      mainAxisSize: MainAxisSize.min,
      children: [
        CircleAvatar(
          radius: 26,
          backgroundColor: isAnonymous ? theme.colorScheme.surfaceContainerHighest : theme.colorScheme.primaryContainer,
          child: Text(
            isAnonymous ? '?' : _initial(entry.name),
            style: TextStyle(
              color: isAnonymous ? theme.colorScheme.onSurfaceVariant : theme.colorScheme.onPrimaryContainer,
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          displayName,
          style: isAnonymous
              ? theme.textTheme.bodyMedium?.copyWith(
                  fontStyle: FontStyle.italic,
                  color: theme.colorScheme.onSurfaceVariant,
                )
              : theme.textTheme.bodyMedium,
        ),
        Text(entry.relation, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
      ],
    );
  }

  static String _initial(String? name) => (name != null && name.isNotEmpty) ? name[0].toUpperCase() : '?';
}
