import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/people/person_option_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/person_timeline.provider.dart';
import 'package:immich_mobile/utils/people.utils.dart';
import 'package:immich_mobile/widgets/common/person_sliver_app_bar.dart';

@RoutePage()
class PersonPage extends ConsumerStatefulWidget {
  final Person person;

  const PersonPage({super.key, required this.person});

  static const timelineOverviewControlsEnabled = true;

  @override
  ConsumerState<PersonPage> createState() => _PersonPageState();
}

class _PersonPageState extends ConsumerState<PersonPage> {
  late Person _person;

  @override
  void initState() {
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

  Future<void> showOptionSheet(BuildContext context) {
    return showModalBottomSheet(
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
    );
  }
}
