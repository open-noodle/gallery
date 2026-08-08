import { fireEvent, screen } from '@testing-library/svelte';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { renderWithTooltips } from '$tests/helpers';
import Combobox from './Combobox.svelte';

// Geometry measured on an iPad Pro 13" simulator, on the "Sidebar" setting from Account
// Settings > App Settings (issue #959).
const LAYOUT_HEIGHT = 946;
const INPUT_TOP = 586;
const INPUT_BOTTOM = 626;
const INPUT_LEFT = 502;

// With the on-screen keyboard up, iPadOS shrinks the viewport to 448 and scrolls the
// document 388px so the field clears the keyboard, landing it at 275..315.
const KEYBOARD_VIEWPORT = 448;
const KEYBOARD_SCROLL = 388;
const KEYBOARD_INPUT_TOP = 275;
const KEYBOARD_INPUT_BOTTOM = 315;

const rect = (top: number, bottom: number, left = INPUT_LEFT) =>
  ({
    top,
    bottom,
    left,
    right: left + 300,
    width: 300,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => '',
  }) as DOMRect;

const options = [
  { label: 'Automatic', value: 'auto' },
  { label: 'Always expanded', value: 'expanded' },
  { label: 'Always compact', value: 'rail' },
];

/**
 * `position: fixed` does not always resolve against the viewport - Bits UI dialogs and
 * iPadOS-with-keyboard both shift the frame. `frameTop` is where a fixed `top: 0` actually
 * lands, in client coordinates.
 */
const openDropdown = async ({
  input,
  visibleHeight = LAYOUT_HEIGHT,
  scale = 1,
  frameTop = 0,
  frameBottom = LAYOUT_HEIGHT,
}: {
  input: DOMRect;
  visibleHeight?: number;
  scale?: number;
  frameTop?: number;
  frameBottom?: number;
}) => {
  vi.stubGlobal('innerHeight', visibleHeight);
  vi.stubGlobal('visualViewport', {
    height: visibleHeight,
    width: 1376,
    scale,
    offsetLeft: 0,
    offsetTop: 0,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });

  renderWithTooltips(Combobox, { label: 'Sidebar', options, selectedOption: options[0] });

  // happy-dom reports every rect as zero, so the geometry under test is stubbed onto the
  // individual elements the component measures.
  const inputElement = screen.getByRole('combobox');
  inputElement.getBoundingClientRect = () => input;
  const stubFrame = (side: string, top: number) => {
    const probe = document.querySelector<HTMLElement>(`[data-fixed-frame="${CSS.escape(side)}"]`)!;
    probe.getBoundingClientRect = () => rect(top, top, 0);
  };
  stubFrame('start', frameTop);
  stubFrame('end', frameBottom);

  await fireEvent.focus(inputElement);
  return screen.getByRole('listbox');
};

/** The px budget the dropdown gets, parsed out of `min(<n>px, 18rem)`. */
const maxHeightPx = (listbox: HTMLElement) => Number(/min\((?<px>[\d.]+)px/.exec(listbox.style.maxHeight)!.groups!.px);

/** A single option row is roughly 36px tall; less than that shows nothing at all. */
const ONE_OPTION = 36;

describe('Combobox', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens below the input when there is room below', async () => {
    const listbox = await openDropdown({ input: rect(INPUT_TOP, INPUT_BOTTOM) });

    expect(listbox.style.top).toBe(`${INPUT_BOTTOM}px`);
    expect(listbox.style.bottom).toBe('');
    expect(maxHeightPx(listbox)).toBeGreaterThanOrEqual(ONE_OPTION);
  });

  // Issue #959: on iPad the on-screen keyboard covers the space below the input, so sizing
  // the dropdown against the shrunken viewport left it 0px tall - open, but invisible.
  it('opens above the input when the on-screen keyboard leaves no room below', async () => {
    const listbox = await openDropdown({
      input: rect(KEYBOARD_INPUT_TOP, KEYBOARD_INPUT_BOTTOM),
      visibleHeight: KEYBOARD_VIEWPORT,
    });

    expect(listbox.style.bottom).toBe(`${LAYOUT_HEIGHT - KEYBOARD_INPUT_TOP}px`);
    expect(listbox.style.top).toBe('');
    expect(maxHeightPx(listbox)).toBeGreaterThanOrEqual(ONE_OPTION);
  });

  // Issue #959, the part that actually put the list off-screen: iPadOS Safari resolves
  // `position: fixed` against the document while the keyboard is up, so placing the
  // dropdown at the input's client coordinates landed it `window.scrollY` too high.
  it('offsets against the box fixed positioning really resolves against', async () => {
    const listbox = await openDropdown({
      input: rect(KEYBOARD_INPUT_TOP, KEYBOARD_INPUT_BOTTOM),
      visibleHeight: LAYOUT_HEIGHT, // room below, so it opens downwards
      frameTop: -KEYBOARD_SCROLL,
      frameBottom: LAYOUT_HEIGHT - KEYBOARD_SCROLL,
    });

    // Placed at 315 - (-388): renders at client 703 - 388 = 315, flush under the input.
    expect(listbox.style.top).toBe(`${KEYBOARD_INPUT_BOTTOM + KEYBOARD_SCROLL}px`);
    expect(listbox.style.left).toBe(`${INPUT_LEFT}px`);
  });

  it('offsets upward placement against the same frame', async () => {
    const listbox = await openDropdown({
      input: rect(KEYBOARD_INPUT_TOP, KEYBOARD_INPUT_BOTTOM),
      visibleHeight: KEYBOARD_VIEWPORT,
      frameTop: -KEYBOARD_SCROLL,
      frameBottom: LAYOUT_HEIGHT - KEYBOARD_SCROLL,
    });

    // Bottom edge lands at frameBottom - bottom = client 275, flush above the input.
    expect(listbox.style.bottom).toBe(`${LAYOUT_HEIGHT - KEYBOARD_SCROLL - KEYBOARD_INPUT_TOP}px`);
    expect(maxHeightPx(listbox)).toBeGreaterThanOrEqual(ONE_OPTION);
  });

  // Deliberate behaviour from upstream #12848: while pinch-zoomed the dropdown stays
  // anchored directly below the input rather than flipping into unzoomed layout space.
  it('stays below the input while the viewport is pinch-zoomed', async () => {
    const listbox = await openDropdown({ input: rect(INPUT_TOP, INPUT_BOTTOM), visibleHeight: 473, scale: 2 });

    expect(listbox.style.top).toBe(`${INPUT_BOTTOM}px`);
    expect(listbox.style.bottom).toBe('');
  });
});
