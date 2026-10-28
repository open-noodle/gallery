import { duration, ease, spring } from '#lib/gallery/motion/tokens.ts';
import { readFileSync } from 'node:fs';

// Vitest runs from web/; a `?raw` import comes back empty because CSS is stubbed in unit tests.
const css = readFileSync('src/lib/gallery/motion/motion.css', 'utf8');

const cssVariable = (name: string) => {
  const match = new RegExp(String.raw`--${name}:\s*([^;]+);`).exec(css);
  // prettier wraps the long linear() lists across lines
  return match?.[1].replaceAll(/\s+/g, ' ').replaceAll('( ', '(').replaceAll(' )', ')').trim();
};

describe('motion tokens', () => {
  it('mirror the durations in motion.css', () => {
    for (const [name, ms] of Object.entries(duration)) {
      expect(cssVariable(`motion-${name}`)).toBe(`${ms}ms`);
    }
  });

  it('mirror the easings in motion.css', () => {
    for (const [name, curve] of Object.entries(ease)) {
      expect(cssVariable(`ease-${name}`)).toBe(curve);
    }
  });

  it('mirror the springs in motion.css', () => {
    for (const [name, token] of Object.entries(spring)) {
      expect(cssVariable(`spring-${name}`)).toBe(token.easing);
      expect(cssVariable(`spring-${name}-duration`)).toBe(`${token.duration}ms`);
    }
  });

  it('start every spring at 0 and settle it at 1', () => {
    for (const token of Object.values(spring)) {
      const points = token.easing.slice('linear('.length, -1).split(',').map(Number);
      expect(points[0]).toBe(0);
      expect(points.at(-1)).toBe(1);
    }
  });
});
