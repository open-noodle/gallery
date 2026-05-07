FROM node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe
WORKDIR /usr/src/app

RUN corepack enable

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
