import 'package:flutter/material.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/extensions/object_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/utils/memory_card_text.dart';

/// [asset] adds the age at that asset to birthday titles
String getMemoryTitle(Translations t, Memory memory, {RemoteAsset? asset}) => switch (memory.type) {
  // Gallery: MemoryData is the fork's raw-map payload (#418), so `year` is nullable.
  MemoryTypeEnum.onThisDay => switch (memory.data.year) {
    final year? => t.years_ago(years: DateTime.now().year - year),
    null => t.memory,
  },
  MemoryTypeEnum.birthday => _getBirthdayTitle(t, memory.data, asset),
  // Gallery: rule memories (#418) title through the fork's per-rule builder (#1045).
  MemoryTypeEnum.rule => getRuleMemoryTitle(memory),
};

String _getBirthdayTitle(Translations t, MemoryData data, RemoteAsset? asset) {
  final name = data.personName;
  if (name == null || name.isEmpty) {
    return t.unknown;
  }

  final birthYear = data.year;
  final age = birthYear == null ? null : asset?.let((asset) => asset.createdAt.toLocal().year - birthYear);
  if (age == null || age < 1) {
    return t.birthday_memory_title(name: name);
  }

  return t.birthday_memory_title_with_age(name: name, age: age);
}

class MemoryTitle extends StatelessWidget {
  final Memory memory;
  final TextStyle? style;

  const MemoryTitle({super.key, required this.memory, this.style});

  @override
  Widget build(BuildContext context) {
    final title = getMemoryTitle(context.t, memory);
    if (memory.type != MemoryTypeEnum.birthday) {
      return Text(title, style: style);
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.cake_rounded, color: style?.color, size: 20),
        const SizedBox(height: 4),
        Text(title, style: style, maxLines: 2, overflow: TextOverflow.ellipsis),
      ],
    );
  }
}
