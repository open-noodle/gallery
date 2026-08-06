// Eval harness config. All endpoints/knobs are env-overridable so the same
// scenarios can run against any local OpenAI-compatible server.
//
//   EVAL_LLAMA_URL    OpenAI-compatible base URL (default local llama.cpp)
//   EVAL_LLAMA_MODEL  model id the server reports at /v1/models
//   EVAL_LLAMA_KEY    api key (any string for llama.cpp)
//   EVAL_ROUTER_MODE  regex | llm | hybrid (default hybrid)
//   EVAL_RUNS         repeats per LLM scenario for pass-rate (default 3)
//
// L3 (live Gallery /agent/* API, read-only) — only used with `--layer L3`:
//   GALLERY_URL          Gallery API base (default local dev stack)
//   GALLERY_API_KEY      x-api-key auth (preferred for headless runs)
//   GALLERY_TOKEN        bearer access token (alternative to api key)
//   GALLERY_EMAIL/PASSWORD  login to mint a bearer token (alternative)
//   GALLERY_CREDENTIAL_ID   reuse an existing agent provider credential
//   GALLERY_MODEL_URL    else: server-reachable model URL to create a credential for
//   GALLERY_MODEL        override the model id used for the session
//   GALLERY_PRESET       permission preset (default visual-organizer)
//   EVAL_L3_RUNS         repeats per L3 scenario (default 1 — round-trips are slow)
export default {
  llama: {
    baseUrl: process.env.EVAL_LLAMA_URL ?? 'http://127.0.0.1:8080/v1',
    model: process.env.EVAL_LLAMA_MODEL ?? 'Qwen3-Coder-Next-Q8_0-00001-of-00004.gguf',
    secret: process.env.EVAL_LLAMA_KEY ?? 'local',
  },
  routerMode: process.env.EVAL_ROUTER_MODE ?? 'hybrid',
  runs: Number(process.env.EVAL_RUNS ?? 3),

  gallery: {
    baseUrl: process.env.GALLERY_URL ?? 'http://localhost:2283/api',
    apiKey: process.env.GALLERY_API_KEY,
    token: process.env.GALLERY_TOKEN,
    email: process.env.GALLERY_EMAIL,
    password: process.env.GALLERY_PASSWORD,
    credentialId: process.env.GALLERY_CREDENTIAL_ID,
    modelUrl: process.env.GALLERY_MODEL_URL,
    modelSecret: process.env.GALLERY_MODEL_SECRET ?? 'local',
    model: process.env.GALLERY_MODEL,
    permissionPreset: process.env.GALLERY_PRESET ?? 'visual-organizer',
  },
  l3: {
    runs: Number(process.env.EVAL_L3_RUNS ?? 1),
    settleTimeoutMs: Number(process.env.EVAL_L3_TIMEOUT_MS ?? 90_000),
    pollIntervalMs: Number(process.env.EVAL_L3_POLL_MS ?? 600),
    // Grace window to let the runner's strict activity events land after the
    // session settles (a fast regex route can settle before its event flushes).
    settleGraceMs: Number(process.env.EVAL_L3_GRACE_MS ?? 4000),
    keepSessions: process.env.EVAL_L3_KEEP_SESSIONS === '1',
    // Set on the local seeded dev stack (known members + a seeded non-owner) so
    // membership/role L3 scenarios assert plan-proposed. Off against personal
    // (unknowable member set / single user) → those assert routing-only.
    seeded: process.env.EVAL_L3_SEEDED === '1',
  },
};
