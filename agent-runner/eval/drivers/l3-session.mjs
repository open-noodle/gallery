// L3 driver: drives the REAL Gallery server `/api/agent/*` HTTP API end-to-end
// against a running stack (Gallery server + DB + agent-runner + model), then
// reads routing + plan outcome straight from the read-only activity-event and
// operation-plan endpoints. No log scraping: Slice 6's strict observability
// (`strict_router_decision` / `strict_workflow_outcome`) rides the `activity`
// event channel, so the persisted events carry the router's decision for free.
//
// READ-ONLY BY CONSTRUCTION. Every session is created with
// `approvalMode: 'plan-only'`, so the agent only ever *proposes* operation
// plans — it never applies them. The driver has no `/apply` call at all, and it
// asserts (best-effort) that no plan ever reaches `applied`. The only thing it
// writes is its own disposable agent sessions (the agent's own scratch space,
// not your library), which it deletes on cleanup unless `--keep-sessions`.
//
// Scenarios are scored through the same score.mjs machinery as L1: `classify()`
// returns a decision in the L1 shape, plus `planProposed` / `outcomeStatus`.
// Because L3 activity summaries are scrubbed (no slot values — by design), L3
// asserts routing `kind` + plan-proposed/none, never exact slots.

// Read-only guarantee: the agent only proposes, never applies. Do not make this
// configurable — a stray env var must not be able to turn the live eval into a
// mutation.
const APPROVAL_MODE = 'plan-only';

// Terminal-ish session states: once here, the turn has settled and the router
// decision (and any plan) is final.
const SETTLED = new Set(['waiting_for_plan_review', 'completed', 'cancelled', 'interrupted', 'failed']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Parse a scrubbed `key=value key=value` strict-observability summary into an
// object. Mirrors strictObserveSummary() in pi-runtime.mjs.
const parseKv = (summary) => {
  const out = {};
  for (const part of String(summary ?? '').trim().split(/\s+/)) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
};

export const createL3Driver = ({ gallery, l3 }) => {
  const baseUrl = gallery.baseUrl.replace(/\/$/, '');
  const createdSessionIds = new Set();
  // Sessions in which the runner emitted a success-gate block (it claimed a
  // planned outcome with no persisted plan id — the original bug class). This
  // must stay empty; surfaced by auditGateBlocks().
  const gateBlockSessions = new Set();
  let authHeader = null;
  let resolved = null; // { credentialId, model }
  let albumNameCache; // undefined=unresolved, string=name, null=no album found
  let spaceNameCache; // {space} discovery cache
  let userNameCache; // {user} discovery cache

  const api = async (method, path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(authHeader ?? {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const detail = typeof parsed === 'string' ? parsed : (parsed?.message ?? JSON.stringify(parsed));
      throw new Error(`${method} ${path} -> HTTP ${res.status}: ${String(detail).slice(0, 300)}`);
    }
    return parsed;
  };

  // --- auth -----------------------------------------------------------------
  const authenticate = async () => {
    if (gallery.apiKey) {
      authHeader = { 'x-api-key': gallery.apiKey };
      return;
    }
    if (gallery.token) {
      authHeader = { Authorization: `Bearer ${gallery.token}` };
      return;
    }
    if (gallery.email && gallery.password) {
      const res = await api('POST', '/auth/login', { email: gallery.email, password: gallery.password });
      authHeader = { Authorization: `Bearer ${res.accessToken}` };
      return;
    }
    throw new Error(
      'No Gallery auth configured. Set GALLERY_API_KEY, or GALLERY_TOKEN, or GALLERY_EMAIL + GALLERY_PASSWORD.',
    );
  };

  // --- credential + model resolution ---------------------------------------
  // Priority: an explicit credential id -> a server-reachable model URL we
  // create a credential for -> the first existing openai-compatible credential.
  // The personal-instance path is "reuse the credential already configured in
  // the UI"; the local-stack path is "create one pointing at the model URL".
  const resolveCredential = async () => {
    const pickModel = (cred) =>
      gallery.model ?? cred.defaultModel ?? (cred.models?.length ? cred.models[0] : undefined);

    if (gallery.credentialId) {
      const cred = await api('GET', `/agent/provider-credentials/${gallery.credentialId}`);
      const model = pickModel(cred);
      if (!model) throw new Error(`Credential ${cred.id} lists no model; set GALLERY_MODEL.`);
      return { credentialId: cred.id, model };
    }

    const existing = await api('GET', '/agent/provider-credentials');

    if (gallery.modelUrl) {
      const match = existing.find(
        (c) => c.providerType === 'openai-compatible' && c.baseUrl?.replace(/\/$/, '') === gallery.modelUrl.replace(/\/$/, ''),
      );
      if (match) return { credentialId: match.id, model: pickModel(match) ?? gallery.model };
      const created = await api('POST', '/agent/provider-credentials', {
        providerType: 'openai-compatible',
        label: 'eval-l3-local-model',
        secret: gallery.modelSecret ?? 'local',
        baseUrl: gallery.modelUrl,
        models: gallery.model ? [gallery.model] : undefined,
        defaultModel: gallery.model,
      });
      const model = pickModel(created);
      if (!model) throw new Error('Created credential has no model; set GALLERY_MODEL.');
      return { credentialId: created.id, model };
    }

    const openai = existing.find((c) => c.providerType === 'openai-compatible') ?? existing[0];
    if (!openai) {
      throw new Error(
        'No agent provider credential available. Set GALLERY_CREDENTIAL_ID or GALLERY_MODEL_URL, or create one in the Gallery UI.',
      );
    }
    const model = pickModel(openai);
    if (!model) throw new Error(`Credential ${openai.id} lists no model; set GALLERY_MODEL.`);
    return { credentialId: openai.id, model };
  };

  const sessionCreateBody = () => ({
    providerCredentialId: resolved.credentialId,
    model: resolved.model,
    permissionPreset: gallery.permissionPreset,
    approvalMode: APPROVAL_MODE,
    initialContext: { entrypoint: 'eval-l3' },
  });

  // Preflight: auth, resolve the credential/model, and validate the full
  // credential+model+runner chain WITHOUT persisting a session. Throws with a
  // readable message if any link is down — same fail-fast philosophy as L1's
  // connectivity check.
  const preflight = async () => {
    await authenticate();
    resolved = await resolveCredential();
    await api('POST', '/agent/sessions/validate', sessionCreateBody());
    return { ...resolved, baseUrl, approvalMode: APPROVAL_MODE, permissionPreset: gallery.permissionPreset };
  };

  const settleTimeoutMs = l3.settleTimeoutMs;
  const pollIntervalMs = l3.pollIntervalMs;
  const settleGraceMs = l3.settleGraceMs ?? 4000;

  // Read-only album discovery for `{album}` prompt tokens. Picks the most
  // populated album the user has (most likely to yield a clean add/rename plan).
  // Cached; falls back to leaving the token if there are no albums.
  const resolveAlbumName = async () => {
    if (albumNameCache !== undefined) return albumNameCache;
    try {
      const albums = await api('GET', '/albums');
      const ranked = [...(albums ?? [])].sort((a, b) => (b.assetCount ?? 0) - (a.assetCount ?? 0));
      albumNameCache = ranked[0]?.albumName ?? null;
    } catch {
      albumNameCache = null;
    }
    return albumNameCache;
  };
  const substituteAlbum = async (prompt) => {
    if (!prompt.includes('{album}')) return prompt;
    const name = await resolveAlbumName();
    return name ? prompt.replaceAll('{album}', name) : prompt;
  };

  // Read-only `{space}` discovery: pick the most-populated shared space (most
  // likely to yield a clean describe/membership plan). Cached.
  const resolveSpaceName = async () => {
    if (spaceNameCache !== undefined) return spaceNameCache;
    try {
      const spaces = await api('GET', '/shared-spaces');
      const ranked = [...(spaces ?? [])].sort(
        (a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0) || (b.assetCount ?? 0) - (a.assetCount ?? 0),
      );
      spaceNameCache = ranked[0]?.name ?? null;
    } catch {
      spaceNameCache = null;
    }
    return spaceNameCache;
  };

  // Read-only `{user}` discovery: pick a user by name. On the local seeded stack
  // env-prep ensures a non-owner exists; on personal this is the owner (fine for
  // routing-only membership/role scenarios). Cached.
  const resolveUserName = async () => {
    if (userNameCache !== undefined) return userNameCache;
    try {
      const users = await api('GET', '/users');
      userNameCache = (users ?? []).map((u) => u?.name).find((name) => typeof name === 'string' && name.trim()) ?? null;
    } catch {
      userNameCache = null;
    }
    return userNameCache;
  };

  // Apply every read-only discovery token in turn; each leaves its token if the
  // instance has no matching data (a missing-data signal, not a routing miss).
  const substituteTokens = async (prompt) => {
    let next = await substituteAlbum(prompt);
    if (next.includes('{space}')) {
      const name = await resolveSpaceName();
      if (name) next = next.replaceAll('{space}', name);
    }
    if (next.includes('{user}')) {
      const name = await resolveUserName();
      if (name) next = next.replaceAll('{user}', name);
    }
    return next;
  };

  // Scan the (accumulating) activity-event list for a session, returning the
  // latest router decision + workflow outcome and the running outcome count.
  // Also records any success-gate block for the read-only safety audit.
  const scanEvents = (events, sessionId) => {
    let routerKv = null;
    let outcomeKv = null;
    let outcomeCount = 0;
    for (const e of events) {
      if (e.kind === 'strict_router_decision') routerKv = parseKv(e.summary);
      if (e.kind === 'strict_workflow_outcome') {
        outcomeKv = parseKv(e.summary);
        outcomeCount++;
      }
      if (e.kind === 'strict_success_gate_block') gateBlockSessions.add(sessionId);
    }
    return { routerKv, outcomeKv, outcomeCount };
  };

  // Send one user turn and poll until it settles. `baseOutcomeCount` is the
  // number of workflow-outcome events seen before this turn — a turn is done
  // when a NEW outcome lands (matched workflow ran), or the decision is a
  // negative (no outcome will come), or the session settles (+ grace, so a fast
  // regex route's runner events have time to flush, and a non-emitting instance
  // doesn't hang for the full timeout).
  // Post a user message, retrying through the brief window where the prior
  // turn's dispatch is still finalizing (server rejects with "message in
  // progress"). A genuinely non-appendable session exhausts the retries and
  // surfaces the error.
  const postMessage = async (sessionId, text) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await api('POST', `/agent/sessions/${sessionId}/messages`, {
          content: { blocks: [{ type: 'text', text }] },
        });
      } catch (error) {
        const transient = /message in progress|does not accept new messages/i.test(String(error?.message ?? ''));
        if (!transient || attempt >= 20) throw error;
        await sleep(pollIntervalMs);
      }
    }
  };

  const runTurn = async (sessionId, prompt, baseOutcomeCount) => {
    await postMessage(sessionId, await substituteTokens(prompt));

    const deadline = Date.now() + settleTimeoutMs;
    let routerKv = null;
    let outcomeKv = null;
    let outcomeCount = baseOutcomeCount;
    let status = 'running';
    let settledSince = null;

    while (Date.now() < deadline) {
      const events = await api('GET', `/agent/sessions/${sessionId}/activity-events`);
      const scan = scanEvents(events, sessionId);
      routerKv = scan.routerKv ?? routerKv;
      outcomeKv = scan.outcomeKv ?? outcomeKv;
      outcomeCount = scan.outcomeCount;
      status = (await api('GET', `/agent/sessions/${sessionId}`)).status;

      const matched = routerKv?.matched === 'true';
      if (routerKv && !matched) break; // negative: no workflow outcome is coming
      if (outcomeCount > baseOutcomeCount) break; // this turn's workflow finished
      if (SETTLED.has(status)) {
        settledSince ??= Date.now();
        if (Date.now() - settledSince > settleGraceMs) break;
      }
      await sleep(pollIntervalMs);
    }
    return { routerKv, outcomeKv, outcomeCount, status };
  };

  const buildDecision = ({ routerKv, outcomeKv, outcomeCount, outcomeDeltas, plan, sessionId, status }) => {
    const matched = routerKv?.matched === 'true';
    const deltas = Array.isArray(outcomeDeltas) ? outcomeDeltas : [];
    return {
      kind: matched ? (routerKv.workflow ?? 'none') : 'none',
      via: routerKv?.via ?? null,
      confidence: routerKv?.confidence ?? null,
      // L3 summaries are scrubbed of slot values, so slot survival is not
      // observable here. `undefined` tells score.mjs not to track it (vs `null`,
      // which would read as "slots were rejected").
      parsedSlots: undefined,
      slots: undefined,
      planProposed: Boolean(plan && plan.status === 'proposed' && (plan.operations?.length ?? 0) > 0),
      outcomeStatus: outcomeKv?.status ?? null,
      outcomeCount: Number(outcomeCount ?? 0),
      turnsWithOutcome: deltas.filter((delta) => Number(delta) > 0).length,
      planStatus: plan?.status ?? null,
      sessionId,
      timedOut: !routerKv && !SETTLED.has(status),
    };
  };

  const createSession = async () => {
    const session = await api('POST', '/agent/sessions', sessionCreateBody());
    createdSessionIds.add(session.id);
    return session;
  };

  // Run one prompt through a fresh, isolated session and return the routing +
  // plan signal. Fresh-session-per-prompt avoids cross-prompt continuation
  // state leaking between independent scenarios.
  const classify = async (prompt) => {
    const session = await createSession();
    const turn = await runTurn(session.id, prompt, 0);
    const plan = await api('GET', `/agent/sessions/${session.id}/operation-plan`).catch(() => null);
    return buildDecision({ ...turn, plan, sessionId: session.id });
  };

  // Multi-turn: send each prompt in ONE session in sequence (e.g. ask_user ->
  // follow-up selection -> plan). Routing comes from the first turn's decision;
  // the final plan reflects where the conversation landed.
  const converse = async (prompts) => {
    const session = await createSession();
    let routerKv = null;
    let outcomeKv = null;
    let outcomeCount = 0;
    const outcomeDeltas = [];
    let status;
    for (const prompt of prompts) {
      const turn = await runTurn(session.id, prompt, outcomeCount);
      outcomeDeltas.push(turn.outcomeCount - outcomeCount);
      routerKv = turn.routerKv ?? routerKv; // continuations emit no router decision; keep turn 1's
      outcomeKv = turn.outcomeKv ?? outcomeKv;
      outcomeCount = turn.outcomeCount;
      status = turn.status;
    }
    const plan = await api('GET', `/agent/sessions/${session.id}/operation-plan`).catch(() => null);
    return buildDecision({ routerKv, outcomeKv, outcomeCount, outcomeDeltas, plan, sessionId: session.id, status });
  };

  // Best-effort read-only safety audit: confirm the agent never applied a plan
  // in any session we created. Returns the list of offenders (should be empty).
  const auditNoApply = async () => {
    const offenders = [];
    for (const id of createdSessionIds) {
      const applied = await api('GET', `/agent/sessions/${id}/operation-plan/applied`).catch(() => []);
      if (Array.isArray(applied) && applied.length > 0) offenders.push(id);
    }
    return offenders;
  };

  // Read-only safety audit: the success gate must never have fired (a planned
  // outcome with no persisted plan id). Returns offending session ids (empty=ok).
  const auditGateBlocks = () => [...gateBlockSessions];

  const cleanup = async () => {
    if (l3.keepSessions) return { deleted: 0, kept: createdSessionIds.size };
    let deleted = 0;
    for (const id of createdSessionIds) {
      try {
        await api('DELETE', `/agent/sessions/${id}`);
        deleted++;
      } catch {
        // Best-effort: a session we could not delete is harmless (it touches no
        // library data) and remains inspectable in the UI.
      }
    }
    return { deleted, kept: createdSessionIds.size - deleted };
  };

  return {
    get model() {
      return resolved?.model ?? gallery.model ?? '(unresolved)';
    },
    baseUrl,
    preflight,
    classify,
    converse,
    auditNoApply,
    auditGateBlocks,
    cleanup,
    // Copy fidelity is an L1/judge concern; L3 read-only does not score copy.
    polishCopy: undefined,
  };
};
