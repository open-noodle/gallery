FROM ghcr.io/immich-app/base-server-dev:202604141125@sha256:9338c216fb0fef4172cf53cd8e4ff607c6635d576dcc1366151f13d69bbb45ef

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  CI=1 \
  COREPACK_HOME=/tmp \
  PNPM_HOME=/buildcache/pnpm-store \
  PATH="/buildcache/pnpm-store:$PATH"

RUN npm install --global corepack@latest && \
  corepack enable pnpm && \
  pnpm config set store-dir "$PNPM_HOME"

WORKDIR /usr/src/app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY patches ./patches
COPY agent-runner ./agent-runner

RUN --mount=type=cache,id=pnpm-agent-runner,target=/buildcache/pnpm-store \
  pnpm --filter @open-noodle/agent-runner --frozen-lockfile install

EXPOSE 4477

CMD ["pnpm", "--dir", "agent-runner", "start"]
