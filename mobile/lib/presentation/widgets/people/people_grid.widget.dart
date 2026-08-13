import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:immich_mobile/utils/people.utils.dart';

/// How a grid decides whether a person's name is editable.
///
/// This is NOT a plain `bool Function(Person)`. The global People page's answer is
/// reactive — it watches [driftSpaceEditableProvider], which resolves optimistically to true
/// and rebuilds to false once a viewer's role arrives. A predicate evaluated outside a
/// Consumer would be computed once and leave viewers holding rename affordances that fail
/// server-side. The policy is therefore resolved inside [_PersonName]'s own build.
sealed class PeopleEditPolicy {
  const PeopleEditPolicy();
}

/// Global People page: resolved per person from that person's own space role.
class PerPersonSpaceRole extends PeopleEditPolicy {
  const PerPersonSpaceRole();
}

/// Space People page: the caller already resolved the viewer's role for the whole space.
class FixedEditability extends PeopleEditPolicy {
  const FixedEditability(this.canEdit);

  final bool canEdit;
}

/// The face grid shared by the global People page and the space People page.
///
/// Hidden people never reach here: the unified [Person] no longer carries `isHidden`, and every
/// source already excludes them (both callers request `withHidden: false` server-side, and the
/// local Drift query filters `isHidden` in SQL).
class PeopleGrid extends StatelessWidget {
  const PeopleGrid({super.key, required this.people, required this.editPolicy, required this.onPersonTap});

  final List<Person> people;
  final PeopleEditPolicy editPolicy;
  final void Function(Person person) onPersonTap;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isTablet = constraints.maxWidth > 600;
        final isPortrait = context.orientation == Orientation.portrait;

        return GridView.builder(
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: isTablet ? 6 : 3,
            childAspectRatio: 0.85,
            mainAxisSpacing: isPortrait && isTablet ? 36 : 0,
          ),
          padding: const EdgeInsets.symmetric(vertical: 32),
          itemCount: people.length,
          itemBuilder: (context, index) {
            final person = people[index];

            return Column(
              key: ValueKey(person.id),
              children: [
                GestureDetector(
                  onTap: () => onPersonTap(person),
                  child: Material(
                    shape: const CircleBorder(side: BorderSide.none),
                    elevation: 3,
                    child: CircleAvatar(
                      // MUST stay ValueKey(person.id), not a descriptive key:
                      // drift_people_collection_test.dart's `avatarUrl` helper resolves the
                      // avatar via `w is CircleAvatar && w.key == ValueKey(personId)` to assert
                      // the space-thumbnail URL. Renaming it fails that test.
                      key: ValueKey(person.id),
                      maxRadius: isTablet ? 100 / 2 : 96 / 2,
                      backgroundImage: RemoteImageProvider(
                        url: getPersonThumbnailUrl(person.id, spaceId: person.spaceId, updatedAt: person.updatedAt),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                _PersonName(person: person, editPolicy: editPolicy),
              ],
            );
          },
        );
      },
    );
  }
}

// Renders a person's name and gates the rename affordance exactly like the web People page:
// a personal/owned person (null spaceId) is always editable by the viewer; a Space-scoped
// person is editable only when the viewer is an editor of that space (resolved optimistically,
// defaulting to editable until known). A read-only Space person shows a plain, non-tappable
// name and no "add a name" prompt for empty names.
class _PersonName extends ConsumerWidget {
  const _PersonName({required this.person, required this.editPolicy});

  final Person person;
  final PeopleEditPolicy editPolicy;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final editable = switch (editPolicy) {
      FixedEditability(:final canEdit) => canEdit,
      PerPersonSpaceRole() => switch (person.spaceId) {
        null => true,
        final spaceId => ref.watch(driftSpaceEditableProvider(spaceId)).value ?? true,
      },
    };

    if (person.name.isEmpty) {
      if (!editable) {
        return const SizedBox.shrink();
      }
      return GestureDetector(
        key: Key('person-name-editable-${person.id}'),
        onTap: () => showNameEditModal(context, person),
        child: Text(
          context.t.add_a_name,
          style: context.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w500,
            color: context.colorScheme.primary,
          ),
        ),
      );
    }

    final nameText = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16.0),
      child: Text(
        person.name,
        overflow: TextOverflow.ellipsis,
        style: context.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w500),
      ),
    );

    if (!editable) {
      return nameText;
    }
    return GestureDetector(
      key: Key('person-name-editable-${person.id}'),
      onTap: () => showNameEditModal(context, person),
      child: nameText,
    );
  }
}
