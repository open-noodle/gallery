# Future CI/CD Improvements

## ARM Runner Support

ARM runners (`ubuntu-24.04-arm`) were removed from the E2E test matrix because:

- Docker images pinned by SHA digest in `e2e/docker-compose.yml` (postgres with vectorchord, valkey) may not have ARM64 manifests
- The `ghcr.io/immich-app/immich-server-build-cache` is not accessible from the fork
- The Docker build fails immediately on ARM runners

**To re-enable ARM E2E testing:**

1. Verify that all Docker images in `e2e/docker-compose.yml` have multi-arch manifests (amd64 + arm64)
2. Either remove the `cache_from` directive or set up ARM build cache accessible from the fork
3. Change `runner: [ubuntu-latest]` back to `runner: [ubuntu-latest, ubuntu-24.04-arm]` in `.github/workflows/test.yml` (two locations: `e2e-tests-server-cli` and `e2e-tests-web`)
4. Alternatively, add `continue-on-error: true` for ARM matrix entries so ARM failures don't block the pipeline

## DCM (Dart Code Metrics) License

DCM was disabled in `.github/workflows/static_analysis.yml` because it requires a valid license key (`--ci-key` and `--email`). The upstream immich-app org likely has this configured.

**To re-enable:**

1. Obtain a DCM CI license key (or use the OSS key if available)
2. Add the key as a repository secret
3. Uncomment the DCM step in `static_analysis.yml`

## E2E Asset Serving Tests

The `GET /assets/:id/original` and `GET /assets/:id/thumbnail` E2E tests fail with 500 errors. Root cause: `StorageService.diskBackend` is a static field initialized only in `onBootstrap()`, and the `resolveBackendForKey()` / `getWriteBackend()` methods don't guard against it being undefined.

**To fix:**

1. Add a null check or default initialization for `diskBackend` in `StorageService.resolveBackendForKey()`
2. Or initialize `diskBackend` at declaration time rather than waiting for `onBootstrap()`
3. Review `BaseService.serveFromBackend()` for proper error handling

## Token Management

The upstream `immich-app/devtools/actions/create-workflow-token` was replaced with `${{ github.token }}` throughout all workflow files. This works for fork CI but provides more limited permissions than the custom Push-O-Matic app token.

**If higher permissions are needed:**

1. Create a GitHub App for the fork with the required permissions
2. Add `APP_ID` and `APP_KEY` secrets
3. Restore the `create-workflow-token` action usage

## Lint/TypeScript Conflict Pattern

Many test files needed `// eslint-disable-next-line unicorn/no-useless-undefined` comments because `mockResolvedValue(undefined)` is flagged by the lint rule but required by TypeScript when the mock's return type includes `undefined`.

**Better long-term solutions:**

1. Configure `unicorn/no-useless-undefined` to ignore `mockResolvedValue` calls
2. Create a test utility helper that wraps the pattern
3. Upstream a fix to vitest's mock types to accept 0 arguments for `void | undefined` return types
