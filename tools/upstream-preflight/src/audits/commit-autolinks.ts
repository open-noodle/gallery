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

/** Above this, `#N` cannot be one of ours and therefore resolves to the upstream repo. */
export const FORK_PR_CEILING = 1017;

export type Autolink = { form: string; text: string };

/** Every GitHub autolink form in `message` that points at a repository other than ours. */
export function findForeignAutolinks(message: string): Autolink[] {
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
    if (Number(match[1]) > FORK_PR_CEILING)
      found.push({ form: 'bare #N', text: match[0] });
  }
  for (const match of rest.matchAll(/\w#(\d+)\b/g)) {
    if (Number(match[1]) > FORK_PR_CEILING)
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
    for (const link of findForeignAutolinks(message)) {
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
        : [`${scanned} commit messages scanned; no cross-repo autolink`],
  };
}
