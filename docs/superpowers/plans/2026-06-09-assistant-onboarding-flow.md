# Assistant Onboarding Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the assistant's blank "What's on the agenda?" first-run screen with a guided, local-first onboarding flow (Welcome → Connect → Access → Approval → Ready) that configures a provider credential and the session defaults, faithfully porting `prototypes/assistant-onboarding.html`.

**Architecture:** A self-contained `agent-onboarding.svelte` orchestrator (step state machine + Welcome + Ready) renders three step components (`-connect`, `-access`, `-approval`). All cross-step state lives in the orchestrator. Pure logic (provider catalog, DTO builders, validation) lives in `agent-onboarding-model.ts` so it is unit-testable without a DOM. The workspace shows the orchestrator in its empty state when the user has zero credentials; on completion it hands back the created credential + persists localStorage defaults, so the normal composer takes over fully configured.

**Tech Stack:** SvelteKit + Svelte 5 runes, `@immich/ui`, Tailwind 4, `@immich/sdk` (generated), `svelte-i18n`, Vitest + `@testing-library/svelte`.

---

## Conventions for this plan (read once)

- **The committed prototype `prototypes/assistant-onboarding.html` is the visual source of truth.** Markup-porting steps reference it by section and give the exact translation rules below; this is intentional and is NOT a placeholder.
- **Color/spacing translation** (prototype inline CSS vars → app classes): the app uses Tailwind theme tokens. Map: card surface → `bg-white dark:bg-immich-dark-gray`, border → `border-gray-300 dark:border-gray-700`, primary text/accent → `text-primary`, primary fill → `bg-primary text-white`, muted text → `text-gray-500 dark:text-neutral-400`, good/green → `text-green-600 dark:text-green-400` / `bg-green-50 dark:bg-green-950`, warn/amber → `text-amber-700 dark:text-amber-300` / `bg-amber-50 dark:bg-amber-950`, radii → `rounded-2xl`/`rounded-xl`/`rounded-lg`, selected card → `border-primary ring-2 ring-primary/30 bg-primary/5`. Reuse the existing empty-chat container classes from `agent-assistant-workspace.svelte` (`mx-auto … max-w-3xl`).
- **Components:** buttons → `@immich/ui` `<Button>`; use plain `<button>` for the selectable cards (provider/preset/approval) with `aria-pressed`. Icons via `Icon` from `@immich/ui` + `@mdi/js`.
- **i18n:** every user-facing string uses `$t('assistant_onboarding_*')`. All new keys are added in Task 8 and listed there. Keys must end up alphabetically sorted — Task 8 runs `pnpm --filter immich-i18n format:fix`.
- **No model discovery exists.** The user types a model id. "Test connection" = create credential → `validateAgentSession` with that model → green check / inline error.
- **Run web tests** from `web/`: `pnpm test -- --run src/routes/(user)/assistant/<file>.spec.ts`.
- **SDK enums (verified):** `ProviderType { Openai='openai', Anthropic='anthropic', OpenaiCompatible='openai-compatible' }`; `AgentPermissionPreset { Careful, VisualOrganizer, LocalPowerUser, Custom }`; `AgentApprovalMode { Strict, AskOnEscalation, PlanOnly, DangerouslySkipPermissions }`.

---

## File Structure

| File                                                                                       | Responsibility                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/routes/(user)/assistant/agent-onboarding-model.ts` (create)                       | Pure logic: provider catalog, defaults, `isConnectComplete`, `buildCredentialCreateDto`, `buildValidateDto`, `isCloudProvider`.    |
| `web/src/routes/(user)/assistant/agent-onboarding-model.spec.ts` (create)                  | Unit tests for the helper.                                                                                                         |
| `web/src/routes/(user)/assistant/agent-onboarding-connect.svelte` (create)                 | Step 1: provider cards (local hero + cloud row + Other), provider-aware fields, Test connection (create→validate→delete-on-retry). |
| `web/src/routes/(user)/assistant/agent-onboarding-connect.spec.ts` (create)                | Connect step behavior + SDK wiring.                                                                                                |
| `web/src/routes/(user)/assistant/agent-onboarding-access.svelte` (create)                  | Step 2: 3 preset cards + visibility meter + chips + cloud-power-user caution.                                                      |
| `web/src/routes/(user)/assistant/agent-onboarding-access.spec.ts` (create)                 | Access step (default VisualOrganizer, caution logic).                                                                              |
| `web/src/routes/(user)/assistant/agent-onboarding-approval.svelte` (create)                | Step 3: PlanOnly + Strict cards.                                                                                                   |
| `web/src/routes/(user)/assistant/agent-onboarding-approval.spec.ts` (create)               | Approval step.                                                                                                                     |
| `web/src/routes/(user)/assistant/agent-onboarding.svelte` (create)                         | Orchestrator: stepper, Welcome, Ready/summary, nav, final `onComplete`.                                                            |
| `web/src/routes/(user)/assistant/agent-onboarding.spec.ts` (create)                        | Full happy-path flow.                                                                                                              |
| `web/src/routes/(user)/assistant/agent-assistant-workspace.svelte` (modify ~lines 848–921) | Render onboarding in empty state when `localCredentials.length === 0`.                                                             |
| `web/src/routes/(user)/assistant/agent-assistant-workspace.spec.ts` (create or extend)     | Integration: onboarding shown when no credentials.                                                                                 |
| `i18n/en.json` (modify)                                                                    | New `assistant_onboarding_*` keys.                                                                                                 |

---

### Task 1: Onboarding logic module (pure, TDD)

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-onboarding-model.ts`
- Test: `web/src/routes/(user)/assistant/agent-onboarding-model.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// agent-onboarding-model.spec.ts
import { AgentApprovalMode, AgentPermissionPreset, ProviderType } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_DEFAULT_APPROVAL,
  ONBOARDING_DEFAULT_PRESET,
  ONBOARDING_PROVIDER_ORDER,
  ONBOARDING_PROVIDERS,
  buildCredentialCreateDto,
  buildValidateDto,
  isCloudProvider,
  isConnectComplete,
} from './agent-onboarding-model';

const base = { provider: 'local' as const, label: '', secret: '', baseUrl: '', model: '' };

describe('agent-onboarding-model', () => {
  it('orders providers local-first, then cloud, then other', () => {
    expect(ONBOARDING_PROVIDER_ORDER).toEqual(['local', 'openai', 'anthropic', 'other']);
  });

  it('defaults to Visual organizer access and Plan-only approval', () => {
    expect(ONBOARDING_DEFAULT_PRESET).toBe(AgentPermissionPreset.VisualOrganizer);
    expect(ONBOARDING_DEFAULT_APPROVAL).toBe(AgentApprovalMode.PlanOnly);
  });

  it('maps local and other to openai-compatible; cloud to their own types', () => {
    expect(ONBOARDING_PROVIDERS.local.providerType).toBe(ProviderType.OpenaiCompatible);
    expect(ONBOARDING_PROVIDERS.other.providerType).toBe(ProviderType.OpenaiCompatible);
    expect(ONBOARDING_PROVIDERS.openai.providerType).toBe(ProviderType.Openai);
    expect(ONBOARDING_PROVIDERS.anthropic.providerType).toBe(ProviderType.Anthropic);
  });

  it('requires a model always, base url for local/other, secret only for cloud', () => {
    expect(isConnectComplete({ ...base, provider: 'local', baseUrl: 'http://x/v1', model: 'm' })).toBe(true);
    expect(isConnectComplete({ ...base, provider: 'local', baseUrl: 'http://x/v1', model: '' })).toBe(false);
    expect(isConnectComplete({ ...base, provider: 'local', baseUrl: '', model: 'm' })).toBe(false);
    expect(isConnectComplete({ ...base, provider: 'openai', secret: 'sk', model: 'm' })).toBe(true);
    expect(isConnectComplete({ ...base, provider: 'openai', secret: '', model: 'm' })).toBe(false);
    expect(isConnectComplete({ ...base, provider: 'other', baseUrl: 'http://x/v1', model: 'm' })).toBe(true);
  });

  it('builds a credential DTO: local key optional uses placeholder, model becomes the single+default model', () => {
    expect(buildCredentialCreateDto({ ...base, provider: 'local', baseUrl: 'http://x/v1 ', model: ' llama ' })).toEqual(
      {
        providerType: ProviderType.OpenaiCompatible,
        label: 'Local model',
        secret: 'local',
        baseUrl: 'http://x/v1',
        models: ['llama'],
        defaultModel: 'llama',
      },
    );
    expect(
      buildCredentialCreateDto({ ...base, provider: 'openai', label: 'Work', secret: ' sk ', model: 'gpt' }),
    ).toEqual({
      providerType: ProviderType.Openai,
      label: 'Work',
      secret: 'sk',
      baseUrl: undefined,
      models: ['gpt'],
      defaultModel: 'gpt',
    });
  });

  it('builds a validate DTO with the onboarding defaults', () => {
    expect(buildValidateDto('cred-1', ' gpt ')).toEqual({
      providerCredentialId: 'cred-1',
      model: 'gpt',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.PlanOnly,
    });
  });

  it('flags cloud providers', () => {
    expect(isCloudProvider('openai')).toBe(true);
    expect(isCloudProvider('anthropic')).toBe(true);
    expect(isCloudProvider('local')).toBe(false);
    expect(isCloudProvider('other')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run "src/routes/(user)/assistant/agent-onboarding-model.spec.ts"`
Expected: FAIL — cannot find module `./agent-onboarding-model`.

- [ ] **Step 3: Write minimal implementation**

```ts
// agent-onboarding-model.ts
import {
  AgentApprovalMode,
  AgentPermissionPreset,
  ProviderType,
  type AgentProviderCredentialCreateDto,
  type AgentSessionCreateDto,
} from '@immich/sdk';

export type OnboardingProviderId = 'local' | 'openai' | 'anthropic' | 'other';

export interface OnboardingProviderMeta {
  id: OnboardingProviderId;
  providerType: ProviderType;
  defaultLabel: string;
  requiresBaseUrl: boolean;
  baseUrlPrefill: string;
  secretRequired: boolean;
}

export const ONBOARDING_PROVIDERS: Record<OnboardingProviderId, OnboardingProviderMeta> = {
  local: {
    id: 'local',
    providerType: ProviderType.OpenaiCompatible,
    defaultLabel: 'Local model',
    requiresBaseUrl: true,
    baseUrlPrefill: 'http://localhost:11434/v1',
    secretRequired: false,
  },
  openai: {
    id: 'openai',
    providerType: ProviderType.Openai,
    defaultLabel: 'OpenAI',
    requiresBaseUrl: false,
    baseUrlPrefill: '',
    secretRequired: true,
  },
  anthropic: {
    id: 'anthropic',
    providerType: ProviderType.Anthropic,
    defaultLabel: 'Anthropic',
    requiresBaseUrl: false,
    baseUrlPrefill: '',
    secretRequired: true,
  },
  other: {
    id: 'other',
    providerType: ProviderType.OpenaiCompatible,
    defaultLabel: 'Custom provider',
    requiresBaseUrl: true,
    baseUrlPrefill: '',
    secretRequired: false,
  },
};

export const ONBOARDING_PROVIDER_ORDER: OnboardingProviderId[] = ['local', 'openai', 'anthropic', 'other'];
export const ONBOARDING_DEFAULT_PRESET = AgentPermissionPreset.VisualOrganizer;
export const ONBOARDING_DEFAULT_APPROVAL = AgentApprovalMode.PlanOnly;
// openai-compatible servers that need no key still require a non-empty secret server-side.
export const ONBOARDING_PLACEHOLDER_SECRET = 'local';

export interface OnboardingConnectState {
  provider: OnboardingProviderId;
  label: string;
  secret: string;
  baseUrl: string;
  model: string;
}

export const isCloudProvider = (provider: OnboardingProviderId): boolean =>
  provider === 'openai' || provider === 'anthropic';

export const isConnectComplete = (state: OnboardingConnectState): boolean => {
  const meta = ONBOARDING_PROVIDERS[state.provider];
  if (!state.model.trim()) {
    return false;
  }
  if (meta.requiresBaseUrl && !state.baseUrl.trim()) {
    return false;
  }
  if (meta.secretRequired && !state.secret.trim()) {
    return false;
  }
  return true;
};

export const buildCredentialCreateDto = (state: OnboardingConnectState): AgentProviderCredentialCreateDto => {
  const meta = ONBOARDING_PROVIDERS[state.provider];
  const model = state.model.trim();
  const secret = state.secret.trim() || (meta.secretRequired ? '' : ONBOARDING_PLACEHOLDER_SECRET);
  return {
    providerType: meta.providerType,
    label: state.label.trim() || meta.defaultLabel,
    secret,
    baseUrl: meta.requiresBaseUrl ? state.baseUrl.trim() : undefined,
    models: [model],
    defaultModel: model,
  };
};

export const buildValidateDto = (providerCredentialId: string, model: string): AgentSessionCreateDto => ({
  providerCredentialId,
  model: model.trim(),
  permissionPreset: ONBOARDING_DEFAULT_PRESET,
  approvalMode: ONBOARDING_DEFAULT_APPROVAL,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run "src/routes/(user)/assistant/agent-onboarding-model.spec.ts"`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add "web/src/routes/(user)/assistant/agent-onboarding-model.ts" "web/src/routes/(user)/assistant/agent-onboarding-model.spec.ts"
git commit -m "feat(assistant): onboarding provider catalog + dto builders"
```

---

### Task 2: Connect step component (provider + key + test)

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-onboarding-connect.svelte`
- Test: `web/src/routes/(user)/assistant/agent-onboarding-connect.spec.ts`

**Behavior contract** (drives both test and impl):

- Props: `{ onConnected: (credentialId: string, model: string) => void }`.
- Local state seeded local-first: `provider='local'`, `baseUrl=ONBOARDING_PROVIDERS.local.baseUrlPrefill`, `label/secret/model=''`, `status: 'idle' | 'testing' | 'connected' | 'error'`, `createdCredentialId: string | null = null`, `errorMessage`.
- Selecting a provider resets `status='idle'`, clears `createdCredentialId` (deleting any prior test credential), and applies that provider's `baseUrlPrefill`.
- Editing any field after `status==='connected'` resets `status='idle'` (must re-test) and calls `onConnected('', '')` to clear the parent's gate. (Test asserts the Continue gate via parent in Task 5; here assert status resets.)
- "Test connection" (enabled only when `isConnectComplete`):
  1. If `createdCredentialId` is set, `deleteAgentProviderCredential({ id: createdCredentialId })` first (retry path), then null it.
  2. `createAgentProviderCredential({ agentProviderCredentialCreateDto: buildCredentialCreateDto(state) })` → store `createdCredentialId`.
  3. `validateAgentSession({ agentSessionCreateDto: buildValidateDto(createdCredentialId, model) })`.
  4. Success → `status='connected'`, `onConnected(createdCredentialId, model.trim())`.
  5. Failure → `status='error'`, show `assistant_onboarding_test_error`; credential left as-is for retry.

- [ ] **Step 1: Write the failing test**

```ts
// agent-onboarding-connect.spec.ts
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { ProviderType, type AgentProviderCredentialResponseDto } from '@immich/sdk';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { readable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentOnboardingConnect from './agent-onboarding-connect.svelte';

vi.mock('svelte-i18n', () => ({ t: readable((key: string) => key) }));

const credential = { id: 'cred-1', providerType: ProviderType.OpenaiCompatible } as AgentProviderCredentialResponseDto;

describe('agent-onboarding-connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMock.createAgentProviderCredential.mockResolvedValue(credential);
    sdkMock.validateAgentSession.mockResolvedValue(undefined as never);
    sdkMock.deleteAgentProviderCredential.mockResolvedValue(undefined as never);
  });

  it('defaults to the local provider with its base url prefilled', () => {
    render(AgentOnboardingConnect, { props: { onConnected: vi.fn() } });
    expect(screen.getByRole('button', { name: /assistant_onboarding_provider_local/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('assistant_onboarding_base_url')).toHaveValue('http://localhost:11434/v1');
  });

  it('creates the credential then validates it, and reports the connected credential id + model', async () => {
    const onConnected = vi.fn();
    const user = userEvent.setup();
    render(AgentOnboardingConnect, { props: { onConnected } });

    await user.type(screen.getByLabelText('assistant_onboarding_model'), 'llama3.1');
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_test' }));

    await waitFor(() => expect(sdkMock.createAgentProviderCredential).toHaveBeenCalledTimes(1));
    expect(sdkMock.createAgentProviderCredential).toHaveBeenCalledWith({
      agentProviderCredentialCreateDto: expect.objectContaining({
        providerType: ProviderType.OpenaiCompatible,
        baseUrl: 'http://localhost:11434/v1',
        models: ['llama3.1'],
        defaultModel: 'llama3.1',
        secret: 'local',
      }),
    });
    expect(sdkMock.validateAgentSession).toHaveBeenCalledWith({
      agentSessionCreateDto: expect.objectContaining({ providerCredentialId: 'cred-1', model: 'llama3.1' }),
    });
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith('cred-1', 'llama3.1'));
    expect(await screen.findByText('assistant_onboarding_connected')).toBeInTheDocument();
  });

  it('shows an error and does not report connected when validation fails', async () => {
    sdkMock.validateAgentSession.mockRejectedValue(new Error('bad key'));
    const onConnected = vi.fn();
    const user = userEvent.setup();
    render(AgentOnboardingConnect, { props: { onConnected } });

    await user.type(screen.getByLabelText('assistant_onboarding_model'), 'gpt');
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_test' }));

    expect(await screen.findByText('assistant_onboarding_test_error')).toBeInTheDocument();
    expect(onConnected).not.toHaveBeenCalledWith(expect.stringMatching(/.+/), expect.anything());
  });

  it('requires a secret for cloud providers before the test button enables', async () => {
    const user = userEvent.setup();
    render(AgentOnboardingConnect, { props: { onConnected: vi.fn() } });
    await user.click(screen.getByRole('button', { name: /assistant_onboarding_provider_openai/ }));
    await user.type(screen.getByLabelText('assistant_onboarding_model'), 'gpt');
    expect(screen.getByRole('button', { name: 'assistant_onboarding_test' })).toBeDisabled();
    await user.type(screen.getByLabelText('assistant_onboarding_api_key'), 'sk-x');
    expect(screen.getByRole('button', { name: 'assistant_onboarding_test' })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run "src/routes/(user)/assistant/agent-onboarding-connect.spec.ts"`
Expected: FAIL — cannot find `./agent-onboarding-connect.svelte`.

- [ ] **Step 3: Write minimal implementation**

Create `agent-onboarding-connect.svelte`. Port the markup from `prototypes/assistant-onboarding.html` `data-screen="connect"` (featured local card + `or use a cloud provider` row with OpenAI/Anthropic + an "Other" card; base-url field for local/other; api-key field with reveal; Test button + status; **replace the prototype's auto-populated model dropdown with a single model `<input>`**) using the color/component mapping in Conventions. Script:

```svelte
<script lang="ts">
  import {
    createAgentProviderCredential,
    deleteAgentProviderCredential,
    validateAgentSession,
  } from '@immich/sdk';
  import { Button, Icon } from '@immich/ui';
  import { mdiArrowRight, mdiCheck, mdiEye, mdiEyeOff } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import {
    ONBOARDING_PROVIDERS,
    ONBOARDING_PROVIDER_ORDER,
    buildCredentialCreateDto,
    buildValidateDto,
    isCloudProvider,
    isConnectComplete,
    type OnboardingConnectState,
    type OnboardingProviderId,
  } from './agent-onboarding-model';

  interface Props {
    onConnected: (credentialId: string, model: string) => void;
  }
  let { onConnected }: Props = $props();

  let provider = $state<OnboardingProviderId>('local');
  let label = $state('');
  let secret = $state('');
  let baseUrl = $state(ONBOARDING_PROVIDERS.local.baseUrlPrefill);
  let model = $state('');
  let revealKey = $state(false);
  let status = $state<'idle' | 'testing' | 'connected' | 'error'>('idle');
  let errorMessage = $state<string | null>(null);
  let createdCredentialId = $state<string | null>(null);

  const meta = $derived(ONBOARDING_PROVIDERS[provider]);
  const connectState = $derived<OnboardingConnectState>({ provider, label, secret, baseUrl, model });
  const canTest = $derived(isConnectComplete(connectState) && status !== 'testing');

  const markDirty = () => {
    if (status === 'connected' || status === 'error') {
      status = 'idle';
      onConnected('', '');
    }
  };

  const selectProvider = (next: OnboardingProviderId) => {
    if (createdCredentialId) {
      void deleteAgentProviderCredential({ id: createdCredentialId }).catch(() => {});
      createdCredentialId = null;
    }
    provider = next;
    baseUrl = ONBOARDING_PROVIDERS[next].baseUrlPrefill;
    secret = '';
    status = 'idle';
    errorMessage = null;
    onConnected('', '');
  };

  const test = async () => {
    if (!canTest) return;
    status = 'testing';
    errorMessage = null;
    try {
      if (createdCredentialId) {
        await deleteAgentProviderCredential({ id: createdCredentialId });
        createdCredentialId = null;
      }
      const created = await createAgentProviderCredential({
        agentProviderCredentialCreateDto: buildCredentialCreateDto(connectState),
      });
      createdCredentialId = created.id;
      await validateAgentSession({ agentSessionCreateDto: buildValidateDto(created.id, model) });
      status = 'connected';
      onConnected(created.id, model.trim());
    } catch {
      status = 'error';
      errorMessage = $t('assistant_onboarding_test_error');
    }
  };
</script>

<!-- markup: port prototypes/assistant-onboarding.html §connect.
     - provider cards loop over ONBOARDING_PROVIDER_ORDER; first ('local') uses the featured layout + "Most private" badge.
       each card: <button aria-pressed={provider===id} onclick={() => selectProvider(id)} aria-label={$t(`assistant_onboarding_provider_${id}`)}>
     - {#if meta.requiresBaseUrl} base-url Field (label $t('assistant_onboarding_base_url')) bind:value={baseUrl} oninput={markDirty}
     - api-key Field (label $t('assistant_onboarding_api_key'); for cloud show "where do I find this?" link; for local/other label append "(optional)")
       <input type={revealKey ? 'text' : 'password'} bind:value={secret} oninput={markDirty}/> + reveal IconButton (mdiEye/mdiEyeOff)
     - model Field (label $t('assistant_onboarding_model')) bind:value={model} oninput={markDirty} placeholder per provider
     - <Button disabled={!canTest} onclick={test}>{$t('assistant_onboarding_test')}</Button>
       {#if status==='testing'} spinner + {$t('assistant_onboarding_testing')}
       {#if status==='connected'} green pill <Icon icon={mdiCheck}/> {$t('assistant_onboarding_connected')}
       {#if status==='error'} <p role="alert">{errorMessage}</p>
-->
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run "src/routes/(user)/assistant/agent-onboarding-connect.spec.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "web/src/routes/(user)/assistant/agent-onboarding-connect.svelte" "web/src/routes/(user)/assistant/agent-onboarding-connect.spec.ts"
git commit -m "feat(assistant): onboarding connect step (provider + test connection)"
```

---

### Task 3: Access step component (permission presets)

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-onboarding-access.svelte`
- Test: `web/src/routes/(user)/assistant/agent-onboarding-access.spec.ts`

**Contract:** Props `{ provider: OnboardingProviderId; preset: AgentPermissionPreset; onChange: (p) => void }`. Renders 3 cards (Careful / Visual organizer [Recommended] / Power user [Local models]) with the visibility meter + chips from the prototype. The selected card has `aria-pressed='true'`. When `preset===LocalPowerUser` **and** `isCloudProvider(provider)`, render the amber caution `assistant_onboarding_access_cloud_caution`; otherwise an info note.

- [ ] **Step 1: Write the failing test**

```ts
// agent-onboarding-access.spec.ts
import { AgentPermissionPreset } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { readable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import AgentOnboardingAccess from './agent-onboarding-access.svelte';

vi.mock('svelte-i18n', () => ({ t: readable((key: string) => key) }));

describe('agent-onboarding-access', () => {
  it('marks the provided preset as selected', () => {
    render(AgentOnboardingAccess, {
      props: { provider: 'local', preset: AgentPermissionPreset.VisualOrganizer, onChange: vi.fn() },
    });
    expect(screen.getByRole('button', { name: /assistant_permission_preset_visual_organizer/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('emits onChange when a preset is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(AgentOnboardingAccess, {
      props: { provider: 'local', preset: AgentPermissionPreset.VisualOrganizer, onChange },
    });
    await user.click(screen.getByRole('button', { name: /assistant_permission_preset_careful/ }));
    expect(onChange).toHaveBeenCalledWith(AgentPermissionPreset.Careful);
  });

  it('warns when Power user is paired with a cloud provider, not a local one', () => {
    const { unmount } = render(AgentOnboardingAccess, {
      props: { provider: 'openai', preset: AgentPermissionPreset.LocalPowerUser, onChange: vi.fn() },
    });
    expect(screen.getByText('assistant_onboarding_access_cloud_caution')).toBeInTheDocument();
    unmount();
    render(AgentOnboardingAccess, {
      props: { provider: 'local', preset: AgentPermissionPreset.LocalPowerUser, onChange: vi.fn() },
    });
    expect(screen.queryByText('assistant_onboarding_access_cloud_caution')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run "src/routes/(user)/assistant/agent-onboarding-access.spec.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `agent-onboarding-access.svelte`. Script holds a constant array describing the 3 cards (value + which meter pips are filled + label/desc i18n keys, reusing existing `assistant_permission_preset_*` keys where possible) and renders buttons. Port the meter + chips markup from prototype §access. Caution logic:

```svelte
<script lang="ts">
  import { AgentPermissionPreset } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import { isCloudProvider, type OnboardingProviderId } from './agent-onboarding-model';

  interface Props {
    provider: OnboardingProviderId;
    preset: AgentPermissionPreset;
    onChange: (preset: AgentPermissionPreset) => void;
  }
  let { provider, preset, onChange }: Props = $props();

  const PRESETS = [
    { value: AgentPermissionPreset.Careful, sees: [true, false, false] },
    { value: AgentPermissionPreset.VisualOrganizer, sees: [true, true, false] },
    { value: AgentPermissionPreset.LocalPowerUser, sees: [true, true, true] },
  ] as const;

  const showCloudCaution = $derived(preset === AgentPermissionPreset.LocalPowerUser && isCloudProvider(provider));
</script>

<!-- markup: port prototypes/assistant-onboarding.html §access (3 .preset cards, .meter pips from `sees`, .cando chips, note box).
     each card: <button aria-pressed={preset===value} onclick={() => onChange(value)} aria-label={$t(labelKeyFor(value))}>
     {#if showCloudCaution} amber notice {$t('assistant_onboarding_access_cloud_caution')} {:else} info note {/if} -->
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run "src/routes/(user)/assistant/agent-onboarding-access.spec.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "web/src/routes/(user)/assistant/agent-onboarding-access.svelte" "web/src/routes/(user)/assistant/agent-onboarding-access.spec.ts"
git commit -m "feat(assistant): onboarding access-level step with cloud caution"
```

---

### Task 4: Approval step component

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-onboarding-approval.svelte`
- Test: `web/src/routes/(user)/assistant/agent-onboarding-approval.spec.ts`

**Contract:** Props `{ approval: AgentApprovalMode; onChange: (a) => void }`. Two cards: `PlanOnly` ("Show me a plan" [Recommended]) and `Strict` ("Ask every step"), with the mini flow diagrams from prototype §approval. Selected card `aria-pressed='true'`.

- [ ] **Step 1: Write the failing test**

```ts
// agent-onboarding-approval.spec.ts
import { AgentApprovalMode } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { readable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import AgentOnboardingApproval from './agent-onboarding-approval.svelte';

vi.mock('svelte-i18n', () => ({ t: readable((key: string) => key) }));

describe('agent-onboarding-approval', () => {
  it('selects the provided approval mode and emits changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(AgentOnboardingApproval, { props: { approval: AgentApprovalMode.PlanOnly, onChange } });
    expect(screen.getByRole('button', { name: /assistant_onboarding_approval_plan/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: /assistant_onboarding_approval_strict/ }));
    expect(onChange).toHaveBeenCalledWith(AgentApprovalMode.Strict);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run "src/routes/(user)/assistant/agent-onboarding-approval.spec.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `agent-onboarding-approval.svelte` with two cards from prototype §approval (values `AgentApprovalMode.PlanOnly`, `AgentApprovalMode.Strict`), `aria-label` = `assistant_onboarding_approval_plan` / `assistant_onboarding_approval_strict`, click → `onChange(value)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run "src/routes/(user)/assistant/agent-onboarding-approval.spec.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "web/src/routes/(user)/assistant/agent-onboarding-approval.svelte" "web/src/routes/(user)/assistant/agent-onboarding-approval.spec.ts"
git commit -m "feat(assistant): onboarding approval-style step"
```

---

### Task 5: Orchestrator (welcome → steps → ready → complete)

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-onboarding.svelte`
- Test: `web/src/routes/(user)/assistant/agent-onboarding.spec.ts`

**Contract:**

- Props: `{ onComplete: (result: { credentialId: string; model: string; permissionPreset: AgentPermissionPreset; approvalMode: AgentApprovalMode }) => void }`.
- State: `step: 0..4` (0 welcome, 1 connect, 2 access, 3 approval, 4 ready); `connectedCredentialId`/`connectedModel` (set by connect `onConnected`; cleared to `''` on dirty); `preset = ONBOARDING_DEFAULT_PRESET`; `approval = ONBOARDING_DEFAULT_APPROVAL`.
- Stepper shows on steps 1–4. Continue on step 1 is disabled until `connectedCredentialId !== ''`. Access/Approval always have a default selected so Continue is enabled.
- Step 4 "Open the assistant" → `onComplete({ credentialId, model, permissionPreset: preset, approvalMode: approval })`.

- [ ] **Step 1: Write the failing test**

```ts
// agent-onboarding.spec.ts
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import {
  AgentApprovalMode,
  AgentPermissionPreset,
  ProviderType,
  type AgentProviderCredentialResponseDto,
} from '@immich/sdk';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { readable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentOnboarding from './agent-onboarding.svelte';

vi.mock('svelte-i18n', () => ({ t: readable((key: string) => key) }));

describe('agent-onboarding orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMock.createAgentProviderCredential.mockResolvedValue({
      id: 'cred-1',
      providerType: ProviderType.OpenaiCompatible,
    } as AgentProviderCredentialResponseDto);
    sdkMock.validateAgentSession.mockResolvedValue(undefined as never);
    sdkMock.deleteAgentProviderCredential.mockResolvedValue(undefined as never);
  });

  it('walks welcome → connect → access → approval → ready and completes with the chosen defaults', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(AgentOnboarding, { props: { onComplete } });

    // welcome
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_get_started' }));
    // connect (local default)
    await user.type(screen.getByLabelText('assistant_onboarding_model'), 'llama3.1');
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_test' }));
    await screen.findByText('assistant_onboarding_connected');
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_continue' }));
    // access defaults to Visual organizer → Continue enabled
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_continue' }));
    // approval defaults to Plan-only → Continue enabled
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_continue' }));
    // ready
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_open' }));

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        credentialId: 'cred-1',
        model: 'llama3.1',
        permissionPreset: AgentPermissionPreset.VisualOrganizer,
        approvalMode: AgentApprovalMode.PlanOnly,
      }),
    );
  });

  it('keeps Continue disabled on the connect step until a successful test', async () => {
    const user = userEvent.setup();
    render(AgentOnboarding, { props: { onComplete: vi.fn() } });
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_get_started' }));
    await user.type(screen.getByLabelText('assistant_onboarding_model'), 'llama3.1');
    expect(screen.getByRole('button', { name: 'assistant_onboarding_continue' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run "src/routes/(user)/assistant/agent-onboarding.spec.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `agent-onboarding.svelte` importing the three step components + helpers. Port the stepper, Welcome, and Ready/summary markup from the prototype. Continue/Back buttons use `@immich/ui` `<Button>`. The connect step's `onConnected` sets `connectedCredentialId`/`connectedModel`. The Ready summary reflects `connectedModel`, `preset`, `approval`. "Open the assistant" calls `onComplete(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run "src/routes/(user)/assistant/agent-onboarding.spec.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "web/src/routes/(user)/assistant/agent-onboarding.svelte" "web/src/routes/(user)/assistant/agent-onboarding.spec.ts"
git commit -m "feat(assistant): onboarding orchestrator (welcome → ready)"
```

---

### Task 6: Wire onboarding into the workspace empty state

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-assistant-workspace.svelte` (empty-state block ~848–921; imports ~21–31)
- Test: `web/src/routes/(user)/assistant/agent-assistant-workspace.spec.ts` (create)

**Contract:** Inside the `{:else}` empty-state, when `isRunnerAvailable && localCredentials.length === 0`, render `<AgentOnboarding onComplete={handleOnboardingComplete} />` instead of the heading + composer. Keep the runner-unavailable banner. `handleOnboardingComplete` refetches credentials, sets `assistantCredentialId/assistantModel/assistantPermissionPreset/assistantApprovalMode`, and persists via `persistAssistantDefaults(...)`. When credentials exist, the existing composer renders unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// agent-assistant-workspace.spec.ts
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import {
  AgentRunnerStatusReason,
  type AgentProviderCredentialResponseDto,
  type AgentRunnerStatusDto,
} from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentAssistantWorkspace from './agent-assistant-workspace.svelte';

vi.mock('svelte-i18n', () => ({ t: readable((key: string) => key) }));

const healthyRunner = {
  configured: true,
  healthy: true,
  reason: AgentRunnerStatusReason.Healthy,
} as AgentRunnerStatusDto;
const baseProps = { runnerStatus: healthyRunner, sessions: [], requestedSessionId: null };

describe('agent-assistant-workspace empty state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows onboarding when there are no credentials', () => {
    render(AgentAssistantWorkspace, { props: { ...baseProps, credentials: [] } });
    expect(screen.getByRole('button', { name: 'assistant_onboarding_get_started' })).toBeInTheDocument();
    expect(screen.queryByText('assistant_new_chat_prompt')).not.toBeInTheDocument();
  });

  it('shows the normal composer when a credential exists', () => {
    const credentials = [
      { id: 'c1', label: 'Local', models: ['m'], defaultModel: 'm' } as AgentProviderCredentialResponseDto,
    ];
    render(AgentAssistantWorkspace, { props: { ...baseProps, credentials } });
    expect(screen.getByText('assistant_new_chat_prompt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'assistant_onboarding_get_started' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run "src/routes/(user)/assistant/agent-assistant-workspace.spec.ts"`
Expected: FAIL — onboarding not wired; `assistant_onboarding_get_started` not found.

- [ ] **Step 3: Write minimal implementation**

Add import `import AgentOnboarding from './agent-onboarding.svelte';`. In the empty-state surface, wrap the heading+composer in `{#if localCredentials.length === 0}<AgentOnboarding onComplete={handleOnboardingComplete} />{:else} …existing… {/if}`. Add:

```svelte
  const handleOnboardingComplete = async (result: {
    credentialId: string;
    model: string;
    permissionPreset: AgentPermissionPreset;
    approvalMode: AgentApprovalMode;
  }) => {
    localCredentials = await getAgentProviderCredentials();
    assistantCredentialId = result.credentialId;
    assistantModel = result.model;
    assistantPermissionPreset = result.permissionPreset;
    assistantApprovalMode = result.approvalMode;
    persistAssistantDefaults({
      credentialId: result.credentialId,
      model: result.model,
      permissionPreset: result.permissionPreset,
      approvalMode: result.approvalMode,
    });
  };
```

Ensure `getAgentProviderCredentials` is imported (add to the existing `@immich/sdk` import).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run "src/routes/(user)/assistant/agent-assistant-workspace.spec.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "web/src/routes/(user)/assistant/agent-assistant-workspace.svelte" "web/src/routes/(user)/assistant/agent-assistant-workspace.spec.ts"
git commit -m "feat(assistant): show onboarding flow in the empty state for first-run users"
```

---

### Task 7: Full markup/visual polish pass (faithful to prototype)

**Files:** the four `agent-onboarding*.svelte` components.

This task completes any markup deferred in Tasks 2–5 so the rendered flow matches `prototypes/assistant-onboarding.html` (stepper segments, featured local card + "Most private" badge, visibility meter pips, approval flow diagrams, Ready summary rows with edit, example prompts, staggered entrance, dark mode). No new behavior — tests from Tasks 2–6 must stay green.

- [ ] **Step 1:** Port remaining visual structure section-by-section from the prototype using the Conventions mapping. Keep all `aria-label`/`aria-pressed`/`getByRole`/`getByLabelText` hooks the tests rely on.
- [ ] **Step 2: Run the full assistant suite**

Run: `cd web && pnpm test -- --run "src/routes/(user)/assistant"`
Expected: PASS (all onboarding specs).

- [ ] **Step 3: Type-check**

Run: `make check-web` (svelte-check + tsc)
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add "web/src/routes/(user)/assistant/agent-onboarding"*.svelte
git commit -m "feat(assistant): polish onboarding visuals to match the approved prototype"
```

---

### Task 8: i18n strings

**Files:** Modify `i18n/en.json`.

- [ ] **Step 1: Add the new keys** (values below). Reuse existing `assistant_permission_preset_*` keys for preset labels/descriptions where the access cards need them; add only onboarding-specific keys:

```
assistant_onboarding_get_started: "Get started"
assistant_onboarding_continue: "Continue"
assistant_onboarding_back: "Back"
assistant_onboarding_open: "Open the assistant"
assistant_onboarding_welcome_title: "Meet your photo assistant"
assistant_onboarding_welcome_subtitle: "A helper that can organize albums, find photos, clean up duplicates, and more — using an AI model you choose. Let's connect one and set the ground rules."
assistant_onboarding_connect_title: "Choose where the thinking happens"
assistant_onboarding_connect_subtitle: "A model on your own hardware keeps every photo private — the best fit for a self-hosted gallery. Prefer the cloud? OpenAI and Anthropic work too."
assistant_onboarding_provider_local: "Local model"
assistant_onboarding_provider_local_meta: "Runs on your own machine — nothing ever leaves your server."
assistant_onboarding_provider_most_private: "Most private"
assistant_onboarding_provider_openai: "OpenAI"
assistant_onboarding_provider_anthropic: "Anthropic"
assistant_onboarding_provider_other: "Other provider"
assistant_onboarding_provider_other_meta: "Any OpenAI-compatible endpoint (OpenRouter, Together, a proxy…)."
assistant_onboarding_cloud_divider: "or use a cloud provider"
assistant_onboarding_base_url: "Server address"
assistant_onboarding_api_key: "API key"
assistant_onboarding_api_key_optional: "API key (optional)"
assistant_onboarding_api_key_help: "Where do I find this?"
assistant_onboarding_model: "Model"
assistant_onboarding_test: "Test connection"
assistant_onboarding_testing: "Checking the connection…"
assistant_onboarding_connected: "Connected"
assistant_onboarding_test_error: "Couldn't reach the model. Check the address, key, and model name, then try again."
assistant_onboarding_access_title: "How much can it see and do?"
assistant_onboarding_access_subtitle: "Each level decides what the assistant can look at and which actions it's allowed to take. You can change this anytime."
assistant_onboarding_access_cloud_caution: "Heads up — you picked a cloud provider. This level can send original-resolution files to it. We recommend it only with a local model."
assistant_onboarding_approval_title: "When should it check with you?"
assistant_onboarding_approval_subtitle: "The assistant never changes anything on its own. Choose how it checks in before acting."
assistant_onboarding_approval_plan: "Show me a plan"
assistant_onboarding_approval_plan_desc: "It explores freely, then proposes a full plan. You approve it once, and watch it run."
assistant_onboarding_approval_strict: "Ask every step"
assistant_onboarding_approval_strict_desc: "It pauses for your okay before each action. Most control, a little slower."
assistant_onboarding_ready_title: "You're all set"
assistant_onboarding_ready_subtitle: "Here's your setup. Tap any row to change it."
assistant_onboarding_recommended: "Recommended"
```

- [ ] **Step 2: Sort + format (CI gate)**

Run: `pnpm --filter immich-i18n format:fix`
Expected: keys reordered alphabetically; no other i18n file changes.

- [ ] **Step 3: Commit**

```bash
git add i18n/en.json
git commit -m "i18n(assistant): onboarding flow strings"
```

---

### Task 9: Final verification

- [ ] **Step 1: Full assistant web tests**

Run: `cd web && pnpm test -- --run "src/routes/(user)/assistant"`
Expected: all PASS.

- [ ] **Step 2: Type-check + lint**

Run: `make check-web` then `make lint-web`
Expected: 0 errors, 0 warnings (fix any floating-promise/`void` issues on async handlers).

- [ ] **Step 3: Manual smoke (optional but recommended)**

`make dev`, open the assistant with no credentials, walk the flow against a local model; confirm the credential is created, defaults persist, and the composer takes over.

- [ ] **Step 4: Commit any fixes**

```bash
git commit -am "chore(assistant): onboarding verification fixes"
```

---

## Self-Review

**Spec coverage** (prototype → tasks): Welcome → Task 5; Connect (local-first, providers incl. Other, key, test) → Tasks 1–2; Access (presets + meter + cloud caution, default VisualOrganizer) → Tasks 1,3; Approval (plan/strict, default PlanOnly) → Tasks 1,4; Ready/summary → Task 5; empty-state integration → Task 6; visuals → Task 7; copy → Task 8. User's three changes: VisualOrganizer default (Task 1 `ONBOARDING_DEFAULT_PRESET` + Task 3 test), local preselected (Task 2 test "defaults to the local provider"), "Other" provider (Task 1 catalog + Task 2 markup). ✅

**Placeholder scan:** Logic + tests are complete code. Markup steps explicitly defer to the committed prototype with a translation table + listed i18n keys + preserved test hooks — intentional, per Conventions, not vague TODOs.

**Type consistency:** `OnboardingConnectState`, `OnboardingProviderId`, `buildCredentialCreateDto`/`buildValidateDto`, `ONBOARDING_DEFAULT_PRESET/APPROVAL`, and the `onComplete` result shape `{ credentialId, model, permissionPreset, approvalMode }` are used identically across Tasks 1, 2, 5, 6. The connect `onConnected(credentialId, model)` signature matches its consumer in Task 5. SDK calls (`createAgentProviderCredential`, `deleteAgentProviderCredential`, `validateAgentSession`, `getAgentProviderCredentials`) match the verified signatures. ✅
