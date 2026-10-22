#!/usr/bin/env node

// Builds the "Contributors" section of a Gallery release from the PR numbers in its change list.
//
// The release workflow already reduces the commit range to Gallery's own changes, each ending in
// "(#N)". This reads those lines on stdin, looks up who authored each PR and prints a markdown
// section on stdout (nothing at all when there is nothing to credit).
//
// It must never fail a release: a crowd of thank-yous is not worth losing the tag, the images and the
// version endpoint. Any lookup problem is reported as a warning and the affected PR is left out.

const API = "https://api.github.com";

// Our own PR numbers have at most four digits. Upstream Immich's are five digits, and an early
// backport keeps Immich's message verbatim, so the same cutoff the workflow uses keeps them out.
const OWN_PR_MAX = 10_000;

// A contributor with more PRs than this is summarised as a count instead of an unreadable run of links.
const MAX_LISTED = 8;

export function extractPrNumbers(text) {
  const found = new Set();
  for (const match of text.matchAll(/\(#(\d{1,5})\)/g)) {
    const number = Number(match[1]);
    if (number > 0 && number < OWN_PR_MAX) {
      found.add(number);
    }
  }
  return [...found].sort((a, b) => a - b);
}

export function isBot({ login, type }) {
  return type === "Bot" || /\[bot\]$/i.test(login);
}

// Resolves PR number -> { login, type }. A number that is not a PR (an issue reference such as
// "(#1039) (#1079)") answers 404 and is skipped quietly; anything else is counted as a failure.
export async function lookupAuthors(
  numbers,
  { repo, token, fetchImpl = fetch, concurrency = 5 },
) {
  const authors = new Map();
  let failed = 0;
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };

  const queue = [...numbers];
  const worker = async () => {
    while (queue.length > 0) {
      const number = queue.shift();
      try {
        const response = await fetchImpl(
          `${API}/repos/${repo}/pulls/${number}`,
          { headers },
        );
        if (response.status === 404) {
          continue;
        }
        if (!response.ok) {
          failed += 1;
          continue;
        }
        const pull = await response.json();
        if (pull?.user?.login) {
          authors.set(number, { login: pull.user.login, type: pull.user.type });
        }
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, numbers.length) }, worker),
  );

  return { authors, failed };
}

// Fewest PRs first, so the maintainer who authored most of the release closes the list.
export function groupByAuthor(authors) {
  const byLogin = new Map();
  for (const [number, author] of authors) {
    if (isBot(author)) {
      continue;
    }
    const entry = byLogin.get(author.login) ?? [];
    entry.push(number);
    byLogin.set(author.login, entry);
  }
  return [...byLogin]
    .map(([login, prs]) => ({ login, prs: prs.sort((a, b) => a - b) }))
    .sort(
      (a, b) =>
        a.prs.length - b.prs.length ||
        a.login.toLowerCase().localeCompare(b.login.toLowerCase()),
    );
}

// Real @mentions, so contributors are tagged (and linked) in the release.
export function renderContributors(groups, { maxListed = MAX_LISTED } = {}) {
  if (groups.length === 0) {
    return "";
  }
  const lines = groups.map(({ login, prs }) => {
    const detail =
      prs.length > maxListed
        ? `${prs.length} changes`
        : prs.map((n) => `#${n}`).join(", ");
    return `- @${login}: ${detail}`;
  });
  return [
    "## Contributors",
    "",
    "Thank you to everyone who contributed to this release:",
    "",
    ...lines,
    "",
  ].join("\n");
}

export async function buildContributorsSection(text, options) {
  const numbers = extractPrNumbers(text);
  if (numbers.length === 0) {
    return { markdown: "", failed: 0, looked: 0 };
  }
  const { authors, failed } = await lookupAuthors(numbers, options);
  return {
    markdown: renderContributors(groupByAuthor(authors)),
    failed,
    looked: numbers.length,
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const repo = process.env.REPO ?? process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!repo) {
    console.error("::warning::release-contributors: REPO is not set; skipping");
    return;
  }
  try {
    const { markdown, failed, looked } = await buildContributorsSection(
      await readStdin(),
      { repo, token },
    );
    if (failed > 0) {
      console.error(
        `::warning::release-contributors: ${failed} of ${looked} PR lookups failed; the list may be incomplete`,
      );
    }
    process.stdout.write(markdown);
  } catch (error) {
    console.error(
      `::warning::release-contributors: skipped (${error?.message ?? error})`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
