import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/string_extensions.dart';
import 'package:immich_mobile/presentation/widgets/people/people_filter_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/people/people_grid.widget.dart';
import 'package:immich_mobile/presentation/widgets/people/people_sort_button.widget.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/widgets/common/search_field.dart';

@RoutePage()
class DriftPeopleCollectionPage extends ConsumerStatefulWidget {
  const DriftPeopleCollectionPage({super.key});

  @override
  ConsumerState<DriftPeopleCollectionPage> createState() => _DriftPeopleCollectionPageState();
}

class _DriftPeopleCollectionPageState extends ConsumerState<DriftPeopleCollectionPage> {
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
    final filterBy = ref.watch(appConfigProvider.select((config) => config.people.filterBy));
    final people = ref.watch(driftGetAllPeopleWithSharedSpacesProvider((sortBy: sortBy, filterBy: filterBy)));

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: _search == null,
        title: _search != null
            ? SearchField(
                focusNode: _formFocus,
                onTapOutside: (_) => _formFocus.unfocus(),
                onChanged: (value) => setState(() => _search = value),
                filled: true,
                hintText: 'filter_people'.tr(),
                autofocus: true,
              )
            : Text('people'.tr()),
        actions: [
          const PeopleFilterButton(),
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
            if (_search != null) {
              people = people.where((person) {
                return person.name.toLowerCase().removeDiacritics().contains(_search!.toLowerCase().removeDiacritics());
              }).toList();
            }
            return PeopleGrid(
              people: people,
              editPolicy: const PerPersonSpaceRole(),
              onPersonTap: (person) => context.pushRoute(DriftPersonRoute(person: person)),
            );
          },
          error: (error, stack) => const Text("error"),
          loading: () => const Center(child: CircularProgressIndicator()),
        ),
      ),
    );
  }
}
