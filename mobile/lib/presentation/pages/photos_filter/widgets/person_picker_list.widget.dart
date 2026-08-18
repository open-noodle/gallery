import 'dart:async';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/photos_filter/filter_person.model.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/alpha_scrubber.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/photos_filter/people_picker.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';

const double _kRowHeight = 56;
const double _kHeaderHeight = 32;

class PersonPickerList extends ConsumerStatefulWidget {
  final List<FilterPerson> people;
  const PersonPickerList({super.key, required this.people});

  @override
  ConsumerState<PersonPickerList> createState() => _PersonPickerListState();
}

class _PersonPickerListState extends ConsumerState<PersonPickerList> {
  late final ScrollController _controller;

  @override
  void initState() {
    super.initState();
    _controller = ScrollController();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// Builds a flat widget list: [Header 'A', row1, row2, Header 'B', row3, ...].
  /// Also returns a letter → row-offset map for the scrubber's jumpTo.
  ({List<Widget> items, Map<String, double> letterOffsets}) _build(BuildContext context) {
    final index = peopleAlphaIndex(widget.people);
    final sortedLetters = [...AlphaScrubber.letters.where((l) => index.containsKey(l))];
    final items = <Widget>[];
    final offsets = <String, double>{};
    double cursor = 0;
    for (final letter in sortedLetters) {
      offsets[letter] = cursor;
      items.add(
        SizedBox(
          key: Key('alpha-bucket-header-$letter'),
          height: _kHeaderHeight,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 6, 20, 6),
            child: Text(
              letter,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                color: Theme.of(context).colorScheme.primary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
      );
      cursor += _kHeaderHeight;
      for (final p in index[letter]!) {
        items.add(
          SizedBox(
            height: _kRowHeight,
            child: _PersonRow(person: p),
          ),
        );
        cursor += _kRowHeight;
      }
    }
    return (items: items, letterOffsets: offsets);
  }

  void _jumpToLetter(String letter, Map<String, double> offsets) {
    final target = offsets[letter];
    if (target == null || !_controller.hasClients) {
      return;
    }
    _controller.jumpTo(target.clamp(0.0, _controller.position.maxScrollExtent));
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final showScrubber = media.size.width >= 480 && media.orientation == Orientation.portrait;

    final built = _build(context);
    final index = peopleAlphaIndex(widget.people);
    final letterToIndex = {for (final e in index.entries) e.key: 0}; // presence, value unused

    return Stack(
      children: [
        ListView.builder(
          key: const Key('person-picker-list'),
          controller: _controller,
          itemCount: built.items.length,
          itemBuilder: (_, i) => built.items[i],
        ),
        if (showScrubber)
          Positioned(
            right: 4,
            top: 8,
            bottom: 8,
            width: 24,
            child: AlphaScrubber(
              letterToIndex: letterToIndex,
              onLetter: (letter) => _jumpToLetter(letter, built.letterOffsets),
            ),
          ),
      ],
    );
  }
}

class _PersonRow extends ConsumerWidget {
  final FilterPerson person;
  const _PersonRow({required this.person});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isSelected = ref.watch(photosFilterProvider.select((f) => f.people.any((p) => p.id == person.id)));
    final theme = Theme.of(context);
    return InkWell(
      key: Key('person-row-${person.id}'),
      onTap: () {
        unawaited(HapticFeedback.selectionClick());
        final notifier = ref.read(photosFilterProvider.notifier);
        final existing = ref.read(photosFilterProvider).people.where((p) => p.id == person.id).firstOrNull;
        if (existing != null) {
          notifier.togglePerson(existing);
        } else {
          notifier.togglePerson(person);
        }
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
        child: Row(
          children: [
            CircleAvatar(
              radius: 20,
              backgroundImage: RemoteImageProvider(
                url: getFilterPersonThumbnailUrl(person.id, spaceId: person.spaceId),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    person.name,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      color: isSelected ? theme.colorScheme.primary : theme.colorScheme.onSurface,
                      fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                    ),
                  ),
                  if (person.numberOfAssets != null)
                    Text(
                      _photoCountLabel(person.numberOfAssets!),
                      key: Key('person-row-count-${person.id}'),
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
                    ),
                ],
              ),
            ),
            if (isSelected)
              Icon(Icons.check_rounded, color: theme.colorScheme.primary, key: Key('person-row-${person.id}-check')),
          ],
        ),
      ),
    );
  }
}

/// Plural helper — nested-leaf lookup avoids `.plural()`, which reads a
/// late-initialized locale field and throws in widget tests without an
/// `EasyLocalization` ancestor. Matches the pattern in `people_section.widget.dart`.
String _photoCountLabel(int count) {
  final formatted = NumberFormat.decimalPattern(Intl.getCurrentLocale()).format(count);
  final variant = count == 1 ? 'one' : 'other';
  return 'person_picker_photo_count.$variant'.tr(namedArgs: {'count': formatted});
}
