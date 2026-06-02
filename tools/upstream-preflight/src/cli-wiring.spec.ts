import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('rolling rebase CLI wiring', () => {
  it('exposes rolling commands as package scripts', () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      'rolling-start': 'tsx src/index.ts rolling-start',
      'rolling-status': 'tsx src/index.ts rolling-status',
      'sync-fork-main': 'tsx src/index.ts sync-fork-main',
      'rolling-final-check': 'tsx src/index.ts rolling-final-check',
      'rebase-confidence-check': 'tsx src/index.ts rebase-confidence-check',
    });
  });

  it('exposes rolling commands as Make targets', () => {
    const makefile = fs.readFileSync(
      path.resolve(process.cwd(), '../../Makefile'),
      'utf8',
    );

    expect(makefile).toContain('.PHONY: upstream-rolling-start');
    expect(makefile).toContain('$(UPSTREAM_PREFLIGHT) run rolling-start');
    expect(makefile).toContain('.PHONY: upstream-rolling-status');
    expect(makefile).toContain('$(UPSTREAM_PREFLIGHT) run rolling-status');
    expect(makefile).toContain('.PHONY: upstream-sync-fork-main');
    expect(makefile).toContain('$(UPSTREAM_PREFLIGHT) run sync-fork-main');
    expect(makefile).toContain('.PHONY: upstream-rolling-final-check');
    expect(makefile).toContain('$(UPSTREAM_PREFLIGHT) run rolling-final-check');
    expect(makefile).toContain('.PHONY: rebase-confidence-check');
    expect(makefile).toContain(
      '$(UPSTREAM_PREFLIGHT) run rebase-confidence-check',
    );
  });

  it('exposes a local Gallery branding verification Make target', () => {
    const makefile = fs.readFileSync(
      path.resolve(process.cwd(), '../../Makefile'),
      'utf8',
    );

    expect(makefile).toContain('.PHONY: gallery-branding-check');
    expect(makefile).toContain('branding/scripts/gallery-branding-check.sh');
  });

  it('exposes a local Gallery ML smoke Make target', () => {
    const makefile = fs.readFileSync(
      path.resolve(process.cwd(), '../../Makefile'),
      'utf8',
    );

    expect(makefile).toContain('.PHONY: gallery-ml-smoke');
    expect(makefile).toContain('machine-learning/scripts/gallery-ml-smoke.sh');
  });

  it('keeps the Gallery branding check isolated in a temporary worktree', () => {
    const script = fs.readFileSync(
      path.resolve(
        process.cwd(),
        '../../branding/scripts/gallery-branding-check.sh',
      ),
      'utf8',
    );

    expect(script).toContain('trap cleanup EXIT');
    expect(script).toContain('git -C "$REPO_ROOT" worktree add');
    expect(script).toContain('git -C "$REPO_ROOT" worktree remove --force');
    expect(script).toContain(
      'ruby .github/actions/apply-branding/dependencies_test.rb',
    );
    expect(script).toContain('branding/scripts/test-email-branding.sh');
    expect(script).toContain('branding/scripts/test-app-download-branding.sh');
    expect(script).toContain('branding/scripts/apply-branding.sh');
    expect(script).toContain('branding/scripts/verify-branding.sh');
    expect(script).toContain('active worktree status changed');
  });

  it('checks Docker availability and probes the ML container in the ML smoke script', () => {
    const script = fs.readFileSync(
      path.resolve(
        process.cwd(),
        '../../machine-learning/scripts/gallery-ml-smoke.sh',
      ),
      'utf8',
    );

    expect(script).toContain('Docker is required for gallery-ml-smoke');
    expect(script).toContain('buildx build');
    expect(script).toContain('--load');
    expect(script).toContain('--build-arg DEVICE=cpu');
    expect(script).toContain('"$DOCKER_BIN" run --detach');
    expect(script).toContain('"$DOCKER_BIN" inspect');
    expect(script).toContain('python3 healthcheck.py');
    expect(script).toContain('immich_ml.main');
    expect(script).toContain('immich_ml.models');
    expect(script).toContain('"$DOCKER_BIN" logs');
    expect(script).toContain('"$DOCKER_BIN" rm --force');
  });

  it('keeps the ML smoke health timeout message aligned with wait timing', () => {
    const script = fs.readFileSync(
      path.resolve(
        process.cwd(),
        '../../machine-learning/scripts/gallery-ml-smoke.sh',
      ),
      'utf8',
    );

    expect(script).toContain('HEALTH_TIMEOUT_SECONDS=180');
    expect(script).toContain('HEALTH_SLEEP_SECONDS=2');
    expect(script).toContain(
      'HEALTH_ATTEMPTS=$((HEALTH_TIMEOUT_SECONDS / HEALTH_SLEEP_SECONDS))',
    );
    expect(script).not.toContain('within 90 seconds');
    expect(script).not.toContain('within 300 seconds');
    expect(script).toMatch(
      /did not become healthy within \$\{?HEALTH_TIMEOUT_SECONDS\}? seconds|did not become healthy within 180 seconds/,
    );
  });

  it('fails clearly when the ML image has no Docker healthcheck metadata', () => {
    const script = fs.readFileSync(
      path.resolve(
        process.cwd(),
        '../../machine-learning/scripts/gallery-ml-smoke.sh',
      ),
      'utf8',
    );

    expect(script).toContain('missing-healthcheck');
    expect(script).toContain('ML container has no Docker healthcheck metadata');
  });

  it('checks ML container runtime state separately from Docker health', () => {
    const script = fs.readFileSync(
      path.resolve(
        process.cwd(),
        '../../machine-learning/scripts/gallery-ml-smoke.sh',
      ),
      'utf8',
    );

    expect(script).toContain('.State.Status');
    expect(script).toContain('runtime_state=');
    expect(script).toContain('health_status=');
    expect(script).toContain('[[ "$runtime_state" != "running" ]]');
    expect(script).toContain(
      'ML container is not running; state: $runtime_state, health: $health_status',
    );
  });

  it('forwards rolling Make target options without an extra argument separator', () => {
    const makefile = fs.readFileSync(
      path.resolve(process.cwd(), '../../Makefile'),
      'utf8',
    );

    expect(makefile).toContain(
      '$(UPSTREAM_PREFLIGHT) run rolling-start $(if $(ROLLING_RESUME),--resume,)',
    );
    expect(makefile).toContain(
      '$(UPSTREAM_PREFLIGHT) run sync-fork-main $(if $(ROLLING_CONTINUE),--continue,)',
    );
    expect(makefile).toContain(
      '$(UPSTREAM_PREFLIGHT) run postrebase-audit $(if $(BATCH),--batch $(BATCH),)',
    );
    expect(makefile).toContain(
      '$(UPSTREAM_PREFLIGHT) run mobile-drift-check $(if $(BATCH),--batch $(BATCH),)',
    );
    expect(makefile).toContain(
      '$(UPSTREAM_PREFLIGHT) run rebase-confidence-check $(if $(BATCH),--batch $(BATCH),)',
    );
    expect(makefile).not.toContain('-- --resume');
    expect(makefile).not.toContain('-- --continue');
    expect(makefile).not.toContain('-- --batch');
  });
});
