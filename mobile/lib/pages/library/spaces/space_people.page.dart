import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
// NOTE: person.model.dart is deliberately NOT imported — every type it would provide here
// (DriftPerson, PeopleSortBy) is inferred, and an unused import fails `dart analyze
// --fatal-infos`, which is a gate this plan mandates.
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/string_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/people/people_grid.widget.dart';
import 'package:immich_mobile/presentation/widgets/people/people_sort_button.widget.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/debug_print.dart';
import 'package:immich_mobile/widgets/common/search_field.dart';

/// A shared space's own people — the mobile equivalent of the web `/spaces/[id]/people` tab.
///
/// The app bar mirrors the global People page (search toggle + shared sort button) because the
/// two are the same surface at different scopes; the empty and no-match states follow
/// [SpaceAlbumsPage]. Editing is gated on [canEdit], which the space detail page already
/// resolved from the member list — this page never re-resolves membership.
@RoutePage()
class SpacePeoplePage extends ConsumerStatefulWidget {
  const SpacePeoplePage({super.key, required this.spaceId, required this.canEdit});

  final String spaceId;
  final bool canEdit;

  @override
  ConsumerState<SpacePeoplePage> createState() => _SpacePeoplePageState();
}

class _SpacePeoplePageState extends ConsumerState<SpacePeoplePage> {
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
    final people = ref.watch(driftSpacePeopleProvider((spaceId: widget.spaceId, sortBy: sortBy)));

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
        centerTitle: false,
        actions: [
          const PeopleSortButton(),
          IconButton(
            key: const Key('space-people-search-toggle'),
            icon: Icon(_search != null ? Icons.close : Icons.search),
            onPressed: () => setState(() => _search = _search == null ? '' : null),
          ),
        ],
      ),
      body: SafeArea(
        child: people.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          // No local fallback exists for space people, so a failure is a real dead end —
          // show it rather than silently rendering the owner-scoped list.
          error: (error, _) {
            dPrint(() => 'Error loading space people: $error');
            return _ErrorState(
              // Deliberately NOT ref.invalidateServerPeopleLists() (see people.provider.dart):
              // that would also refetch driftGetAllPeopleWithSharedSpacesProvider, which this
              // page never watches. This retry stays scoped to the one family member that
              // actually errored — this space's people, keyed by (spaceId, sortBy).
              onRetry: () => ref.invalidate(driftSpacePeopleProvider((spaceId: widget.spaceId, sortBy: sortBy))),
            );
          },
          data: (people) {
            if (people.isEmpty) {
              return const _EmptyState(key: Key('space-people-empty'));
            }

            final query = _search?.trim() ?? '';
            final filtered = query.isEmpty
                ? people
                : people
                      .where(
                        (person) => person.name.toLowerCase().removeDiacritics().contains(
                          query.toLowerCase().removeDiacritics(),
                        ),
                      )
                      .toList();

            if (filtered.isEmpty) {
              return _NoMatch(key: const Key('space-people-no-match'), query: query);
            }

            return PeopleGrid(
              people: filtered,
              editPolicy: FixedEditability(widget.canEdit),
              onPersonTap: (person) => context.pushRoute(DriftPersonRoute(person: person)),
            );
          },
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.face_outlined, size: 48, color: context.colorScheme.onSurface.withAlpha(120)),
            const SizedBox(height: 16),
            Text(context.t.spaces_no_people, style: context.textTheme.titleMedium, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(
              context.t.spaces_no_people_description,
              style: context.textTheme.bodyMedium,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _NoMatch extends StatelessWidget {
  const _NoMatch({super.key, required this.query});

  final String query;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Text(
          context.t.search_no_people_named(name: query),
          style: context.textTheme.titleMedium,
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, size: 48),
          const SizedBox(height: 16),
          Text(context.t.spaces_error_loading_people, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          ElevatedButton(key: const Key('space-people-retry'), onPressed: onRetry, child: Text(context.t.retry)),
        ],
      ),
    );
  }
}
