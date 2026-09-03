import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/people/family_focus_card.widget.dart';
import 'package:immich_mobile/presentation/widgets/people/person_option_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/person_timeline.provider.dart';
import 'package:immich_mobile/utils/people.utils.dart';
import 'package:immich_mobile/widgets/common/person_sliver_app_bar.dart';

@RoutePage()
class DriftPersonPage extends ConsumerStatefulWidget {
  final DriftPerson person;

  const DriftPersonPage({super.key, required this.person});

  static const timelineOverviewControlsEnabled = true;

  @override
  ConsumerState<DriftPersonPage> createState() => _DriftPersonPageState();
}

class _DriftPersonPageState extends ConsumerState<DriftPersonPage> {
  late DriftPerson _person;

  @override
  initState() {
    super.initState();
    _person = widget.person;
  }

  Future<void> handleEditName(BuildContext context) async {
    final newName = await showNameEditModal(context, _person);

    if (newName != null && newName.isNotEmpty) {
      setState(() {
        _person = _person.copyWith(name: newName);
      });
    }
  }

  Future<void> handleEditBirthday(BuildContext context) async {
    final birthday = await showBirthdayEditModal(context, _person);

    if (birthday != null) {
      setState(() {
        _person = _person.copyWith(birthDate: birthday);
      });
    }
  }

  void showOptionSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: context.colorScheme.surface,
      isScrollControlled: false,
      builder: (context) {
        return PersonOptionSheet(
          onEditName: () async {
            await handleEditName(context);
            ContextHelper(context).pop();
          },
          onEditBirthday: () async {
            await handleEditBirthday(context);
            ContextHelper(context).pop();
          },
          birthdayExists: _person.birthDate != null,
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    // Mirror the web People page: a personal/owned person (null spaceId) is always editable by
    // the viewer; a Space-scoped person is editable only when the viewer is an editor of that
    // space (optimistic until resolved). A read-only Space person gets no edit affordances.
    final spaceId = _person.spaceId;
    final editable = spaceId == null ? true : ref.watch(driftSpaceEditableProvider(spaceId)).value ?? true;

    return TimelineRouteScope(
      // A personal person reads the owner-scoped local timeline; a Space-shared person reads
      // the server-resolved Space assets (the local owner-scoped join is empty for a person the
      // viewer does not own). See buildPersonTimelineRouteService.
      timelineServiceBuilder: (ref, scope, groupBy) => buildPersonTimelineRouteService(ref, _person, scope, groupBy),
      // Slice 13: the family focus card sits above the timeline rather than inside
      // `PersonSliverAppBar`'s sliver (a fixed-height, heavily animated background header) —
      // `Timeline` only accepts one `appBar` sliver, and reworking that shared widget to carry
      // a second, variable-height section was judged out of proportion to a read-only card.
      // It renders nothing of its own when there is nothing to show (offline explanation aside),
      // so it never adds empty space to a person with no recorded relations or no family access.
      child: Column(
        children: [
          FamilyFocusCard(personId: _person.id),
          Expanded(
            child: Timeline(
              withGroupingPill: true,
              appBar: PersonSliverAppBar(
                person: _person,
                editable: editable,
                onNameTap: () => handleEditName(context),
                onBirthdayTap: () => handleEditBirthday(context),
                onShowOptions: () => showOptionSheet(context),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
