dev:
	@trap 'make dev-down' EXIT; COMPOSE_BAKE=true docker compose -f ./docker/docker-compose.dev.yml up --remove-orphans

dev-down:
	docker compose -f ./docker/docker-compose.dev.yml down --remove-orphans

dev-update:
	@trap 'make dev-down' EXIT; COMPOSE_BAKE=true docker compose -f ./docker/docker-compose.dev.yml up --build -V --remove-orphans

dev-scale:
	@trap 'make dev-down' EXIT; COMPOSE_BAKE=true docker compose -f ./docker/docker-compose.dev.yml up --build -V --scale immich-server=3 --remove-orphans

dev-docs:
	npm --prefix docs run start

.PHONY: e2e
e2e:
	@trap 'make e2e-down' EXIT; COMPOSE_BAKE=true docker compose -f ./e2e/docker-compose.yml up --remove-orphans

e2e-dev:
	@trap 'make e2e-down' EXIT; COMPOSE_BAKE=true docker compose -f ./e2e/docker-compose.dev.yml up --remove-orphans

e2e-update:
	@trap 'make e2e-down' EXIT; COMPOSE_BAKE=true docker compose -f ./e2e/docker-compose.yml up --build -V --remove-orphans

e2e-down:
	docker compose -f ./e2e/docker-compose.yml down --remove-orphans

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
	cd e2e && docker compose up -d --build --wait
	cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=true pnpm exec playwright test --project=rebase-smoke
	cd e2e && docker compose down -v

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

.PHONY: upstream-postrebase-audit
upstream-postrebase-audit:
	$(UPSTREAM_PREFLIGHT) run postrebase-audit $(if $(BATCH),-- --batch $(BATCH),)

.PHONY: mobile-drift-rebase-check
mobile-drift-rebase-check:
	$(UPSTREAM_PREFLIGHT) run mobile-drift-check $(if $(BATCH),-- --batch $(BATCH),)

.PHONY: ci-invariants-check
ci-invariants-check:
	$(UPSTREAM_PREFLIGHT) run ci-invariants-check

.PHONY: fork-patches-check
fork-patches-check:
	$(UPSTREAM_PREFLIGHT) run fork-patches-check

.PHONY: fork-ownership-coverage-check
fork-ownership-coverage-check:
	git diff --name-only upstream/main...origin/main | sort > /tmp/gallery-fork-files.txt
	$(UPSTREAM_PREFLIGHT) run coverage -- /tmp/gallery-fork-files.txt docs/fork/ownership.yml --expected-head "$$(git rev-parse origin/main)"

prod:
	@trap 'make prod-down' EXIT; COMPOSE_BAKE=true docker compose -f ./docker/docker-compose.prod.yml up --build -V --remove-orphans

prod-down:
	docker compose -f ./docker/docker-compose.prod.yml down --remove-orphans

prod-scale:
	@trap 'make prod-down' EXIT; COMPOSE_BAKE=true docker compose -f ./docker/docker-compose.prod.yml up --build -V --scale immich-server=3 --scale immich-microservices=3 --remove-orphans

.PHONY: open-api
open-api:
	@printf "This command has been removed. Please use:\n\n    mise open-api          # or mise //:open-api from another directory\n\n"\n\n >&2 && exit 1

sql:
	@printf "This command has been removed. Please use:\n\n    mise sql               # or mise //:sql from another directory\n\n"\n\n >&2 && exit 1


renovate:
  LOG_LEVEL=debug pnpm exec renovate --platform=local --repository-cache=reset

# Include .env file if it exists
-include docker/.env

MODULES = e2e server web cli sdk docs .github

test-e2e:
	docker compose -f ./e2e/docker-compose.yml build
	pnpm --filter immich-e2e run test
	pnpm --filter immich-e2e run test:web

clean:
	find . -name "node_modules" -type d -prune -exec rm -rf {} +
	find . -name "dist" -type d -prune -exec rm -rf '{}' +
	find . -name "build" -type d -prune -exec rm -rf '{}' +
	find . -name ".svelte-kit" -type d -prune -exec rm -rf '{}' +
	find . -name "coverage" -type d -prune -exec rm -rf '{}' +
	find . -name ".pnpm-store" -type d -prune -exec rm -rf '{}' +
	command -v docker >/dev/null 2>&1 && docker compose -f ./docker/docker-compose.dev.yml down -v --remove-orphans || true
	command -v docker >/dev/null 2>&1 && docker compose -f ./e2e/docker-compose.yml down -v --remove-orphans || true
