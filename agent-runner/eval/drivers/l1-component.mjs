// L1 driver: builds the REAL intent classifier + copy-polish against a live
// OpenAI-compatible model (no Gallery server, no DB). Mirrors how pi-runtime
// registers an openai-compatible provider and wires the classifier, so the eval
// exercises production code paths — not a reimplementation.
import { complete, Type } from '@earendil-works/pi-ai';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { createPiClassifyIntent, createPiPolishCopy } from '../../src/pi-runtime.mjs';
import { renderCopy } from '../../src/strict-workflows/copy.mjs';
import { createIntentClassifier } from '../../src/strict-workflows/classifier.mjs';
import { WORKFLOW_MANIFEST } from '../../src/strict-workflows/manifest.mjs';
import { createWorkflowRegistry } from '../../src/strict-workflows/registry.mjs';

const PROVIDER = 'gallery-eval';

export const createL1Driver = ({ llama, routerMode = 'hybrid' }) => {
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(PROVIDER, llama.secret);
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider(PROVIDER, {
    name: 'Eval local model',
    baseUrl: llama.baseUrl,
    apiKey: llama.secret,
    api: 'openai-completions',
    models: [
      {
        id: llama.model,
        name: llama.model,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 65536,
        maxTokens: 4096,
      },
    ],
  });
  const model = modelRegistry.find(PROVIDER, llama.model);
  if (!model) {
    throw new Error(`eval: could not resolve model "${llama.model}" on ${llama.baseUrl}`);
  }

  const ai = { complete, Type };
  const classifyIntent = createPiClassifyIntent({ ai, apiKey: llama.secret });
  const polish = createPiPolishCopy({ ai, getModel: () => model, apiKey: llama.secret });

  const baseWorkflows = createWorkflowRegistry().listWorkflows();
  const classifier = createIntentClassifier({
    getModel: () => model,
    classifyIntent,
    manifest: WORKFLOW_MANIFEST,
    workflows: baseWorkflows,
    mode: routerMode,
  });
  const registry = createWorkflowRegistry({ classifier });
  const workflowByKind = new Map(baseWorkflows.map((wf) => [wf.kind, wf]));

  return {
    model: llama.model,
    baseUrl: llama.baseUrl,
    // Returns { kind, via, confidence, slots, parsedSlots } where parsedSlots is
    // the result of the matched workflow's parseSlots (null = would be rejected).
    async classify(prompt) {
      const decision = await registry.classify(prompt);
      const wf = decision.kind && decision.kind !== 'none' ? workflowByKind.get(decision.kind) : undefined;
      const parsedSlots = wf ? wf.parseSlots(decision.slots ?? {}, prompt) : null;
      return { ...decision, parsedSlots };
    },
    // Renders the polished copy for a planned outcome with the given summary.
    async polishCopy(summary) {
      return renderCopy({
        outcome: { status: 'planned', planId: 'eval-plan', successSummary: summary },
        mode: 'llm-polish',
        polish,
      });
    },
    // Renders the deterministic template copy (no model call).
    templateCopy(summary) {
      return renderCopy({ outcome: { status: 'planned', planId: 'eval-plan', successSummary: summary }, mode: 'template' });
    },
  };
};
