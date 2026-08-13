import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';

import '../../widget_tester_extensions.dart';

void main() {
  test('the registry names exactly the server-backed people lists (spec 9.2-B contract guard)', () {
    expect(serverPeopleListProviders, [driftGetAllPeopleWithSharedSpacesProvider, driftSpacePeopleProvider]);
  });

  testWidgets('invalidates every server-backed list and leaves the local list alone', (tester) async {
    var withShared = 0;
    var spacePeople = 0;
    var local = 0;
    await tester.pumpConsumerWidget(
      Column(
        children: [
          Consumer(
            builder: (context, ref, _) {
              ref.watch(driftGetAllPeopleWithSharedSpacesProvider(PeopleSortBy.photoCount));
              ref.watch(driftSpacePeopleProvider((spaceId: 's1', sortBy: PeopleSortBy.photoCount)));
              ref.watch(driftGetAllPeopleProvider(PeopleSortBy.photoCount));
              return const SizedBox.shrink();
            },
          ),
          Consumer(
            builder: (context, ref, _) => TextButton(
              key: const Key('invalidate'),
              onPressed: () => ref.invalidateServerPeopleLists(),
              child: const Text('go'),
            ),
          ),
        ],
      ),
      overrides: [
        driftGetAllPeopleWithSharedSpacesProvider.overrideWith((ref, sortBy) async {
          withShared++;
          return <DriftPerson>[];
        }),
        driftSpacePeopleProvider.overrideWith((ref, key) async {
          spacePeople++;
          return <DriftPerson>[];
        }),
        driftGetAllPeopleProvider.overrideWith((ref, sortBy) async {
          local++;
          return <DriftPerson>[];
        }),
      ],
    );
    expect((withShared, spacePeople, local), equals((1, 1, 1)));

    await tester.tap(find.byKey(const Key('invalidate')));
    await tester.pumpAndSettle();

    expect((withShared, spacePeople, local), equals((2, 2, 1)));
  });
}
