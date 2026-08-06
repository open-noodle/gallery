# Activity Timeline — Slice 1: Close lifecycle events on settle and cancel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lifecycle activity events (`start-processing`, `plan-composing`, `apply-progress`, `runner-recovery`) can never be left `running` forever: a successful turn closes them with `completed`, cancel closes them with `skipped` (the existing failure path already writes `failed`).

**Architecture:** Activity events are append-only — "closing" inserts a terminal sibling of the same kind. A new `closeOpenLifecycleEvents(userId, sessionId, terminalStatus)` on `AgentSessionActivityEventService` computes latest-status-per-lifecycle-kind and inserts closers (+ websocket `activity` emit). It deliberately bypasses `create()`'s terminal-session guard because cancel flips the session status _before_ closing. Called from `AgentRunnerService` on successful stream settle and from `AgentSessionService.cancel()`.

**Tech Stack:** NestJS server, Kysely, Vitest. Spec: `docs/superpowers/specs/2026-06-10-assistant-activity-timeline-design.md` (Server changes A; edge case E9).

**Conventions:** run tests from `server/`: `export PATH="$HOME/.local/share/mise/shims:$PATH" && pnpm test -- --run src/services/<file>.spec.ts`. Specs use `automock` from `test/utils` and hand-rolled mock literals (see `agent-runner.service.spec.ts:126-160`).

---

### Task 1: `closeOpenLifecycleEvents` on the activity-event service

**Files:**

- Modify: `server/src/services/agent-session-activity-event.service.ts`
- Test: `server/src/services/agent-session-activity-event.service.spec.ts`

- [ ] **Step 1: Write the failing tests** — add to the existing spec (reuse its `makeSession`/`makeEvent` factories and mock setup; `repository`, `sessionRepository`, `websocketRepository` are automocks):

```ts
describe('closeOpenLifecycleEvents', () => {
  it('inserts a terminal sibling for each lifecycle kind whose latest event is running', async () => {
    const session = makeSession();
    sessionRepository.getById.mockResolvedValue(session);
    repository.getBySessionId.mockResolvedValue([
      makeEvent({
        sessionId: session.id,
        kind: AgentSessionActivityEventKind.StartProcessing,
        status: AgentSessionActivityEventStatus.Running,
      }),
      makeEvent({
        sessionId: session.id,
        kind: AgentSessionActivityEventKind.PlanComposing,
        status: AgentSessionActivityEventStatus.Running,
      }),
    ]);
    const closer = makeEvent({ sessionId: session.id, status: AgentSessionActivityEventStatus.Completed });
    repository.create.mockResolvedValue(closer);

    const result = await sut.closeOpenLifecycleEvents(
      session.userId,
      session.id,
      AgentSessionActivityEventStatus.Completed,
    );

    expect(repository.create).toHaveBeenCalledTimes(2);
    expect(repository.create).toHaveBeenCalledWith({
      sessionId: session.id,
      kind: AgentSessionActivityEventKind.StartProcessing,
      status: AgentSessionActivityEventStatus.Completed,
      source: AgentSessionActivityEventSource.Server,
      summary: null,
      counts: null,
    });
    expect(websocketRepository.clientSend).toHaveBeenCalledWith(
      'on_agent_session_event',
      session.userId,
      expect.objectContaining({ type: 'activity', sessionId: session.id, event: closer }),
    );
    expect(result).toHaveLength(2);
  });

  it('is idempotent: inserts nothing when the latest lifecycle event is already terminal', async () => {
    const session = makeSession();
    sessionRepository.getById.mockResolvedValue(session);
    repository.getBySessionId.mockResolvedValue([
      makeEvent({
        kind: AgentSessionActivityEventKind.StartProcessing,
        status: AgentSessionActivityEventStatus.Running,
      }),
      makeEvent({
        kind: AgentSessionActivityEventKind.StartProcessing,
        status: AgentSessionActivityEventStatus.Completed,
      }),
    ]);

    await sut.closeOpenLifecycleEvents(session.userId, session.id, AgentSessionActivityEventStatus.Completed);

    expect(repository.create).not.toHaveBeenCalled();
  });

  it('never closes strict observability events', async () => {
    const session = makeSession();
    sessionRepository.getById.mockResolvedValue(session);
    repository.getBySessionId.mockResolvedValue([
      makeEvent({
        kind: AgentSessionActivityEventKind.StrictRouterDecision,
        status: AgentSessionActivityEventStatus.Running,
      }),
    ]);

    await sut.closeOpenLifecycleEvents(session.userId, session.id, AgentSessionActivityEventStatus.Completed);

    expect(repository.create).not.toHaveBeenCalled();
  });

  it('closes events even when the session is already terminal (cancel path)', async () => {
    const session = makeSession({ status: AgentSessionStatus.Cancelled });
    sessionRepository.getById.mockResolvedValue(session);
    repository.getBySessionId.mockResolvedValue([
      makeEvent({
        sessionId: session.id,
        kind: AgentSessionActivityEventKind.StartProcessing,
        status: AgentSessionActivityEventStatus.Running,
      }),
    ]);
    repository.create.mockResolvedValue(makeEvent({ status: AgentSessionActivityEventStatus.Skipped }));

    await sut.closeOpenLifecycleEvents(session.userId, session.id, AgentSessionActivityEventStatus.Skipped);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: AgentSessionActivityEventKind.StartProcessing,
        status: AgentSessionActivityEventStatus.Skipped,
      }),
    );
  });

  it('returns empty and inserts nothing when the session is not found', async () => {
    sessionRepository.getById.mockResolvedValue(null);

    const result = await sut.closeOpenLifecycleEvents(
      factory.uuid(),
      factory.uuid(),
      AgentSessionActivityEventStatus.Completed,
    );

    expect(result).toEqual([]);
    expect(repository.create).not.toHaveBeenCalled();
  });
});
```

(Import `AgentSessionActivityEventKind` already present in the spec imports; add any missing enum imports.)

- [ ] **Step 2: Run to verify red** — `pnpm test -- --run src/services/agent-session-activity-event.service.spec.ts`
      Expected: FAIL — `sut.closeOpenLifecycleEvents is not a function`.

- [ ] **Step 3: Implement** — in `agent-session-activity-event.service.ts`, add `AgentSessionActivityEventKind` to the `src/enum` import and:

```ts
const LIFECYCLE_EVENT_KINDS: AgentSessionActivityEventKind[] = [
  AgentSessionActivityEventKind.StartProcessing,
  AgentSessionActivityEventKind.PlanComposing,
  AgentSessionActivityEventKind.ApplyProgress,
  AgentSessionActivityEventKind.RunnerRecovery,
];
```

and the method (after `create()`):

```ts
  // Closes still-running lifecycle events by inserting a terminal sibling per kind
  // (events are append-only). Unlike create(), this intentionally runs for sessions
  // that are already terminal: cancel flips the session status before closing.
  async closeOpenLifecycleEvents(
    userId: string,
    sessionId: string,
    terminalStatus: AgentSessionActivityEventStatus,
  ): Promise<AgentSessionActivityEvent[]> {
    const session = await this.sessionRepository.getById(userId, sessionId);
    if (!session) {
      return [];
    }

    const events = await this.repository.getBySessionId(session.id);
    const latestStatusByKind = new Map<AgentSessionActivityEventKind, AgentSessionActivityEventStatus>();
    for (const event of events) {
      if (LIFECYCLE_EVENT_KINDS.includes(event.kind)) {
        latestStatusByKind.set(event.kind, event.status);
      }
    }

    const closers: AgentSessionActivityEvent[] = [];
    for (const [kind, status] of latestStatusByKind) {
      if (status !== AgentSessionActivityEventStatus.Running) {
        continue;
      }

      const closer = await this.repository.create({
        sessionId: session.id,
        kind,
        status: terminalStatus,
        source: AgentSessionActivityEventSource.Server,
        summary: null,
        counts: null,
      });
      this.websocketRepository.clientSend('on_agent_session_event', userId, {
        type: 'activity',
        sessionId: session.id,
        event: closer,
        createdAt: closer.createdAt.toISOString(),
      });
      closers.push(closer);
    }

    return closers;
  }
```

(`getBySessionId` orders `createdAt asc, id asc`, so the map naturally keeps the latest status per kind.)

- [ ] **Step 4: Run to verify green** — same command. Expected: PASS (all new + existing tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/agent-session-activity-event.service.ts server/src/services/agent-session-activity-event.service.spec.ts
git commit -m "feat(server): closeOpenLifecycleEvents inserts terminal siblings for open agent lifecycle events"
```

---

### Task 2: Runner closes lifecycle events on successful settle

**Files:**

- Modify: `server/src/services/agent-runner.service.ts`
- Test: `server/src/services/agent-runner.service.spec.ts`

- [ ] **Step 1: Write the failing tests.** In the spec, the `activityService` mock literal (around line 145) gains `closeOpenLifecycleEvents: vi.fn()`. Add tests (mirror the structure of the existing success-stream test around line 683 and the tool-approval test):

```ts
it('closes open lifecycle events after a successful turn', async () => {
  // reuse the existing successful sendMessage/stream arrangement from the
  // 'creates a start-processing activity event' test in this file
  ...
  expect(activityService.closeOpenLifecycleEvents).toHaveBeenCalledWith(
    userId,
    sessionId,
    AgentSessionActivityEventStatus.Completed,
  );
});

it('does not close lifecycle events when pausing for tool approval', async () => {
  // arrange the stream to yield a tool-approval-needed event (existing pattern)
  ...
  expect(activityService.closeOpenLifecycleEvents).not.toHaveBeenCalled();
});

it('does not close lifecycle events on runner failure (failure event already records it)', async () => {
  // arrange the stream to throw / yield runner-error (existing emitRunnerFailure test pattern)
  ...
  expect(activityService.closeOpenLifecycleEvents).not.toHaveBeenCalled();
});
```

The implementer copies the exact arrangement blocks from the neighbouring tests in this spec file — do not invent new stream fixtures.

- [ ] **Step 2: Run to verify red** — `pnpm test -- --run src/services/agent-runner.service.spec.ts`
      Expected: FAIL — `closeOpenLifecycleEvents` never called (assertion), others pass.

- [ ] **Step 3: Implement.**
  1. Extend the local type (line ~33):

```ts
type AgentSessionActivityServiceLike = {
  createSystemEvent: (userId: string, sessionId: string, event: Record<string, unknown>) => Promise<unknown>;
  normalizeRunnerEvent: (event: AgentRunnerActivityStreamEvent) => Record<string, unknown> | null | undefined;
  closeOpenLifecycleEvents: (
    userId: string,
    sessionId: string,
    terminalStatus: AgentSessionActivityEventStatus,
  ) => Promise<unknown>;
};
```

2. Private helper next to `createActivityEvent` (same defensive pattern):

```ts
  private closeLifecycleEvents(userId: string, sessionId: string, terminalStatus: AgentSessionActivityEventStatus) {
    try {
      if (typeof this.activityService?.closeOpenLifecycleEvents !== 'function') {
        return;
      }

      void Promise.resolve(this.activityService.closeOpenLifecycleEvents(userId, sessionId, terminalStatus)).catch(() => {
        // Activity events are audit hints and must not block the assistant stream.
      });
    } catch {
      // Activity events are audit hints and must not block the assistant stream.
    }
  }
```

3. Call site: at the END of `processRunnerStream`'s success path, immediately after `await this.cleanupSameTurnToolFailure(userId, sessionId, session.status, cleanupContext);`:

```ts
this.closeLifecycleEvents(userId, sessionId, AgentSessionActivityEventStatus.Completed);
```

Do NOT call it on the `tool-approval-needed` early return, on the inactive-session early return, or in `emitRunnerFailure`.

- [ ] **Step 4: Run to verify green** — same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/agent-runner.service.ts server/src/services/agent-runner.service.spec.ts
git commit -m "feat(server): close open lifecycle activity events when a runner turn settles successfully"
```

---

### Task 3: Cancel marks open lifecycle events skipped

**Files:**

- Modify: `server/src/services/agent-session.service.ts`
- Test: `server/src/services/agent-session.service.spec.ts`

- [ ] **Step 1: Write the failing tests.** The spec constructs the service with automocks; add `AgentSessionActivityEventService` (import + `automock(AgentSessionActivityEventService)` following the file's existing pattern) as a 4th constructor arg everywhere the spec instantiates `AgentSessionService`. Tests:

```ts
it('marks open lifecycle events skipped on cancel', async () => {
  // reuse the existing successful-cancel arrangement in this file
  ...
  expect(activityEventService.closeOpenLifecycleEvents).toHaveBeenCalledWith(
    auth.user.id,
    session.id,
    AgentSessionActivityEventStatus.Skipped,
  );
});

it('cancel succeeds even when closing activity events fails', async () => {
  activityEventService.closeOpenLifecycleEvents.mockRejectedValue(new Error('boom'));
  // existing successful-cancel arrangement
  await expect(sut.cancel(auth, session.id)).resolves.toBeDefined();
});

it('does not close lifecycle events when the session is already cancelled', async () => {
  // existing already-cancelled early-return arrangement
  ...
  expect(activityEventService.closeOpenLifecycleEvents).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify red** — `pnpm test -- --run src/services/agent-session.service.spec.ts`
      Expected: FAIL — `closeOpenLifecycleEvents` not called / ctor arg unused (assertions fail; esbuild does not type-check, so the extra ctor arg runs).

- [ ] **Step 3: Implement.** In `agent-session.service.ts`:
  1. Import `AgentSessionActivityEventService` and `AgentSessionActivityEventStatus`; extend the constructor:

```ts
  constructor(
    private readonly repository: AgentSessionRepository,
    private readonly credentialService: AgentProviderCredentialService,
    private readonly agentRunnerService: AgentRunnerService,
    private readonly activityEventService: AgentSessionActivityEventService,
  ) {}
```

2. In `cancel()`, after `await this.cancelRunnerSession(session);` and before `return this.map(updated);`:

```ts
try {
  await this.activityEventService.closeOpenLifecycleEvents(auth.user.id, id, AgentSessionActivityEventStatus.Skipped);
} catch {
  // Closing activity events is best-effort; the database cancellation is authoritative.
}
```

3. Verify there is no manual construction of `AgentSessionService` outside Nest DI and specs: `rg -n "new AgentSessionService\(" server/src --glob '!**/*.spec.ts'` must return nothing (if it returns a site, update that site's argument list too and note it in the report).

- [ ] **Step 4: Run to verify green** — same command, then the neighbours: `pnpm test -- --run src/services/agent-session.service.spec.ts src/services/agent-session-activity-event.service.spec.ts src/services/agent-runner.service.spec.ts`. Expected: PASS.

- [ ] **Step 5: Type-check + targeted lint, then commit**

```bash
cd server && pnpm exec tsc --noEmit
pnpm exec eslint --max-warnings 0 src/services/agent-session.service.ts src/services/agent-session-activity-event.service.ts src/services/agent-runner.service.ts
git add server/src/services/agent-session.service.ts server/src/services/agent-session.service.spec.ts
git commit -m "feat(server): cancel marks open agent lifecycle activity events as skipped"
```

(`tsc --noEmit` direct, not `make check-server` — the make target's cache can mask spec TS errors.)

---

## Self-Review

**Spec coverage:** Server change A fully: success→completed (Task 2), cancel→skipped (Task 3), failure unchanged (Task 2 test 3), idempotency E9 + strict-untouched + terminal-session bypass (Task 1). Append-only honored (inserts only). Websocket emit for closers included.
**Placeholders:** Task 2/3 "reuse existing arrangement" deliberately points at named neighbouring tests in the same file rather than duplicating large fixtures — the implementer must copy them verbatim, not invent.
**Type consistency:** `closeOpenLifecycleEvents(userId: string, sessionId: string, terminalStatus: AgentSessionActivityEventStatus): Promise<AgentSessionActivityEvent[]>` identical across service, Like-type, and all call sites.
