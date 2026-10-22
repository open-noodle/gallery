import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContributorsSection,
  extractPrNumbers,
  groupByAuthor,
  isBot,
  lookupAuthors,
  renderContributors,
} from "./release-contributors.mjs";

const user = (login, type = "User") => ({ login, type });

// A fake GitHub: pulls maps PR number -> user; anything absent answers 404 like an issue number does.
const fakeGitHub = (pulls, { failing = [], throwing = [] } = {}) => {
  const calls = [];
  const fetchImpl = async (url) => {
    const number = Number(url.split("/").pop());
    calls.push(number);
    if (throwing.includes(number)) {
      throw new Error("socket hang up");
    }
    if (failing.includes(number)) {
      return { ok: false, status: 502, json: async () => ({}) };
    }
    if (!(number in pulls)) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ user: pulls[number] }),
    };
  };
  return { fetchImpl, calls };
};

test("extractPrNumbers keeps our own PR numbers, once each and sorted", () => {
  const text = [
    "feat: add an Adjust tool (#1124)",
    "feat(web): show the photo's context (#1039) (#1079)",
    "fix: the same PR listed twice (#1124)",
    "fix: an early upstream backport (#32593)",
    "fix: no number at all",
  ].join("\n");
  assert.deepEqual(extractPrNumbers(text), [1039, 1079, 1124]);
});

test("extractPrNumbers returns nothing for text without PR references", () => {
  assert.deepEqual(extractPrNumbers(""), []);
  assert.deepEqual(extractPrNumbers("fix: nothing to see"), []);
});

test("isBot recognises GitHub apps by type and by login suffix", () => {
  assert.equal(isBot(user("dependabot[bot]", "Bot")), true);
  assert.equal(isBot(user("renovate[bot]")), true);
  assert.equal(isBot(user("luminoso")), false);
});

test("groupByAuthor drops bots and orders by fewest changes, then login", () => {
  const authors = new Map([
    [1, user("maintainer")],
    [2, user("maintainer")],
    [3, user("maintainer")],
    [4, user("Zed")],
    [5, user("alice")],
    [6, user("renovate[bot]", "Bot")],
    [7, user("alice")],
  ]);
  assert.deepEqual(groupByAuthor(authors), [
    { login: "Zed", prs: [4] },
    { login: "alice", prs: [5, 7] },
    { login: "maintainer", prs: [1, 2, 3] },
  ]);
});

test("renderContributors @-mentions each contributor, and summarises long lists", () => {
  const long = Array.from({ length: 9 }, (_, i) => i + 1);
  const markdown = renderContributors([
    { login: "alice", prs: [1165, 1166] },
    { login: "maintainer", prs: long },
  ]);
  assert.match(markdown, /^## Contributors\n/);
  assert.match(markdown, /^- @alice: #1165, #1166$/m);
  assert.match(markdown, /^- @maintainer: 9 changes$/m);
});

test("renderContributors is empty when there is nobody to credit", () => {
  assert.equal(renderContributors([]), "");
});

test("lookupAuthors skips issue numbers quietly and counts real failures", async () => {
  const { fetchImpl } = fakeGitHub(
    { 10: user("alice") },
    { failing: [30], throwing: [40] },
  );
  const { authors, failed } = await lookupAuthors([10, 20, 30, 40], {
    repo: "o/r",
    token: "t",
    fetchImpl,
  });
  assert.deepEqual([...authors], [[10, user("alice")]]);
  assert.equal(failed, 2); // 20 is a 404 (an issue), not a failure
});

test("lookupAuthors sends the token and looks up each number exactly once", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, auth: init.headers.authorization });
    return {
      ok: true,
      status: 200,
      json: async () => ({ user: user("alice") }),
    };
  };
  await lookupAuthors([1, 2, 3], { repo: "o/r", token: "secret", fetchImpl });
  assert.equal(seen.length, 3);
  assert.ok(seen.every((s) => s.auth === "Bearer secret"));
  assert.ok(
    seen.every((s) =>
      s.url.startsWith("https://api.github.com/repos/o/r/pulls/"),
    ),
  );
});

test("buildContributorsSection produces the section end to end", async () => {
  const { fetchImpl } = fakeGitHub({
    1180: user("luminoso"),
    1124: user("claude-on-call"),
    1230: user("maintainer"),
    1231: user("maintainer"),
    1500: user("dependabot[bot]", "Bot"),
  });
  const text = [
    "fix: safe switch back (#1180)",
    "feat: Adjust tool (#1124)",
    "fix: manifest (#1230)",
    "docs: base (#1231)",
    "chore(deps): bump (#1500)",
    "feat: face review (#1039) (#1230)",
  ].join("\n");
  const { markdown, failed, looked } = await buildContributorsSection(text, {
    repo: "o/r",
    token: "t",
    fetchImpl,
  });
  assert.equal(failed, 0); // #1039 is an issue number: it 404s and is skipped, not counted as a failure
  assert.equal(looked, 6);
  assert.match(markdown, /^- @claude-on-call: #1124$/m);
  assert.match(markdown, /^- @luminoso: #1180$/m);
  assert.match(markdown, /^- @maintainer: #1230, #1231$/m);
  assert.doesNotMatch(markdown, /dependabot/);
  // fewest changes first, so the maintainer closes the list
  assert.ok(markdown.indexOf("maintainer") > markdown.indexOf("luminoso"));
});

test("buildContributorsSection never throws when GitHub is unreachable", async () => {
  const { fetchImpl } = fakeGitHub({}, { throwing: [1, 2] });
  const result = await buildContributorsSection("a (#1)\nb (#2)", {
    repo: "o/r",
    token: "t",
    fetchImpl,
  });
  assert.equal(result.markdown, "");
  assert.equal(result.failed, 2);
});

test("buildContributorsSection does not call the API when there are no PR numbers", async () => {
  const { fetchImpl, calls } = fakeGitHub({});
  const result = await buildContributorsSection("fix: no refs", {
    repo: "o/r",
    token: "t",
    fetchImpl,
  });
  assert.equal(result.markdown, "");
  assert.deepEqual(calls, []);
});
