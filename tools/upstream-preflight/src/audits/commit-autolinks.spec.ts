import { describe, expect, it } from 'vitest';
import { findForeignAutolinks } from './commit-autolinks';

const texts = (message: string) =>
  findForeignAutolinks(message).map((link) => link.text);

describe('findForeignAutolinks', () => {
  it('flags a bare upstream-range #N', () => {
    expect(texts('port #30881 onto the fork')).toEqual(['#30881']);
  });

  it('keeps fork-local refs, including four-digit ones', () => {
    expect(texts('fix #789 and #1016 and #1017')).toEqual([]);
  });

  it('keeps our own PR numbers as they grow past the old frozen ceiling', () => {
    // regression: the threshold was once pinned to the then-current max (1017), so #1020 was
    // reported as foreign the day it merged
    expect(
      texts('docs: forbid commit messages that autolink Immich PRs (#1020)'),
    ).toEqual([]);
    expect(texts('see #9999')).toEqual([]);
  });

  it('flags the first number above the fork ceiling', () => {
    expect(texts('see #10000')).toEqual(['#10000']);
  });

  it('flags an older five-digit upstream ref', () => {
    expect(texts('tracked upstream in #12848')).toEqual(['#12848']);
  });

  it('flags an explicit cross-repo ref but not our own', () => {
    expect(texts('svelte bug (sveltejs/svelte#18546)')).toEqual([
      'sveltejs/svelte#18546',
    ]);
    expect(texts('supersedes open-noodle/gallery#42')).toEqual([]);
  });

  it('flags #N glued to a preceding word char', () => {
    // real case from the fork's history: "endpoint removed PR#27022"
    expect(texts('endpoint removed PR#27022')).toEqual(['#27022']);
  });

  it('leaves a glued fork-local ref alone', () => {
    expect(texts('tracked in gh#671 and LOW#14')).toEqual([]);
  });

  it('flags GH-N', () => {
    expect(texts('closes GH-30881')).toEqual(['GH-30881']);
  });

  it('flags a foreign issue/PR URL but not one of ours', () => {
    expect(
      texts('Submission: https://github.com/xneo1/portainer_templates/pull/13'),
    ).toEqual(['https://github.com/xneo1/portainer_templates/pull/13']);
    expect(
      texts('Tracked: https://github.com/open-noodle/gallery/issues/685'),
    ).toEqual([]);
  });

  it('does not flag the de-linked replacement form', () => {
    expect(texts('upstream immich-30881 deleted src/config.ts')).toEqual([]);
    expect(texts('svelte bug (sveltejs/svelte 18546)')).toEqual([]);
    expect(texts('Submission: xneo1/portainer_templates PR 13')).toEqual([]);
  });

  it('does not mistake a date or version for a ref', () => {
    expect(texts('bump to v3.1.0 on 2026-08-23')).toEqual([]);
  });
});
