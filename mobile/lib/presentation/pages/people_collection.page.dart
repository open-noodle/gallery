import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/string_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/presentation/widgets/people/people_sort_button.widget.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:immich_mobile/utils/people.utils.dart';
import 'package:immich_mobile/widgets/common/search_field.dart';

@RoutePage()
class PeopleCollectionPage extends ConsumerStatefulWidget {
  const PeopleCollectionPage({super.key});

  @override
  ConsumerState<PeopleCollectionPage> createState() => _PeopleCollectionPageState();
}

class _PeopleCollectionPageState extends ConsumerState<PeopleCollectionPage> {
  final FocusNode _formFocus = FocusNode();
  String? _search;

  @override
  void dispose() {
    _formFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sortBy = ref.watch(appConfigProvider.select((config) => config.people.sortBy));
    final people = ref.watch(driftGetAllPeopleWithSharedSpacesProvider(sortBy));

    return LayoutBuilder(
      builder: (context, constraints) {
        final isTablet = constraints.maxWidth > 600;
        final isPortrait = context.orientation == Orientation.portrait;

        return Scaffold(
          appBar: AppBar(
            automaticallyImplyLeading: _search == null,
            title: _search != null
                ? SearchField(
                    focusNode: _formFocus,
                    onTapOutside: (_) => _formFocus.unfocus(),
                    onChanged: (value) => setState(() => _search = value),
                    filled: true,
                    hintText: context.t.filter_people,
                    autofocus: true,
                  )
                : Text(context.t.people),
            actions: [
              const PeopleSortButton(),
              IconButton(
                icon: Icon(_search != null ? Icons.close : Icons.search),
                onPressed: () {
                  setState(() => _search = _search == null ? '' : null);
                },
              ),
            ],
          ),
          body: SafeArea(
            child: people.when(
              data: (people) {
                final List<Person> filtered;
                if (_search != null) {
                  filtered = people.where((person) {
                    return person.name.toLowerCase().removeDiacritics().contains(
                      _search!.toLowerCase().removeDiacritics(),
                    );
                  }).toList();
                } else {
                  filtered = people;
                }
                return GridView.builder(
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: isTablet ? 6 : 3,
                    childAspectRatio: 0.85,
                    mainAxisSpacing: isPortrait && isTablet ? 36 : 0,
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 32),
                  itemCount: filtered.length,
                  itemBuilder: (context, index) {
                    final person = filtered[index];

                    return Column(
                      key: ValueKey(person.id),
                      children: [
                        GestureDetector(
                          onTap: () {
                            unawaited(context.pushRoute(PersonRoute(person: person)));
                          },
                          child: Material(
                            shape: const CircleBorder(side: BorderSide.none),
                            elevation: 3,
                            child: CircleAvatar(
                              key: ValueKey(person.id),
                              maxRadius: isTablet ? 100 / 2 : 96 / 2,
                              backgroundImage: RemoteImageProvider(
                                url: getPersonThumbnailUrl(
                                  person.id,
                                  spaceId: person.spaceId,
                                  updatedAt: person.updatedAt,
                                ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                        _PersonName(person: person),
                      ],
                    );
                  },
                );
              },
              error: (error, stack) => const Text("error"),
              loading: () => const Center(child: CircularProgressIndicator()),
            ),
          ),
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
  const _PersonName({required this.person});

  final DriftPerson person;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final spaceId = person.spaceId;
    final editable = spaceId == null ? true : ref.watch(driftSpaceEditableProvider(spaceId)).value ?? true;

    if (person.name.isEmpty) {
      if (!editable) {
        return const SizedBox.shrink();
      }
      return GestureDetector(
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
    return GestureDetector(onTap: () => showNameEditModal(context, person), child: nameText);
  }
}
