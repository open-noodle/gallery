# Workflow Expansion — Slice 21: `create_album_from_source` router & slots

> Routing only — no execution/registration (Slice 22 adds `run`; Slice 23
> registers + manifests). Test-first.

**Goal:** New module `create-album-from-source.mjs` (router half). Match
"make/create an album of/from <source> [called <name>]". Slots
`{ sourceDescription, albumName }` (default name when omitted). **Decline** a
"recent trip" source (owned by `create_recent_trip_album`) and a subjective source.
"add … to <album>" never matches (no "make album" verb).

**Spec scope:** Slice 21.

## Design — `create-album-from-source.mjs`

```
KIND = 'create_album_from_source', flow = 'hybrid'
DEFAULT_NAME = 'New Album'
```

Helpers: `clean`, `cleanSource` (trailing punct strip), `stripQuotes`/`cleanName`
(as tag_assets). `declinesSource(source)` =
`SUBJECTIVE_PATTERN.test(source) || /\brecent\s+trip\b/i.test(source)`.

Pattern:

```
CREATE = /\b(?:make|create|build|put\s+together|assemble|generate)\s+(?:me\s+)?(?:an?\s+|a\s+new\s+|another\s+)?album\s+(?:of|from|out\s+of|with|containing|for)\s+(?<source>.+?)(?:\s+(?:called|named|titled|with\s+the\s+(?:name|title))\s+(?<name>.+))?$/i
```

`match(prompt)`:

```
text = clean(prompt); if (!text) return undefined
m = CREATE.exec(text); if (!m?.groups) return undefined
source = cleanSource(m.groups.source)
if (!source || declinesSource(source)) return undefined        // → trip / open
const name = cleanName(m.groups.name)                          // '' if absent
return { slots: name ? { sourceDescription: source, albumName: name } : { sourceDescription: source } }
```

`parseSlots(rawSlots)`:

```
sourceDescription = cleanSource(rawSlots?.sourceDescription)
if (!sourceDescription) return null
const albumName = cleanName(rawSlots?.albumName) || DEFAULT_NAME
return { sourceDescription, albumName }
```

## TDD — exact tests (`create-album-from-source.test.mjs`)

- [ ] `wf.match('make an album of my newest 50 photos')` → `{ slots: { sourceDescription: 'my newest 50 photos' } }` (no name yet).
- [ ] `wf.match('create an album from my newest 50 photos called Recent')` → `{ sourceDescription: 'my newest 50 photos', albumName: 'Recent' }`.
- [ ] `wf.match('make a new album of my newest 20 photos titled "Spring Break"')` → `albumName: 'Spring Break'` (quoted).
- [ ] `wf.match('make an album for my recent trip')` → `undefined` (trip source declines).
- [ ] `wf.match('create an album of the best photos from last weekend')` → `undefined` (subjective).
- [ ] `wf.match('add my newest 20 to Family')` → `undefined` (not a make-album).
- [ ] `wf.match('make an album of my photos.')` → `{ sourceDescription: 'my photos' }` (trailing punct stripped).
- [ ] `wf.match('')` → `undefined`.
- [ ] `wf.parseSlots({ sourceDescription: 'my newest 50 photos' })` → `{ sourceDescription: 'my newest 50 photos', albumName: 'New Album' }` (default name).
- [ ] `wf.parseSlots({ sourceDescription: 'my newest 50 photos', albumName: '"Recent"' })` → `albumName: 'Recent'` (quotes stripped).
- [ ] `wf.parseSlots({ sourceDescription: '   ' })` → `null` (empty source).
- [ ] `wf.parseSlots({ albumName: 'X' })` → `null` (no source).
- [ ] `wf.kind === 'create_album_from_source'`, `wf.flow === 'hybrid'`, `typeof wf.run === 'undefined'`.

## Edge cases covered

- of/from/out of/for connectors; explicit vs default name; quoted name; trailing
  punct; trip + subjective sources decline; "add … to album" does not match.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New `create-album-from-source.test.mjs` green; all prior green.

## Commit

`feat: add create_album_from_source router + slot parsing (slice 21)`
