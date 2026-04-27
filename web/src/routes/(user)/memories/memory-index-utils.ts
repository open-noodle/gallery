import { getMemoryTitle } from '$lib/utils';
import { MemoryType, type MemoryResponseDto } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';

export type MemoryIndexFilter = 'all' | 'saved';

export type MemoryIndexItem = {
  memory: MemoryResponseDto;
  title: string;
  subtitle: string;
  shownAt: Date;
  monthKey: string;
  dateLabel: string;
  typeLabel: string;
  searchText: string;
};

export type MemoryIndexGroup = {
  key: string;
  label: string;
  items: MemoryIndexItem[];
};

type BuildMemoryIndexOptions = {
  translate: MessageFormatter;
  locale?: string;
  now?: Date;
  filter?: MemoryIndexFilter;
  query?: string;
};

const getMemoryYear = (memory: MemoryResponseDto) => new Date(memory.memoryAt).getFullYear().toString();

const getMonthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const getTypeLabel = (memory: MemoryResponseDto, translate: MessageFormatter) =>
  memory.type === MemoryType.OnThisDay ? translate('memory_type_on_this_day') : '';

export const buildMemoryIndexItems = (
  memories: MemoryResponseDto[],
  { translate, locale, now = new Date(), filter = 'all', query = '' }: BuildMemoryIndexOptions,
): MemoryIndexItem[] => {
  const dateFormatter = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  const normalizedQuery = query.trim().toLowerCase();

  return memories
    .filter((memory) => memory.assets.length > 0)
    .filter((memory) => filter === 'all' || memory.isSaved)
    .map((memory): MemoryIndexItem => {
      const shownAt = new Date(memory.showAt ?? memory.createdAt);
      const title = getMemoryTitle(memory, translate, now);
      const subtitle = memory.subtitle ?? '';
      const dateLabel = dateFormatter.format(shownAt);
      const typeLabel = getTypeLabel(memory, translate);
      const memoryYear = getMemoryYear(memory);
      const searchText = [title, subtitle, memoryYear, dateLabel, typeLabel, memory.type]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return {
        memory,
        title,
        subtitle,
        shownAt,
        monthKey: getMonthKey(shownAt),
        dateLabel,
        typeLabel,
        searchText,
      };
    })
    .filter((item) => normalizedQuery === '' || item.searchText.includes(normalizedQuery))
    .sort((a, b) => b.shownAt.getTime() - a.shownAt.getTime());
};

export const buildMemoryIndexGroups = (
  memories: MemoryResponseDto[],
  options: BuildMemoryIndexOptions,
): MemoryIndexGroup[] => {
  const monthFormatter = new Intl.DateTimeFormat(options.locale, { month: 'long', year: 'numeric' });
  const groups = new Map<string, MemoryIndexGroup>();

  for (const item of buildMemoryIndexItems(memories, options)) {
    const group = groups.get(item.monthKey);

    if (group) {
      group.items.push(item);
      continue;
    }

    groups.set(item.monthKey, {
      key: item.monthKey,
      label: monthFormatter.format(item.shownAt),
      items: [item],
    });
  }

  return [...groups.values()];
};
