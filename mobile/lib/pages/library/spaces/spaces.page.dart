import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/pages/library/spaces/collection_sort.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_edit_sheet.widget.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/space_permissions.dart';
import 'package:immich_mobile/widgets/common/collection_sort_button.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:immich_mobile/widgets/common/search_field.dart';
import 'package:immich_mobile/widgets/spaces/space_card.dart';
import 'package:openapi/api.dart';

@RoutePage()
class SpacesPage extends HookConsumerWidget {
  const SpacesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final spacesAsync = ref.watch(sharedSpacesProvider);
    final sortConfig = ref.watch(appConfigProvider.select((config) => config.spaces));

    final queryController = useTextEditingController();
    final query = useState('');
    useEffect(() {
      void listener() => query.value = queryController.text;
      queryController.addListener(listener);
      return () => queryController.removeListener(listener);
    }, [queryController]);

    Future<void> createSpaceDialog() async {
      final nameController = TextEditingController();
      final descController = TextEditingController();

      final result = await showDialog<bool>(
        context: context,
        builder: (context) {
          return AlertDialog(
            title: const Text('Create Space'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: nameController,
                  decoration: const InputDecoration(labelText: 'Name', hintText: 'Enter space name'),
                  autofocus: true,
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: descController,
                  decoration: const InputDecoration(labelText: 'Description (optional)', hintText: 'Enter description'),
                ),
              ],
            ),
            actions: [
              TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
              TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Create')),
            ],
          );
        },
      );

      if (result == true && nameController.text.isNotEmpty) {
        try {
          final description = descController.text.isEmpty ? null : descController.text;
          await ref.read(sharedSpaceApiRepositoryProvider).create(nameController.text, description: description);
          ref.invalidate(sharedSpacesProvider);
        } catch (e) {
          if (context.mounted) {
            ImmichToast.show(context: context, msg: 'Failed to create space: $e', toastType: ToastType.error);
          }
        }
      }

      nameController.dispose();
      descController.dispose();
    }

    Future<void> confirmAndDeleteSpace(SharedSpaceResponseDto space) async {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(ctx.t.spaces_delete),
          content: Text(ctx.t.spaces_delete_confirmation(name: space.name)),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(ctx.t.cancel)),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              style: TextButton.styleFrom(foregroundColor: Theme.of(ctx).colorScheme.error),
              child: Text(ctx.t.delete),
            ),
          ],
        ),
      );
      if (confirmed != true) return;

      try {
        await ref.read(sharedSpaceApiRepositoryProvider).delete(space.id);
        ref.invalidate(sharedSpacesProvider);
      } catch (e) {
        if (context.mounted) {
          ImmichToast.show(context: context, msg: 'Failed to delete space', toastType: ToastType.error);
        }
      }
    }

    Future<void> showSpaceActions(SharedSpaceResponseDto space) async {
      final userId = ref.read(currentUserProvider)?.id;
      // A viewer has no actions at all, so opening an empty sheet would be worse
      // than not reacting.
      if (!spaceIsWritable(space, userId)) return;

      await showModalBottomSheet<void>(
        context: context,
        builder: (sheetContext) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                key: const Key('space-card-action-edit'),
                leading: const Icon(Icons.edit_outlined),
                title: Text(sheetContext.t.spaces_edit),
                onTap: () async {
                  Navigator.of(sheetContext).pop();
                  final saved = await SpaceEditSheet.show(context, space);
                  if (saved == true) ref.invalidate(sharedSpacesProvider);
                },
              ),
              if (spaceIsOwned(space, userId))
                ListTile(
                  key: const Key('space-card-action-delete'),
                  leading: const Icon(Icons.delete_outline),
                  title: Text(sheetContext.t.spaces_delete),
                  onTap: () async {
                    Navigator.of(sheetContext).pop();
                    await confirmAndDeleteSpace(space);
                  },
                ),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Spaces')),
      body: spacesAsync.when(
        data: (spaces) {
          if (spaces.isEmpty) {
            return Center(
              key: const Key('spaces-empty'),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.workspaces_outlined, size: 64, color: context.colorScheme.onSurface.withAlpha(100)),
                  const SizedBox(height: 16),
                  Text(
                    'No spaces yet',
                    style: context.textTheme.titleMedium?.copyWith(color: context.colorScheme.onSurface.withAlpha(150)),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Create a space to share photos with others',
                    style: context.textTheme.bodyMedium?.copyWith(color: context.colorScheme.onSurface.withAlpha(100)),
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton.icon(
                    onPressed: createSpaceDialog,
                    icon: const Icon(Icons.add),
                    label: const Text('Create Space'),
                  ),
                ],
              ),
            );
          }

          final trimmedQuery = query.value.trim();
          final filtered = filterAndSortSpaces(spaces, query.value, sortConfig.sortMode, sortConfig.isReverse);

          return Column(
            children: [
              _SearchAndSortBar(
                controller: queryController,
                hasQuery: query.value.isNotEmpty,
                onClear: queryController.clear,
                resultCount: filtered.length,
                totalCount: spaces.length,
                query: trimmedQuery,
                sortMode: sortConfig.sortMode,
                isReverse: sortConfig.isReverse,
                onSortChanged: (mode, isReverse) async {
                  final settings = ref.read(settingsProvider);
                  await settings.write(SettingsKey.spacesSortMode, mode);
                  await settings.write(SettingsKey.spacesIsReverse, isReverse);
                },
              ),
              Expanded(
                child: filtered.isEmpty
                    ? _NoMatch(key: const Key('spaces-no-match'), query: query.value)
                    : RefreshIndicator(
                        onRefresh: () async => ref.invalidate(sharedSpacesProvider),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: GridView.builder(
                            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 2,
                              crossAxisSpacing: 12,
                              mainAxisSpacing: 16,
                              childAspectRatio: 0.72,
                            ),
                            itemCount: filtered.length,
                            itemBuilder: (context, index) {
                              final space = filtered[index];
                              return SpaceCard(
                                key: Key('space-card-${space.id}'),
                                space: space,
                                onTap: () async {
                                  await context.pushRoute(SpaceDetailRoute(spaceId: space.id));
                                  ref.invalidate(sharedSpacesProvider);
                                },
                                onLongPress: () => showSpaceActions(space),
                              );
                            },
                          ),
                        ),
                      ),
              ),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline, size: 48),
              const SizedBox(height: 16),
              Text('Failed to load spaces: $error'),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: () => ref.invalidate(sharedSpacesProvider), child: const Text('Retry')),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(onPressed: createSpaceDialog, child: const Icon(Icons.add)),
    );
  }
}

// ---------------------------------------------------------------------------
// Search + sort bar
// ---------------------------------------------------------------------------

class _SearchAndSortBar extends StatelessWidget {
  const _SearchAndSortBar({
    required this.controller,
    required this.hasQuery,
    required this.onClear,
    required this.resultCount,
    required this.totalCount,
    required this.query,
    required this.sortMode,
    required this.isReverse,
    required this.onSortChanged,
  });

  final TextEditingController controller;
  final bool hasQuery;
  final VoidCallback onClear;
  final int resultCount;
  final int totalCount;
  final String query;
  final SpaceSortMode sortMode;
  final bool isReverse;
  final void Function(SpaceSortMode mode, bool isReverse) onSortChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SearchField(
            key: const Key('spaces-search-field'),
            hintText: context.t.spaces_search_hint,
            controller: controller,
            prefixIcon: const Icon(Icons.search_rounded),
            suffixIcon: hasQuery
                ? IconButton(
                    key: const Key('spaces-search-clear'),
                    icon: const Icon(Icons.clear_rounded),
                    onPressed: onClear,
                  )
                : null,
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                query.isEmpty
                    ? context.t.spaces_result_count(count: resultCount)
                    : context.t.spaces_page_search_result_count(count: resultCount, total: totalCount, query: query),
                key: const Key('spaces-result-count'),
                style: context.textTheme.bodySmall?.copyWith(color: context.colorScheme.onSurfaceVariant),
              ),
              CollectionSortButton<SpaceSortMode>(
                options: SpaceSortMode.values.map((mode) => (mode: mode, label: mode.label)).toList(),
                current: sortMode,
                isReverse: isReverse,
                onChanged: onSortChanged,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// No-match state (source list non-empty, but the query matches nothing)
// ---------------------------------------------------------------------------

class _NoMatch extends StatelessWidget {
  const _NoMatch({super.key, required this.query});

  final String query;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.search_off_rounded, size: 64, color: context.colorScheme.onSurfaceVariant.withValues(alpha: 0.5)),
          const SizedBox(height: 16),
          Text(
            context.t.spaces_no_match(query: query),
            textAlign: TextAlign.center,
            style: context.textTheme.titleMedium?.copyWith(color: context.colorScheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}
