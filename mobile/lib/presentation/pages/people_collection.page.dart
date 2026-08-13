import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/string_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/people/people_grid.widget.dart';
import 'package:immich_mobile/presentation/widgets/people/people_sort_button.widget.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/routing/router.dart';
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
            final filtered = _search == null
                ? people
                : people.where((person) {
                    return person.name.toLowerCase().removeDiacritics().contains(
                      _search!.toLowerCase().removeDiacritics(),
                    );
                  }).toList();
            return PeopleGrid(
              people: filtered,
              editPolicy: const PerPersonSpaceRole(),
              onPersonTap: (person) => unawaited(context.pushRoute(PersonRoute(person: person))),
            );
          },
          error: (error, stack) => const Text("error"),
          loading: () => const Center(child: CircularProgressIndicator()),
        ),
      ),
    );
  }
}
