import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';

@RoutePage()
class SpaceDetailPage extends HookConsumerWidget {
  final String spaceId;

  const SpaceDetailPage({super.key, required this.spaceId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final spaceAsync = ref.watch(sharedSpaceProvider(spaceId));
    final membersAsync = ref.watch(sharedSpaceMembersProvider(spaceId));

    return Scaffold(
      appBar: AppBar(
        title: spaceAsync.when(
          data: (space) => Text(space.name),
          loading: () => const Text('Loading...'),
          error: (_, __) => const Text('Space'),
        ),
        elevation: 0,
        centerTitle: false,
      ),
      body: spaceAsync.when(
        data: (space) {
          return ListView(
            children: [
              if (space.description != null && space.description!.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Text(
                    space.description!,
                    style: context.textTheme.bodyLarge?.copyWith(
                      color: context.colorScheme.onSurface.withAlpha(180),
                    ),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                child: Row(
                  children: [
                    if (space.assetCount != null)
                      Chip(
                        avatar: const Icon(Icons.photo_library_outlined, size: 18),
                        label: Text('${space.assetCount!.toInt()} assets'),
                      ),
                    if (space.assetCount != null && space.memberCount != null)
                      const SizedBox(width: 8),
                    if (space.memberCount != null)
                      Chip(
                        avatar: const Icon(Icons.people_outline, size: 18),
                        label: Text('${space.memberCount!.toInt()} members'),
                      ),
                  ],
                ),
              ),
              const Divider(),
              Padding(
                padding: const EdgeInsets.only(left: 16.0, top: 8.0, bottom: 4.0),
                child: Text(
                  'Members',
                  style: context.textTheme.titleSmall?.copyWith(
                    color: context.colorScheme.onSurface.withAlpha(200),
                  ),
                ),
              ),
              membersAsync.when(
                data: (members) {
                  if (members.isEmpty) {
                    return const Padding(
                      padding: EdgeInsets.all(16.0),
                      child: Text('No members yet'),
                    );
                  }
                  return ListView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: members.length,
                    itemBuilder: (context, index) {
                      final member = members[index];
                      return ListTile(
                        leading: CircleAvatar(
                          child: Text(
                            member.name.isNotEmpty ? member.name[0].toUpperCase() : '?',
                          ),
                        ),
                        title: Text(member.name),
                        subtitle: Text(member.email),
                        trailing: Chip(
                          label: Text(
                            member.role.value,
                            style: context.textTheme.labelSmall,
                          ),
                          padding: EdgeInsets.zero,
                          visualDensity: VisualDensity.compact,
                        ),
                      );
                    },
                  );
                },
                loading: () => const Padding(
                  padding: EdgeInsets.all(16.0),
                  child: Center(child: CircularProgressIndicator()),
                ),
                error: (error, _) => Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Text('Failed to load members: $error'),
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
              Text('Failed to load space: $error'),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () {
                  ref.invalidate(sharedSpaceProvider(spaceId));
                  ref.invalidate(sharedSpaceMembersProvider(spaceId));
                },
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
