import { getCleanupRewindAssets, getCleanupRewindYears, type CleanupAssetDto } from '@immich/sdk';
import { error } from '@sveltejs/kit';
import { authenticate } from '$lib/utils/auth';
import { parseMonthDay } from '$lib/utils/cleanup';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

// Only the most recent year is loaded up front; the page fetches the rest one year at a time as
// the user scrolls, because a single date can hold well over a thousand photos.
export const load = (async ({ url, params, untrack }) => {
  // Opening the viewer changes the URL; untracking it keeps that from refetching the whole date.
  await authenticate(new URL(untrack(() => url.href)));
  const monthDay = parseMonthDay(params.monthDay);
  if (monthDay === undefined) {
    error(404);
  }

  const [{ years }, $t] = await Promise.all([getCleanupRewindYears({ monthDay }), getFormatter()]);
  let firstYear: { year: number; assets: CleanupAssetDto[] } | undefined;
  if (years.length > 0) {
    const { assets } = await getCleanupRewindAssets({ monthDay, year: years[0].year });
    firstYear = { year: years[0].year, assets };
  }

  return {
    monthDay,
    years,
    firstYear,
    meta: {
      title: $t('cleanup_rewind'),
    },
  };
}) satisfies PageLoad;
