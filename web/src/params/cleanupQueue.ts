import type { ParamMatcher } from '@sveltejs/kit';

export const match: ParamMatcher = (param: string) => {
  return ['space-hogs', 'bursts', 'screenshots', 'blurry'].includes(param);
};
