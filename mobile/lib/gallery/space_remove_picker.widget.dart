import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/space_remove.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/widgets/spaces/space_collage.dart';

/// Asks which space to remove the selection from: each space with its colour and how many selected photos it holds.
Future<RemovableSpace?> showSpaceRemovePicker(BuildContext context, List<RemovableSpace> spaces) =>
    showModalBottomSheet<RemovableSpace>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
                child: Text(context.t.remove_from_space, style: Theme.of(context).textTheme.titleMedium),
              ),
              for (final space in spaces)
                ListTile(
                  key: Key('space-remove-${space.id}'),
                  // The dark end of the space card's gradient: the badge's light end is meant for photos.
                  leading: Icon(Icons.workspaces, color: spaceGradientColors(space.color).last),
                  title: Text(space.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                  trailing: Text(context.t.items_count(count: space.assetIds.length)),
                  onTap: () => Navigator.of(context).pop(space),
                ),
            ],
          ),
        ),
      ),
    );
