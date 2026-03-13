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


# ─── Mobile Integration Tests ────────────────────────────────────────────────
#
# Fastest iteration workflow:
#
#   1. Setup (once):  make mobile-e2e-setup
#      Installs patrol_cli, boots an emulator if needed, starts a fresh Docker
#      backend (server + postgres + redis on port 2285). Everything stays running.
#
#   2. Run tests:     make mobile-test
#      Rebuilds the app with your changes and runs all tests. ~2-3 min.
#      Backend and emulator are already running — no startup wait.
#
#   3. Fresh start:   make mobile-test-clean && make mobile-e2e-setup
#      Nukes the DB and containers, starts fresh.
#
#   4. Done for the day: make mobile-test-clean
#      Stops backend containers and removes volumes.
#
# One-shot command (setup + test + teardown in one):
#   make mobile-e2e            Setup → run all tests → teardown
#
# All targets:
#   mobile-e2e-setup           One-time setup: patrol_cli + emulator + fresh backend
#   mobile-test                Run all integration tests
#   mobile-test-clean          Stop backend and remove volumes (fresh state)
#   mobile-emulator-ensure     Start emulator if none running
#   mobile-patrol-ensure       Install patrol_cli if missing
#   mobile-test-backend-start  Start Docker backend, wait for health check
#   mobile-test-backend-stop   Stop Docker backend (keeps volumes)
# ─────────────────────────────────────────────────────────────────────────────

# patrol_cli is installed via dart pub global activate but may not be on PATH.
# ANDROID_HOME is needed so patrol can find adb, aapt, etc.
PATROL := $(HOME)/.pub-cache/bin/patrol
ANDROID_SDK_ROOT ?= /opt/android-sdk
export ANDROID_HOME ?= $(ANDROID_SDK_ROOT)

mobile-emulator-ensure:
	mobile/integration_test/scripts/ensure-emulator.sh

mobile-patrol-ensure:
	mobile/integration_test/scripts/ensure-patrol.sh

mobile-test-backend-start:
	mobile/integration_test/scripts/start-backend.sh

mobile-test-backend-stop:
	mobile/integration_test/scripts/stop-backend.sh

mobile-test-clean:
	mobile/integration_test/scripts/stop-backend.sh

mobile-test:
	cd mobile && PATH="$(ANDROID_SDK_ROOT)/platform-tools:$(ANDROID_SDK_ROOT)/emulator:$$PATH" $(PATROL) test -t integration_test/tests/

mobile-e2e-setup:
	@make mobile-patrol-ensure
	@make mobile-emulator-ensure
	@make mobile-test-clean 2>/dev/null || true
	@make mobile-test-backend-start

mobile-e2e:
	@make mobile-e2e-setup
	@trap 'make mobile-test-backend-stop' EXIT; \
		make mobile-test
