FROM ghcr.io/immich-app/base-server-dev:202610291416@sha256:5f4f9f77059e1cd0182994419a19f4ee045c3fd48e611f5e77623ed63f7aa1e4
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  CI=1 \
  COREPACK_HOME=/tmp

RUN npm install --global corepack@latest && \
  corepack enable pnpm

WORKDIR /usr/src/app

COPY package* pnpm* .pnpmfile.cjs ./
# Gallery isolates e2e-auth-server as its own pnpm workspace (packages/e2e-auth-server/pnpm-workspace.yaml)
# so its OIDC deps stay out of the monorepo root lockfile. That workspace marker must land alongside the
# manifest BEFORE install, or pnpm walks up to the monorepo root and resolves against the wrong lockfile.
# And with no committed lockfile here, install must NOT be --frozen-lockfile.
COPY ./packages/e2e-auth-server/package.json ./packages/e2e-auth-server/pnpm-workspace.yaml ./packages/e2e-auth-server/

WORKDIR /usr/src/app/packages/e2e-auth-server
RUN pnpm install

COPY ./packages/e2e-auth-server ./

EXPOSE 2286
CMD ["pnpm", "run", "start"]
