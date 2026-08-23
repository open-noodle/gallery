import { execFileSync } from 'node:child_process';
import type { AuditResult } from '../types';

/**
 * The fork is inside immich-app/immich's fork network, so GitHub resolves a bare `#N` in a commit
 * message against the PARENT repo whenever N is not one of ours — and files a cross-reference on
 * that upstream PR. The rolling branch replays every fork commit under a new SHA each cycle, so a
 * single such reference re-notifies upstream on every force-push, forever.
 *
 * Fork-local refs (`#N` where N <= the fork's own PR numbering) are the useful case and stay.
 */
export const OUR_REPO = 'open-noodle/gallery';

/**
 * Above this, `#N` is assumed to resolve to the upstream repo rather than ours.
 *
 * Discriminated by DIGIT COUNT, not by our current PR number: ours are 4-digit (~1000) and Immich
 * is long past 30000. An earlier version froze this at the repo's then-current max (1017) and
 * immediately began flagging our own new PRs — `#1020` was reported as foreign the day it merged.
 *
 * Two accepted limits: our repo would have to reach 10000 PRs to false-positive (roughly a decade
 * at the current rate), and an Immich reference below 10000 would slip. Fork commits reference
 * recent upstream work — every one found in the 2026-08-23 sweep was 27000+ — so the second is
 * theoretical. Matches the grep documented in AGENTS.md, which keys off 5-or-more digits.
 */
export const FORK_PR_CEILING = 9999;

export type Autolink = { form: string; text: string };

/** Every GitHub autolink form in `message` that points at a repository other than ours. */
export function findForeignAutolinks(
  message: string,
  forkPrCeiling: number = FORK_PR_CEILING,
): Autolink[] {
  const found: Autolink[] = [];

  const OWNER_REPO_REF = /\b([\w.-]+\/[\w.-]+)#\d+\b/g;
  for (const match of message.matchAll(OWNER_REPO_REF)) {
    if (match[1] !== OUR_REPO)
      found.push({ form: 'owner/repo#N', text: match[0] });
  }

  // Blank out the owner/repo refs already accounted for, so their `#N` tail is not reported a
  // second time by the plain-`#N` rules below.
  const rest = message.replace(OWNER_REPO_REF, (match) =>
    ' '.repeat(match.length),
  );

  // `#N` both standalone and glued to a preceding word char — GitHub's exact boundary rules are not
  // worth relying on, so both shapes count.
  for (const match of rest.matchAll(/(?<![\w/-])#(\d+)\b/g)) {
    if (Number(match[1]) > forkPrCeiling)
      found.push({ form: 'bare #N', text: match[0] });
  }
  for (const match of rest.matchAll(/\w#(\d+)\b/g)) {
    if (Number(match[1]) > forkPrCeiling)
      found.push({ form: 'glued #N', text: `#${match[1]}` });
  }

  for (const match of message.matchAll(/\bGH-\d+\b/g)) {
    found.push({ form: 'GH-N', text: match[0] });
  }

  for (const match of message.matchAll(
    /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:pull|issues)\/\d+/g,
  )) {
    if (`${match[1]}/${match[2]}` !== OUR_REPO)
      found.push({ form: 'issue/PR URL', text: match[0] });
  }

  return found;
}

export function runCommitAutolinkAudit(
  range = 'upstream/main..HEAD',
  cwd = process.cwd(),
  forkPrCeiling: number = FORK_PR_CEILING,
): AuditResult {
  const raw = execFileSync('git', ['log', range, '--format=%H%x00%B%x01'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

  const details: string[] = [];
  let scanned = 0;

  for (const record of raw.split('\x01')) {
    if (!record.includes('\x00')) continue;
    const [sha, message] = record.replace(/^\n+/, '').split('\x00');
    scanned += 1;
    for (const link of findForeignAutolinks(message, forkPrCeiling)) {
      details.push(`${sha.slice(0, 11)} ${link.form}: ${link.text}`);
    }
  }

  return {
    ok: details.length === 0,
    title: 'Commit messages raise no cross-repo autolink',
    details:
      details.length > 0
        ? [
            ...details,
            `Rewrite these so they do not autolink (e.g. \`#30881\` -> \`immich-30881\`); every`,
            `force-push of the rolling branch re-notifies the referenced repo otherwise.`,
          ]
        : [
            `${scanned} commit messages scanned (fork PR ceiling ${forkPrCeiling}); no cross-repo autolink`,
          ],
  };
}
