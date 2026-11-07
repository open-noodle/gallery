import { expect } from 'vitest';
import type { Locator } from 'vitest/browser';

// Element-returning query helpers the face-cleanup specs use alongside locators. Locators stay strict (`.element()` / `.query()` throw on several matches); these add the
// two shapes a bare locator lacks: "wait until it appears" and "all of them, but at least one".

/** Waits (retrying) until the locator matches exactly one element, then returns it. */
export const find = async (locator: Locator) => {
  await expect.element(locator).toBeInTheDocument();
  return locator.element() as HTMLElement;
};

/** Every matching element; throws when there is none, so it retries inside `vi.waitFor`. */
export const getAll = (locator: Locator) => {
  const elements = locator.elements() as HTMLElement[];
  if (elements.length === 0) {
    throw new Error(`Unable to find an element matching ${locator.selector}`);
  }
  return elements;
};

/** Waits (retrying) until the locator matches at least one element, then returns them all. */
export const findAll = async (locator: Locator) => {
  await expect.poll(() => locator.elements().length).toBeGreaterThan(0);
  return locator.elements() as HTMLElement[];
};
