#!/usr/bin/env node
// Builds the locale bundle that web and mobile load: upstream i18n/<locale>.json plus the Gallery
// overlay i18n/gallery/<locale>.json. Design: specs/2026-10-11-i18n-overlay-design.md.
//
//   node i18n/gallery/merge.mjs              write the bundle to i18n/gallery/merged/
//   node i18n/gallery/merge.mjs --out <dir>  write it elsewhere (apply-branding passes i18n/)
//   node i18n/gallery/merge.mjs --check      fail on dead or stale overlay entries
//
// Collision policy: upstream wins, unless overrides.txt lists the key. A listed key takes the
// overlay value where the overlay has one. A key listed as `exclusive` also drops upstream's
// translation in every locale the overlay does not translate, because it describes the old wording.
// A listed key the overlay leaves in English upstream's (a translation-only override) carries an
// en:<hash> of that English, and --check fails when upstream rewords it.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const galleryDir = path.dirname(fileURLToPath(import.meta.url));
const upstreamDir = path.dirname(galleryDir);
export const mergedDir = path.join(galleryDir, "merged");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const jsonFiles = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];

// One line per key: `<key> [exclusive] [en:<hash>]`. The en: tag pins the upstream English a
// translation-only override was written against (see enTag), so --check notices a rewording.
export const parseOverrides = (text) => {
  const entries = [];
  for (const line of text.split("\n")) {
    const [key, ...tokens] = line.replace(/#.*/, "").trim().split(/\s+/);
    if (!key) {
      continue;
    }
    const entry = { key, mode: "override", en: undefined };
    for (const token of tokens) {
      if (token === "exclusive") {
        entry.mode = token;
      } else if (/^en:[0-9a-f]{8}$/.test(token)) {
        entry.en = token.slice(3);
      } else {
        throw new Error(`overrides.txt: cannot parse "${line}"`);
      }
    }
    entries.push(entry);
  }
  return entries;
};

const readOverrideEntries = () => {
  const file = path.join(galleryDir, "overrides.txt");
  return fs.existsSync(file)
    ? parseOverrides(fs.readFileSync(file, "utf8"))
    : [];
};

export const readOverrides = () =>
  new Map(readOverrideEntries().map(({ key, mode }) => [key, mode]));

export const enTag = (text) =>
  createHash("sha256").update(text).digest("hex").slice(0, 8);

const leaves = (obj, prefix = []) =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === "object"
      ? leaves(value, [...prefix, key])
      : [[[...prefix, key], value]],
  );
const get = (obj, keys) =>
  keys.reduce(
    (node, key) => (node && typeof node === "object" ? node[key] : undefined),
    obj,
  );
const set = (obj, keys, value) => {
  const parent = keys.slice(0, -1).reduce((node, key) => {
    node[key] ??= {};
    if (typeof node[key] !== "object") {
      throw new Error(
        `overlay key ${keys.join(".")} collides with upstream string ${key}`,
      );
    }
    return node[key];
  }, obj);
  parent[keys.at(-1)] = value;
};
const unset = (obj, keys) => {
  const parent = get(obj, keys.slice(0, -1));
  if (parent && typeof parent === "object") {
    delete parent[keys.at(-1)];
  }
};
const sortKeys = (value) =>
  value && typeof value === "object"
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, sortKeys(value[key])]),
      )
    : value;

export const mergeLocale = (upstream, overlay, overrides) => {
  const out = structuredClone(upstream);
  for (const [key, mode] of overrides) {
    if (mode === "exclusive") {
      unset(out, key.split("."));
    }
  }
  for (const [keys, value] of leaves(overlay)) {
    if (get(out, keys) === undefined || overrides.has(keys.join("."))) {
      set(out, keys, value);
    }
  }
  return sortKeys(out);
};

export const writeMergedI18n = (outDir = mergedDir) => {
  const overrides = readOverrides();
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of jsonFiles(upstreamDir)) {
    const overlayFile = path.join(galleryDir, file);
    const overlay = fs.existsSync(overlayFile) ? readJson(overlayFile) : {};
    const content =
      JSON.stringify(
        mergeLocale(readJson(path.join(upstreamDir, file)), overlay, overrides),
        null,
        2,
      ) + "\n";
    const target = path.join(outDir, file);
    // Skip unchanged files so watchers do not see a change, and write via rename so a reader never sees half a file.
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) {
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, content);
      fs.renameSync(tmp, target);
    }
  }
};

// Vite dev server: rebuild the bundle when an overlay or upstream locale file changes, so HMR picks it up.
export const galleryI18nVitePlugin = () => ({
  name: "gallery-i18n-overlay",
  configureServer(server) {
    const rebuild = (file) => {
      if (
        (file.endsWith(".json") || file.endsWith("overrides.txt")) &&
        [galleryDir, upstreamDir].includes(path.dirname(file))
      ) {
        writeMergedI18n();
      }
    };
    server.watcher.add([galleryDir, upstreamDir]);
    server.watcher
      .on("change", rebuild)
      .on("add", rebuild)
      .on("unlink", rebuild);
  },
});

// Translation-only override: the overlay keeps its own translations of upstream's English. When
// upstream rewords that English, those translations describe the old text and must be reviewed.
export const translationOnlyProblem = (key, tag, upstreamEn) => {
  const current = enTag(upstreamEn);
  if (tag === current) {
    return undefined;
  }
  return tag
    ? `overrides.txt ${key}: upstream reworded the English; check the gallery translations still match it, then set en:${current}`
    : `overrides.txt ${key}: translation-only override without en:${current}; add the tag so a rewording is caught`;
};

// The overlay translates an upstream key that upstream's own locale file leaves untranslated. The
// merge takes it without a listing (there is nothing to collide with), so only overrides.txt can pin
// the English it was written against.
export const unpinnedTranslationProblem = (file, key, upstreamEn) =>
  `gallery/${file} ${key}: translates upstream's English without a pin; list it in overrides.txt as "${key} en:${enTag(upstreamEn)}" so a rewording is caught`;

export const checkOverlay = () => {
  const entries = readOverrideEntries();
  const overrides = readOverrides();
  const problems = [];
  const en = readJson(path.join(upstreamDir, "en.json"));
  const galleryEn = readJson(path.join(galleryDir, "en.json"));
  for (const { key, en: tag } of entries) {
    const keys = key.split(".");
    const upstreamEn = get(en, keys);
    if (upstreamEn === undefined) {
      problems.push(
        `overrides.txt lists ${key}, which upstream en.json no longer has: drop the line`,
      );
      continue;
    }
    if (get(galleryEn, keys) === undefined) {
      const problem = translationOnlyProblem(key, tag, upstreamEn);
      if (problem) {
        problems.push(problem);
      }
    }
  }
  for (const file of jsonFiles(galleryDir)) {
    const upstreamFile = path.join(upstreamDir, file);
    if (!fs.existsSync(upstreamFile)) {
      problems.push(
        `gallery/${file} has no upstream ${file}, so it is never loaded`,
      );
      continue;
    }
    const upstream = readJson(upstreamFile);
    for (const [keys, value] of leaves(readJson(path.join(galleryDir, file)))) {
      const key = keys.join(".");
      const upstreamValue = get(upstream, keys);
      const mode = overrides.get(key);
      if (upstreamValue === undefined) {
        const upstreamEn = get(en, keys);
        if (!mode && upstreamEn !== undefined) {
          problems.push(unpinnedTranslationProblem(file, key, upstreamEn));
        }
        continue;
      }
      if (!mode) {
        problems.push(
          `gallery/${file} ${key}: upstream now defines it and wins; delete it or list it in overrides.txt`,
        );
      } else if (mode === "override" && upstreamValue === value) {
        problems.push(`gallery/${file} ${key}: same as upstream; delete it`);
      }
    }
  }
  return problems;
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args[0] === "--check") {
    const problems = checkOverlay();
    for (const problem of problems) {
      console.error(problem);
    }
    process.exit(problems.length > 0 ? 1 : 0);
  }
  writeMergedI18n(args[0] === "--out" ? path.resolve(args[1]) : mergedDir);
}
