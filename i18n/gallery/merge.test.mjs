import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enTag,
  mergeLocale,
  parseOverrides,
  translationOnlyProblem,
  unpinnedTranslationProblem,
} from "./merge.mjs";

const upstream = {
  a: "up a",
  admin: { b: "up b", c: "up c" },
  d: "up d",
  e: "up e",
};

test("upstream wins unless listed; exclusive drops untranslated upstream", () => {
  const overlay = {
    a: "fork a",
    admin: { b: "fork b", x: "fork x" },
    z: "fork z",
  };
  const overrides = new Map([
    ["admin.b", "override"],
    ["d", "exclusive"],
    ["e", "override"],
  ]);
  assert.deepEqual(mergeLocale(upstream, overlay, overrides), {
    a: "up a",
    admin: { b: "fork b", c: "up c", x: "fork x" },
    e: "up e",
    z: "fork z",
  });
});

test("an exclusive key keeps the overlay translation where there is one", () => {
  assert.equal(
    mergeLocale(upstream, { d: "fork d" }, new Map([["d", "exclusive"]])).d,
    "fork d",
  );
});

test("overrides.txt lines parse mode and en tag in any order", () => {
  assert.deepEqual(
    parseOverrides(
      "# c\na\nb exclusive\nc en:0123abcd\nd en:0123abcd exclusive\n",
    ),
    [
      { key: "a", mode: "override", en: undefined },
      { key: "b", mode: "exclusive", en: undefined },
      { key: "c", mode: "override", en: "0123abcd" },
      { key: "d", mode: "exclusive", en: "0123abcd" },
    ],
  );
  assert.throws(() => parseOverrides("a en:xyz"), /cannot parse/);
});

test("a translation-only override fails when upstream rewords its English", () => {
  const tag = enTag("Old text");
  assert.equal(translationOnlyProblem("k", tag, "Old text"), undefined);
  assert.match(
    translationOnlyProblem("k", tag, "New text"),
    /upstream reworded/,
  );
  assert.match(
    translationOnlyProblem("k", undefined, "Old text"),
    /without en:/,
  );
});

test("a translation of an upstream key the locale lacks must be pinned", () => {
  assert.match(
    unpinnedTranslationProblem("zh_Hant.json", "k", "Old text"),
    new RegExp(`"k en:${enTag("Old text")}"`),
  );
});
