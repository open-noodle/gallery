import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/asyncvalue_extensions.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';

// Gallery's Spaces and Albums cards on the Library tab, mounted by library.page.dart's _CollectionCards.

class SpacesCollectionCard extends ConsumerWidget {
  const SpacesCollectionCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final spacesAsync = ref.watch(sharedSpacesProvider);

    return LayoutBuilder(
      builder: (context, constraints) {
        final isTablet = constraints.maxWidth > 600;
        final widthFactor = isTablet ? 0.25 : 0.5;
        final size = context.width * widthFactor - 20.0;

        return GestureDetector(
          onTap: () => context.pushRoute(const SpacesRoute()),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                height: size,
                width: size,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: const BorderRadius.all(Radius.circular(20)),
                    gradient: LinearGradient(
                      colors: [context.colorScheme.primary.withAlpha(30), context.colorScheme.primary.withAlpha(25)],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    ),
                  ),
                  child: spacesAsync.widgetWhen(
                    onLoading: () => const Center(child: CircularProgressIndicator()),
                    onData: (spaces) {
                      if (spaces.isEmpty) {
                        return Center(
                          child: Icon(Icons.workspaces_outlined, size: 48, color: context.colorScheme.primary),
                        );
                      }
                      return GridView.count(
                        crossAxisCount: 2,
                        padding: const EdgeInsets.all(12),
                        crossAxisSpacing: 8,
                        mainAxisSpacing: 8,
                        physics: const NeverScrollableScrollPhysics(),
                        children: spaces.take(4).map((space) {
                          final thumbnailId = space.thumbnailAssetId.value;
                          if (thumbnailId == null) {
                            return DecoratedBox(
                              decoration: BoxDecoration(
                                color: context.colorScheme.surfaceContainerHigh,
                                borderRadius: const BorderRadius.all(Radius.circular(10)),
                              ),
                              child: Icon(Icons.workspaces_outlined, color: context.colorScheme.primary),
                            );
                          }
                          return ClipRRect(
                            borderRadius: const BorderRadius.all(Radius.circular(10)),
                            child: Image(
                              image: RemoteImageProvider(url: getThumbnailUrlForRemoteId(thumbnailId)),
                              fit: BoxFit.cover,
                            ),
                          );
                        }).toList(),
                      );
                    },
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(8.0),
                child: Text(
                  context.t.spaces,
                  style: context.textTheme.titleSmall?.copyWith(
                    color: context.colorScheme.onSurface,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Albums entry point on the Library tab.
///
/// With Spaces occupying the middle nav slot by default
/// (`SettingsKey.navShowSpaces`), the Library tab is where the albums list is
/// reached from: this card and the `albums` tile in library.page.dart's
/// `_QuickAccessButtonList` are its only two entry points.
class AlbumsCollectionCard extends ConsumerWidget {
  const AlbumsCollectionCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final albumState = ref.watch(remoteAlbumProvider);
    final albums = albumState.albums;

    return LayoutBuilder(
      builder: (context, constraints) {
        final isTablet = constraints.maxWidth > 600;
        final widthFactor = isTablet ? 0.25 : 0.5;
        final size = context.width * widthFactor - 20.0;

        return GestureDetector(
          key: const Key('library-albums-card'),
          onTap: () => context.pushRoute(const AlbumsRoute()),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                height: size,
                width: size,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: const BorderRadius.all(Radius.circular(20)),
                    gradient: LinearGradient(
                      colors: [context.colorScheme.primary.withAlpha(30), context.colorScheme.primary.withAlpha(25)],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    ),
                  ),
                  child: GridView.count(
                    crossAxisCount: 2,
                    padding: const EdgeInsets.all(12),
                    crossAxisSpacing: 8,
                    mainAxisSpacing: 8,
                    physics: const NeverScrollableScrollPhysics(),
                    children: albums.take(4).map((album) {
                      final thumbnailId = album.thumbnailAssetId;
                      if (thumbnailId == null) {
                        return DecoratedBox(
                          decoration: BoxDecoration(
                            color: context.colorScheme.surfaceContainerHigh,
                            borderRadius: const BorderRadius.all(Radius.circular(10)),
                          ),
                          child: Icon(Icons.photo_album_outlined, color: context.colorScheme.primary),
                        );
                      }
                      return ClipRRect(
                        borderRadius: const BorderRadius.all(Radius.circular(10)),
                        child: Image(
                          image: RemoteImageProvider(url: getThumbnailUrlForRemoteId(thumbnailId)),
                          fit: BoxFit.cover,
                        ),
                      );
                    }).toList(),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(8.0),
                child: Text(
                  context.t.albums,
                  style: context.textTheme.titleSmall?.copyWith(
                    color: context.colorScheme.onSurface,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
