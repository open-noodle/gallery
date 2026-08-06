# Image Adjustments — Slice 6: Integrated verify + L3 + finalize

> Final slice: L1 confirmation, integrated cross-package verification, the live propose-only L3 runbook, and capability-matrix finalize.

Spec: `docs/superpowers/specs/2026-06-06-pi-agent-image-adjustments-design.md` (Slice 6).

## Integrated verify — DONE (all green)

| Gate                                                              | Result                                                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Full server suite (`pnpm -C server test`)                         | **6541 passed**, 9 skipped, 0 failed                                                                                   |
| `make check-server` (tsc)                                         | clean                                                                                                                  |
| `make lint-server` (eslint, max-warnings 0)                       | clean (fixed `unicorn/consistent-function-scoping` on 3 dto-spec helpers + `no-array-callback-reference` on `editKey`) |
| `make check-web`                                                  | clean                                                                                                                  |
| Full runner suite (`node --test 'src/**/*.test.mjs'`)             | **1574 passed**, 0 failed                                                                                              |
| OpenAPI clean (`git status open-api/ mobile/openapi/`)            | empty — no drift                                                                                                       |
| Capability matrix consistency (`agent-capability-matrix.spec.ts`) | passes (aligned manifest `Adjust assets (tonal)` ↔ Flow-Ownership row; updated Needs-New-Tool intro test phrase)       |

**L1 (component, in-suite):** `adjust_assets` 26/26, `flip_assets` 22/22; classification-recall / negatives / slot-fidelity scenarios for adjust + flip; disambiguation guard exercises both kinds. Routing + slots verified offline at 100%.

## Capability matrix — finalize (DONE in Slice 5 + reconciled here)

- Flow-Ownership rows: `Adjust assets (tonal)`, `Flip assets (mirror H/V)`.
- Core-Capability rows: "Adjust photo look", "Flip images (mirror H/V)".
- Generated workflow block + `manifest.generated.json` list both (positions 20–21).
- Needs New MCP Tool: "Edits beyond rotation" moved to shipped; remaining candidates = **image straightening** + export/download.

## Live L3 — propose-only (GATED on user go-ahead; hits the laptop gemma4 + builds an RC)

This is the only remaining step and is **not run unattended** because it builds an RC image and drives the laptop-hosted gemma4 model. Runbook (per `reference_pi_agent_clone_l3_setup`):

1. **Build the branch RC:**
   ```bash
   BRANCH=explore/pi-agent-brainstorm
   RC_TAG="$(echo "$BRANCH" | tr '[:upper:]/' '[:lower:]-')-rc1"   # → explore-pi-agent-brainstorm-rc1
   gh --repo open-noodle/gallery workflow run gallery-rc-build.yml --ref "$BRANCH" -f rc_tag="$RC_TAG"
   ```
2. **Clone + hand-wire agent-runner + gemma4 egress** (clone template has no agent feature):
   ```bash
   export KUBECONFIG=~/.kube/noodle-k3s.yaml
   cd ~/dev/platform && scripts/clone-personal.sh "$BRANCH"
   # then recover gallery-agent-secret + gallery-agent-runner Deployment/Service from `git show d4cfa21 -- apps/personal/server.yaml`,
   # patch server IMMICH_AGENT_RUNNER_URL/MCP_GATEWAY_URL/secret, + pierre-laptop-llama egress.
   ```
3. **Run the propose-only L3** (preset = VisualOrganizer, which grants `editAssets`, so adjust/flip route + propose live):
   ```bash
   GALLERY_URL=http://pierre-gallery-test-<slug>.taild637f7.ts.net/api GALLERY_API_KEY=… \
     GALLERY_MODEL=gemma-4-31B-it-Q8_0.gguf pnpm -C agent-runner eval:l3
   ```
   Expected scenarios: "brighten my last 10 photos" → `adjust_assets`/`asset.adjust`; "make these more vivid" → saturation; "auto-enhance my newest 5" → autoEnhance; "flip this horizontally" → `flip_assets`/`asset.flip`. Read-only audit must show **no `asset_edit` rows written** (propose-only). Negatives ("rotate these", "how many photos") stay correct. These are verb-driven, so unlike crop's OQ-F1 they are expected to route live; **document any verb that proves unreliable** rather than forcing a brittle assertion.
4. **Tear down:** `scripts/clone-personal.sh --down <slug>`; confirm gemma4 idle.

## Known follow-ups (documented, not blockers)

- **S3 preview read:** `AssetService.previewAssetEdits` reads the base image via `storageRepository.readFile` (local fs). On deployments whose thumbnails live on S3, the preview endpoint would need the same backend access `serveFromBackend` uses. The L3 eval is propose-only and never calls the preview endpoint, so this is a web-UX follow-up, not an L3 blocker. Verify manually on the clone before relying on the plan-card preview there.
- **Straighten** (arbitrary-angle rotate) remains the open image-edit geometry follow-up.
