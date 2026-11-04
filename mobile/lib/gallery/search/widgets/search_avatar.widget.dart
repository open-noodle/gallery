import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_ui.providers.dart';
import 'package:immich_mobile/gallery/utils/person_thumbnail_url.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';

/// A person's face, routed by its thumbnail profile: a Space person goes to the membership-gated space endpoint, never
/// to the owner-only person endpoint (CLAUDE.md, "Edits are gated and routed exactly like web").
class SearchPersonAvatar extends StatelessWidget {
  final String filterId;
  final String name;
  final String? profileId;
  final String? profileType;
  final String? profileSpaceId;
  final double radius;

  SearchPersonAvatar({super.key, required SearchPersonOption person, this.radius = 27})
    : filterId = person.filterId,
      name = person.name,
      profileId = person.profileId,
      profileType = person.profileType,
      profileSpaceId = person.profileSpaceId;

  SearchPersonAvatar.selected({super.key, required SearchPersonRef person, this.radius = 27})
    : filterId = person.filterId,
      name = person.name,
      profileId = person.profileId,
      profileType = person.profileType,
      profileSpaceId = person.profileSpaceId;

  String get _url {
    final id = searchPersonProfileId(filterId, profileId);
    final spaceId = profileType == 'space-person' ? profileSpaceId : null;
    return getPersonThumbnailUrl(id, spaceId: spaceId);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final initial = name.trim().isEmpty ? '?' : name.trim().characters.first.toUpperCase();
    return CircleAvatar(
      radius: radius,
      backgroundColor: scheme.surfaceContainerHighest,
      foregroundImage: RemoteImageProvider(url: _url),
      onForegroundImageError: (_, _) {},
      child: Text(
        initial,
        style: TextStyle(fontSize: radius * 0.7, color: scheme.onSurfaceVariant),
      ),
    );
  }
}
