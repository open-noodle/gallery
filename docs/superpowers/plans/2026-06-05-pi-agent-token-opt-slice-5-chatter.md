# Slice 5 — Chatter / actionability pre-filter (runner)

Spec: `docs/superpowers/specs/2026-06-05-pi-agent-prompt-token-optimization-design.md` (Slice 5).
Skip the 30k-catalog open agent for clearly non-actionable prompts (pure acknowledgements /
greetings). Conservative: a real request or a question must NEVER be swallowed. agent-runner
`node:test`. TDD. (NOT prettier-gated — match single-quote style by hand.)

## Mechanism (verified)

`agent-runner/src/strict-workflows/dispatcher.mjs` `routeTurn` (line 147+): after the pending-
continuation block (line 163-183) and before `registry.classify()` (line 185). Today
`classify → none → { handled: false }` → pi-runtime spins up the full open agent.

## Implementation

Insert a chatter short-circuit **after the pending block, before `classify`**:

```js
// Conservative chatter short-circuit: pure acknowledgements / greetings get a
// no-tool reply, skipping BOTH the classifier and the 30k-catalog open agent.
// High precision (anchored whole-string allowlist) so a real request/question
// is never swallowed.
const CHATTER_PATTERN =
  /^(?:(?:thanks?|thank\s*you|ty|cheers|much\s+appreciated|appreciate\s+it)|(?:ok(?:ay)?|cool|great|perfect|awesome|amazing|nice|sweet|excellent|wonderful|fantastic)|(?:got\s+it|sounds\s+good|will\s+do|that\s+works|looks?\s+good|that\s+looks?\s+great|nice\s+work|good\s+job|well\s+done)|(?:hi|hello|hey|yo|gm|good\s+morning|good\s+afternoon|good\s+evening))(?:[\s,!.]+(?:thanks?|thank\s*you|that(?:'s| is| was)?\s+(?:great|perfect|helpful|awesome|nice|amazing)|so\s+much|a\s+lot|mate|there|everyone|team))*[\s!.?]*$/i;

const isChatter = (text) => {
  const t = String(text ?? '').trim();
  if (!t || t.length > 60) return false; // hard length guard
  if (/\?/.test(t.replace(/[\s!.]*$/u, ''))) return false; // questions are not chatter
  return CHATTER_PATTERN.test(t);
};
```

Then in `routeTurn`, before `const decision = await registry.classify(...)`:

```js
if (isChatter(prompt)) {
  // Emit a matched:false decision so L3 still reads kind=none, but flag the
  // pre-filter (fellBackToOpen:false — we did NOT spin up the open agent).
  observe({
    kind: 'strict_router_decision',
    matched: false,
    workflowKind: null,
    via: 'chatter',
    confidence: null,
    latencyMs: Math.max(0, now() - nowMs),
    fellBackToOpen: false,
  });
  const reply = chatterReply(prompt);
  appendTranscript?.(prompt, reply);
  emit(completedEvent({ text: reply }));
  return { handled: true };
}
```

`chatterReply(prompt)`: a short, friendly, no-tool reply. Greeting → "Hi! How can I help with
your photos?"; otherwise → "You're welcome! Let me know if there's anything else you'd like to
do with your photos." (Pick greeting vs ack by a `/^(hi|hello|hey|yo|gm|good\s)/i` test.)

**Do NOT** require any tools or call the model. Keep the pattern conservative — when unsure,
fall through (return nothing here → normal classify path).

## Tests (`dispatcher.test.mjs`)

- **Chatter handled, no classify, no open fallthrough:** for each of
  `['thanks', 'thanks, that looks great!', 'ok cool', "that's perfect, thank you",
'awesome', 'got it', 'hello', 'hey there', 'good morning']`:
  - `routeTurn` returns `{ handled: true }`;
  - a `completedEvent` with a non-empty `text` was emitted;
  - `registry.classify` was NOT called (spy/stub the classifier and assert 0 calls);
  - a `strict_router_decision` with `matched:false, via:'chatter', fellBackToOpen:false` was
    observed.
- **Real requests / questions still fall through (NOT swallowed):** for
  `['how many photos do I have?', 'find my Sony photos from May', 'archive my newest 20',
'trash my screenshots', 'show me the good ones', 'thanks for nothing, now delete everything',
'can you make an album?']`:
  - `isChatter` is false → `classify` IS called → behaves exactly as before (handled or
    `{ handled: false }` per the classifier). Assert classify was called.
  - (Note the adversarial "thanks … now delete everything" and "thanks for the album, add 5
    more" cases — these contain an action verb / are long, so the length + allowlist guards
    must reject them. Add them explicitly.)
- Existing dispatcher routing/approval/continuation tests stay green (chatter check is only on
  the no-pending pre-classify path).

## L3 impact (no scenario change needed)

The chatter L3 negatives (`l3.neg.thanks` "thanks, that looks great!", and any pure-ack) now
route via the pre-filter, which emits `matched:false` → `kind: none` — so the existing
`expect: { kind: 'none' }` assertions still hold. The non-chatter negatives
(`l3.neg.count` / `.search` / `.subjective` / `.where`, all questions/actionable) still reach
the open agent unchanged. No L3 file edits required; the final checkpoint confirms it live.

## Verify

```bash
cd agent-runner && node --test src/strict-workflows/dispatcher.test.mjs
node --test 'src/**/*.test.mjs'   # full agent-runner suite green, count up
```

No server / OpenAPI change.

## Commit

```bash
git add agent-runner/ docs/superpowers/plans/2026-06-05-pi-agent-token-opt-slice-5-chatter.md
git commit -m "perf(agent): chatter pre-filter skips the open-agent catalog for acks/greetings (token-opt slice 5)"
```

## Done when

- Pure acknowledgements/greetings get a no-tool reply with no classify + no open agent; real
  requests and questions (incl. adversarial "thanks … now delete everything") still fall
  through unchanged.
- dispatcher.test.mjs + full agent-runner suite green.
- Report the final chatter pattern + the count of new tests.
