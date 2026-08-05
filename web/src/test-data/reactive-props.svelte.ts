/**
 * Test helper: wraps a plain object in `$state(...)` so it carries Svelte's internal
 * `STATE_SYMBOL` tag.
 *
 * `$state` is a compiler rune, only usable inside `.svelte` / `.svelte.js`/`.svelte.ts` files
 * (this file is one; a plain `.spec.ts` is not - calling `$state` there throws
 * `rune_outside_svelte` at runtime). That restriction is not just cosmetic here: Svelte's
 * bindable-prop write-back (see `prop()` in `svelte/internal/client/reactivity/props.js`) only
 * wires up automatic write-back to an *imperatively* mounted component's props object when that
 * object carries `STATE_SYMBOL` - i.e. when it was created via `$state(...)`
 * (`is_entry_props = STATE_SYMBOL in props`). A plain object literal handed to
 * `render(Component, props)` from `@testing-library/svelte` never receives a bindable prop's
 * written-back value, so a test asserting "the component did not clobber this bound prop" would
 * pass unconditionally with a plain object - regardless of whether the component actually
 * clobbers it.
 */
export const reactiveProps = <T extends Record<string, unknown>>(props: T): T => {
  const state = $state(props);
  return state;
};
