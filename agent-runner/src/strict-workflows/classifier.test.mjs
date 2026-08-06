import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildClassifierPrompt, createIntentClassifier, looksActionable } from './classifier.mjs';

const manifest = [
  {
    kind: 'create_recent_trip_album',
    flow: 'strict',
    classifierDescription: 'User wants an album built from a recent trip.',
    slots: {
      albumName: { type: 'string', required: false, description: 'Explicit album name if the user gave one.' },
      placeHint: { type: 'string', required: false, description: 'Place text to bias trip detection.' },
    },
    positiveExamples: ['Create an album for my recent trip to USA'],
    negativeExamples: ['Add my recent trip photos to Family'],
  },
];

const tripWorkflow = {
  kind: 'create_recent_trip_album',
  match: (p) => (/recent\s+trip/i.test(p) && /album/i.test(p) ? { slots: { albumName: 'Recent Trip' } } : undefined),
  parseSlots: (s) => s,
};

// The classifier talks to the model through an injectable `classifyIntent`
// adapter so the SDK wiring stays isolated. Tests inject a fake that asserts the
// call is tool-free from the classifier's perspective (the adapter owns tools).
const fakeClassify = (result) => async () => result;

describe('intent classifier', () => {
  it('short-circuits canonical prompts via regex without calling the model', async () => {
    let called = false;
    const classifyIntent = async () => {
      called = true;
      return { workflow: 'none', slots: {}, confidence: 'low' };
    };
    const classifier = createIntentClassifier({ classifyIntent, manifest, workflows: [tripWorkflow], mode: 'hybrid' });
    const decision = await classifier.classify('Create an album for my recent trip to USA');
    assert.equal(decision.kind, 'create_recent_trip_album');
    assert.equal(decision.via, 'regex');
    assert.equal(called, false);
  });

  it('uses the LLM for paraphrases the regex misses', async () => {
    const classifyIntent = fakeClassify({
      workflow: 'create_recent_trip_album',
      slots: { placeHint: 'Japan' },
      confidence: 'high',
    });
    const classifier = createIntentClassifier({ classifyIntent, manifest, workflows: [tripWorkflow], mode: 'hybrid' });
    const decision = await classifier.classify('put my Japan trip from last week into an album');
    assert.equal(decision.kind, 'create_recent_trip_album');
    assert.equal(decision.via, 'llm');
    assert.equal(decision.slots.placeHint, 'Japan');
  });

  it('falls back to none on low confidence, unknown kind, or model error', async () => {
    const low = createIntentClassifier({
      classifyIntent: fakeClassify({ workflow: 'create_recent_trip_album', slots: {}, confidence: 'low' }),
      manifest,
      workflows: [tripWorkflow],
      mode: 'hybrid',
    });
    assert.equal((await low.classify('maybe do trip stuff?')).kind, 'none');

    const unknown = createIntentClassifier({
      classifyIntent: fakeClassify({ workflow: 'not_real', slots: {}, confidence: 'high' }),
      manifest,
      workflows: [tripWorkflow],
      mode: 'hybrid',
    });
    assert.equal((await unknown.classify('weird request please do it')).kind, 'none');

    const boom = createIntentClassifier({
      classifyIntent: async () => {
        throw new Error('provider down');
      },
      manifest,
      workflows: [tripWorkflow],
      mode: 'hybrid',
    });
    assert.equal((await boom.classify('something actionable please create it')).kind, 'none');
  });

  it('mode=regex never calls the model', async () => {
    let called = false;
    const classifyIntent = async () => {
      called = true;
      return { workflow: 'create_recent_trip_album', slots: {}, confidence: 'high' };
    };
    const classifier = createIntentClassifier({ classifyIntent, manifest, workflows: [tripWorkflow], mode: 'regex' });
    assert.equal((await classifier.classify('put my Japan trip into an album')).kind, 'none');
    assert.equal(called, false);
  });

  it('skips the model for non-actionable chatter in hybrid mode', async () => {
    let called = false;
    const classifyIntent = async () => {
      called = true;
      return { workflow: 'create_recent_trip_album', slots: {}, confidence: 'high' };
    };
    const classifier = createIntentClassifier({ classifyIntent, manifest, workflows: [tripWorkflow], mode: 'hybrid' });
    assert.equal((await classifier.classify('thanks, that looks great')).kind, 'none');
    assert.equal(called, false);
  });

  it('mode=llm skips the regex fast-path and always asks the model', async () => {
    let regexHit = 0;
    const regexCountingWorkflow = {
      ...tripWorkflow,
      match: (p) => {
        regexHit += 1;
        return tripWorkflow.match(p);
      },
    };
    const classifyIntent = fakeClassify({
      workflow: 'create_recent_trip_album',
      slots: { albumName: 'Recent Trip' },
      confidence: 'high',
    });
    const classifier = createIntentClassifier({
      classifyIntent,
      manifest,
      workflows: [regexCountingWorkflow],
      mode: 'llm',
    });
    const decision = await classifier.classify('Create an album for my recent trip to USA');
    assert.equal(decision.kind, 'create_recent_trip_album');
    assert.equal(decision.via, 'llm');
    assert.equal(regexHit, 0);
  });

  it('builds a tool-free classifier prompt from the manifest', () => {
    const prompt = buildClassifierPrompt(manifest);
    assert.match(prompt, /create_recent_trip_album/);
    assert.match(prompt, /User wants an album built from a recent trip\./);
    assert.match(prompt, /Create an album for my recent trip to USA/);
    assert.match(prompt, /Add my recent trip photos to Family/);
    assert.match(prompt, /none/);
  });

  it('names the exact slot keys in the prompt so the model does not invent them', () => {
    // Regression guard: a real local model (Qwen3-Coder) otherwise returns keys
    // like trip_location/trip_timeframe, which parseSlots rejects -> recall miss.
    const prompt = buildClassifierPrompt(manifest);
    assert.match(prompt, /albumName/);
    assert.match(prompt, /placeHint/);
    assert.match(prompt, /EXACT keys/);
    assert.match(prompt, /never invent (?:keys|new keys)/i);
  });

  it('classifies imperative requests as actionable and pure acknowledgements as not', () => {
    assert.equal(looksActionable('put my Japan trip into an album'), true);
    assert.equal(looksActionable('Organize my photos.'), true);
    assert.equal(looksActionable('thanks, that looks great'), false);
    assert.equal(looksActionable(''), false);
  });

  it('admits photo-domain paraphrases with uncommon verbs (recall over cost)', () => {
    // These were dropped by the old verb-only heuristic before reaching the LLM.
    assert.equal(looksActionable('throw the pics from our Italy getaway into a new album'), true);
    assert.equal(looksActionable('stick my newest 20 photos into the Family album'), true);
    // Still rejects pure chatter with no verb, domain noun, or question.
    assert.equal(looksActionable('the weather is lovely today'), false);
  });
});
