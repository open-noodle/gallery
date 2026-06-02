dev:
	@printf "This command has been removed. Please use:\n\n    mise dev          # or mise //:dev from another directory\n\n" >&2 && exit 1

dev-down:
	@printf "This command has been removed. Please use:\n\n    mise dev-down          # or mise //:dev-down from another directory\n\n" >&2 && exit 1

dev-update:
	@printf "This command has been removed. Please use:\n\n    mise dev-update          # or mise //:dev-update from another directory\n\n" >&2 && exit 1

dev-scale:
	@printf "This command has been removed. Please use:\n\n    mise dev-scale          # or mise //:dev-scale from another directory\n\n" >&2 && exit 1

dev-docs:
	npm --prefix docs run start

.PHONY: e2e
e2e:
	@printf "This command has been removed. Please use:\n\n    mise e2e          # or mise //:e2e from another directory\n\n" >&2 && exit 1

e2e-dev:
	@printf "This command has been removed. Please use:\n\n    mise e2e-dev          # or mise //:e2e-dev from another directory\n\n" >&2 && exit 1

e2e-update:
	@printf "This command has been removed. Please use:\n\n    mise e2e-update          # or mise //:e2e-update from another directory\n\n" >&2 && exit 1

e2e-down:
	@printf "This command has been removed. Please use:\n\n    mise e2e-down          # or mise //:e2e-down from another directory\n\n" >&2 && exit 1

# Run e2e tests against the already-running dev stack (make dev)
e2e-web-dev:
	cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:2283 PLAYWRIGHT_DISABLE_WEBSERVER=1 pnpm exec playwright test --project=web

e2e-web-dev-ui:
	cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:2283 PLAYWRIGHT_DISABLE_WEBSERVER=1 pnpm exec playwright test --ui --project=web

e2e-api-dev:
	cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:2283 PLAYWRIGHT_DISABLE_WEBSERVER=1 pnpm test

e2e-integration-dev:
	cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:2283 PLAYWRIGHT_DISABLE_WEBSERVER=1 pnpm exec playwright test --project=integration

e2e-integration-dev-ui:
	cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:2283 PLAYWRIGHT_DISABLE_WEBSERVER=1 pnpm exec playwright test --ui --project=integration

.PHONY: e2e-rebase-smoke
e2e-rebase-smoke:
	pnpm --filter @immich/sdk build
	cd e2e && pnpm exec playwright install chromium --only-shell
	cd e2e && { trap 'docker compose down -v' EXIT; docker compose up -d --build --wait && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke; }

.PHONY: storage-migration-tests
storage-migration-tests:
	cd e2e && ./storage-migration.sh --cleanup --verbose

.PHONY: storage-migration-e2e
storage-migration-e2e:
	cd e2e && ./storage-migration.sh --cleanup --verbose

UPSTREAM_PREFLIGHT = pnpm --filter @gallery/upstream-preflight

.PHONY: upstream-preflight
upstream-preflight:
	$(UPSTREAM_PREFLIGHT) run preflight

.PHONY: upstream-rebase-ready
upstream-rebase-ready:
	$(UPSTREAM_PREFLIGHT) run ready

.PHONY: upstream-batch-plan
upstream-batch-plan:
	$(UPSTREAM_PREFLIGHT) run batch-plan

.PHONY: upstream-next-batch
upstream-next-batch:
	$(UPSTREAM_PREFLIGHT) run next-batch

.PHONY: upstream-rolling-start
upstream-rolling-start:
	$(UPSTREAM_PREFLIGHT) run rolling-start $(if $(ROLLING_RESUME),--resume,)

.PHONY: upstream-rolling-status
upstream-rolling-status:
	$(UPSTREAM_PREFLIGHT) run rolling-status

.PHONY: upstream-sync-fork-main
upstream-sync-fork-main:
	$(UPSTREAM_PREFLIGHT) run sync-fork-main $(if $(ROLLING_CONTINUE),--continue,)

.PHONY: upstream-rolling-final-check
upstream-rolling-final-check:
	$(UPSTREAM_PREFLIGHT) run rolling-final-check

.PHONY: upstream-postrebase-audit
upstream-postrebase-audit:
	$(UPSTREAM_PREFLIGHT) run postrebase-audit $(if $(BATCH),--batch $(BATCH),)

.PHONY: mobile-drift-rebase-check
mobile-drift-rebase-check:
	$(UPSTREAM_PREFLIGHT) run mobile-drift-check $(if $(BATCH),--batch $(BATCH),)

.PHONY: ci-invariants-check
ci-invariants-check:
	$(UPSTREAM_PREFLIGHT) run ci-invariants-check

.PHONY: fork-patches-check
fork-patches-check:
	$(UPSTREAM_PREFLIGHT) run fork-patches-check

.PHONY: rebase-confidence-check
rebase-confidence-check:
	$(UPSTREAM_PREFLIGHT) run rebase-confidence-check $(if $(BATCH),--batch $(BATCH),)

.PHONY: fork-ownership-coverage-check
fork-ownership-coverage-check:
	git diff --name-only upstream/main...origin/main | sort > /tmp/gallery-fork-files.txt
	$(UPSTREAM_PREFLIGHT) run coverage -- /tmp/gallery-fork-files.txt docs/fork/ownership.yml --expected-head "$$(git rev-parse origin/main)"

prod:
	@printf "This command has been removed. Please use:\n\n    mise prod          # or mise //:prod from another directory\n\n" >&2 && exit 1

prod-down:
	@printf "This command has been removed. Please use:\n\n    mise prod-down          # or mise //:prod-down from another directory\n\n" >&2 && exit 1

prod-scale:
	@printf "This command has been removed. Please use:\n\n    mise prod-scale          # or mise //:prod-scale from another directory\n\n" >&2 && exit 1

.PHONY: open-api
open-api:
	@printf "This command has been removed. Please use:\n\n    mise open-api          # or mise //:open-api from another directory\n\n" >&2 && exit 1

sql:
	@printf "This command has been removed. Please use:\n\n    mise sql               # or mise //:sql from another directory\n\n" >&2 && exit 1


renovate:
  LOG_LEVEL=debug pnpm exec renovate --platform=local --repository-cache=reset

# Include .env file if it exists
-include docker/.env

MODULES = e2e server web cli sdk docs .github

test-e2e:
	@printf "This command has been removed. Please use:\n\n    mise //e2e:test               # or mise //e2e:test-web for web tests, respectively\n\n" >&2 && exit 1

clean:
	@printf "This command has been removed. Please use:\n\n    mise clean               # or mise //:clean from another directory\n\n" >&2 && exit 1
