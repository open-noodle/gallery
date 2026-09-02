import { MemoryType, type MemoryResponseDto } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';

/**
 * Titles and subtitles for generated memory cards.
 *
 * Memory rules deliberately persist no prose: a memory is generated once by the server and then
 * read for days by clients in whatever language each viewer picked, so any English baked in at
 * generation time is stuck (#1045). Each rule instead stores structured facts in `data.context`,
 * and the card text is assembled here, in the viewer's language, every render.
 *
 * Memories generated before that change still carry `title`/`subtitle`, so those win when present
 * — an old card keeps reading as it did rather than falling back to "Unknown".
 */

type RuleContext = Record<string, unknown>;

/** The typed union of `en.json` keys `translate` accepts, so a key typo is a compile error. */
type MessageKey = Parameters<MessageFormatter>[0];

/** Explicit maps, not `` `memory_season_${key}` `` — a constructed key is invisible to a grep for unused strings. */
const SEASON_KEYS: Record<string, MessageKey> = {
  spring: 'memory_season_spring',
  summer: 'memory_season_summer',
  autumn: 'memory_season_autumn',
  winter: 'memory_season_winter',
};

const THEME_KEYS: Record<string, MessageKey> = {
  sunset: 'memory_theme_sunset',
  beach: 'memory_theme_beach',
  food: 'memory_theme_food',
  mountains: 'memory_theme_mountains',
  snow: 'memory_theme_snow',
  city_night: 'memory_theme_city_night',
};

const asString = (context: RuleContext, key: string): string | undefined =>
  typeof context[key] === 'string' ? context[key] : undefined;

const asNumber = (context: RuleContext, key: string): number | undefined =>
  typeof context[key] === 'number' ? context[key] : undefined;

const asYears = (context: RuleContext): number[] | undefined =>
  Array.isArray(context.years) && context.years.every((year) => typeof year === 'number')
    ? (context.years as number[])
    : undefined;

/**
 * "September 2025" / "septembre 2025". Built with `Intl` rather than an i18n message, so month
 * names come from the locale data instead of needing twelve translated strings.
 */
const formatMonthYear = (locale: string | undefined, year: number, month: number) =>
  new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );

type Builder = (context: RuleContext, translate: MessageFormatter, locale?: string) => string | undefined;

const monthYearOf = (context: RuleContext, locale: string | undefined) => {
  const year = asNumber(context, 'year');
  const month = asNumber(context, 'month');
  return year === undefined || month === undefined ? undefined : formatMonthYear(locale, year, month);
};

const TITLE_BUILDERS: Record<string, Builder> = {
  birthday: (context, translate) => {
    const name = asString(context, 'personName');
    return name === undefined ? undefined : translate('memory_birthday_title', { values: { name } });
  },

  recent_trip: (context, translate) => {
    const location = asString(context, 'placeLabel');
    return location === undefined ? undefined : translate('memory_recent_trip_title', { values: { location } });
  },

  trip_anniversary: (context, translate) => {
    const location = asString(context, 'placeLabel');
    return location === undefined ? undefined : translate('memory_trip_anniversary_title', { values: { location } });
  },

  // The whole title is the month and year, so there is no message to wrap it in.
  month_recap: (context, _translate, locale) => monthYearOf(context, locale),

  favorites_throwback: (context, translate, locale) => {
    const monthYear = monthYearOf(context, locale);
    return monthYear === undefined
      ? undefined
      : translate('memory_favorites_throwback_title', { values: { monthYear } });
  },

  video_moments: (context, translate, locale) => {
    const monthYear = monthYearOf(context, locale);
    return monthYear === undefined ? undefined : translate('memory_video_moments_title', { values: { monthYear } });
  },

  season_recap: (context, translate) => {
    const seasonKey = SEASON_KEYS[asString(context, 'season') ?? ''];
    const seasonYear = asNumber(context, 'seasonYear');
    return seasonKey === undefined || seasonYear === undefined
      ? undefined
      : // Years go through as strings: as a number, ICU would group the year into "2,025".
        translate('memory_season_recap_title', {
          values: { season: translate(seasonKey), year: String(seasonYear) },
        });
  },

  themed: (context, translate) => {
    const themeKey = THEME_KEYS[asString(context, 'theme') ?? ''];
    const year = asNumber(context, 'year');
    return themeKey === undefined || year === undefined
      ? undefined
      : translate('memory_themed_title', { values: { theme: translate(themeKey), year: String(year) } });
  },

  on_this_day_place: (context, translate) => {
    const city = asString(context, 'city');
    return city === undefined ? undefined : translate('memory_on_this_day_place_title', { values: { city } });
  },

  people_together: (context, translate) => {
    const nameA = asString(context, 'personAName');
    const nameB = asString(context, 'personBName');
    return nameA === undefined || nameB === undefined
      ? undefined
      : translate('memory_people_together_title', { values: { nameA, nameB } });
  },

  person_throwback: (context, translate) => {
    const name = asString(context, 'personName');
    return name === undefined ? undefined : translate('memory_person_throwback_title', { values: { name } });
  },
};

/** "12 photos" — shared by every rule whose subtitle is nothing but a photo count. */
const assetCountSubtitle: Builder = (context, translate) => {
  const count = asNumber(context, 'count');
  return count === undefined ? undefined : translate('memory_assets_count', { values: { count } });
};

const SUBTITLE_BUILDERS: Record<string, Builder> = {
  birthday: (context, translate) => {
    if (asString(context, 'variant') === 'recent') {
      const name = asString(context, 'personName');
      return name === undefined ? undefined : translate('memory_birthday_subtitle_recent', { values: { name } });
    }

    return translate('memory_birthday_subtitle_across_years');
  },

  recent_trip: (context, translate) => {
    const assetCount = asNumber(context, 'assetCount');
    const dayCount = asNumber(context, 'dayCount');
    return assetCount === undefined || dayCount === undefined
      ? undefined
      : translate('memory_recent_trip_subtitle', { values: { assetCount, dayCount } });
  },

  trip_anniversary: (context, translate) => {
    const yearsAgo = asNumber(context, 'yearsAgo');
    const assetCount = asNumber(context, 'assetCount');
    const dayCount = asNumber(context, 'dayCount');
    return yearsAgo === undefined || assetCount === undefined || dayCount === undefined
      ? undefined
      : translate('memory_trip_anniversary_subtitle', { values: { yearsAgo, assetCount, dayCount } });
  },

  month_recap: assetCountSubtitle,
  season_recap: assetCountSubtitle,
  themed: assetCountSubtitle,

  favorites_throwback: (context, translate) => {
    const count = asNumber(context, 'count');
    return count === undefined ? undefined : translate('memory_favorites_throwback_subtitle', { values: { count } });
  },

  video_moments: (context, translate) => {
    const count = asNumber(context, 'count');
    return count === undefined ? undefined : translate('memory_video_moments_subtitle', { values: { count } });
  },

  on_this_day_place: (context, translate) => {
    const count = asNumber(context, 'count');
    const years = asYears(context);
    if (count === undefined || years === undefined) {
      return undefined;
    }

    // The rule needs two years to fire at all, but don't render "across 1 years" if that ever
    // relaxes — a lone year adds nothing the title does not already say.
    if (years.length < 2) {
      return translate('memory_assets_count', { values: { count } });
    }

    // A separate message per length rather than a joined list: "and" placement and separators
    // differ by language, and a translator can only get them right with the whole sentence.
    // Years go through as strings: as numbers, ICU would group them into "2,023".
    const [first, second, third] = years;
    if (years.length === 2) {
      return translate('memory_on_this_day_place_subtitle_two_years', {
        values: { count, firstYear: String(first), secondYear: String(second) },
      });
    }

    if (years.length === 3) {
      return translate('memory_on_this_day_place_subtitle_three_years', {
        values: { count, firstYear: String(first), secondYear: String(second), thirdYear: String(third) },
      });
    }

    return translate('memory_on_this_day_place_subtitle_many_years', {
      values: { count, yearCount: years.length },
    });
  },

  people_together: (context, translate, locale) => {
    const count = asNumber(context, 'count');
    const monthYear = monthYearOf(context, locale);
    return count === undefined || monthYear === undefined
      ? undefined
      : translate('memory_people_together_subtitle', { values: { count, monthYear } });
  },

  person_throwback: (context, translate, locale) => {
    const count = asNumber(context, 'count');
    const monthYear = monthYearOf(context, locale);
    return count === undefined || monthYear === undefined
      ? undefined
      : translate('memory_person_throwback_subtitle', { values: { count, monthYear } });
  },
};

const build = (
  memory: MemoryResponseDto,
  builders: Record<string, Builder>,
  translate: MessageFormatter,
  locale?: string,
) => {
  if (memory.type !== MemoryType.Rule) {
    return undefined;
  }

  const data = memory.data as Record<string, unknown>;
  const ruleId = typeof data.ruleId === 'string' ? data.ruleId : undefined;
  const context = (data.context ?? {}) as RuleContext;
  return ruleId === undefined ? undefined : builders[ruleId]?.(context, translate, locale);
};

export const getMemoryTitle = (
  memory: MemoryResponseDto,
  translate: MessageFormatter,
  now = new Date(),
  locale?: string,
) => {
  if (memory.title) {
    return memory.title;
  }

  if (memory.type === MemoryType.OnThisDay) {
    const year = (memory.data as Record<string, unknown>).year;
    if (typeof year === 'number') {
      return translate('years_ago', { values: { years: now.getFullYear() - year } });
    }
  }

  return build(memory, TITLE_BUILDERS, translate, locale) ?? translate('unknown');
};

export const getMemorySubtitle = (memory: MemoryResponseDto, translate: MessageFormatter, locale?: string) => {
  if (memory.subtitle) {
    return memory.subtitle;
  }

  return build(memory, SUBTITLE_BUILDERS, translate, locale) ?? '';
};
