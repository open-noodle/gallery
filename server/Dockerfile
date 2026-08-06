FROM ghcr.io/immich-app/base-server-dev:202607211135@sha256:83c9ff3f7390111596a2dcd24a746c3f8618d58259dbc7aae36618d153462f18 AS builder
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  CI=1 \
  COREPACK_HOME=/tmp \
  PNPM_HOME=/buildcache/pnpm-store \
  PATH="/buildcache/pnpm-store:$PATH"

RUN npm install --global corepack@latest && \
  corepack enable pnpm && \
  pnpm config set store-dir "$PNPM_HOME"

FROM builder AS server

WORKDIR /usr/src/app
COPY ./server ./server/
COPY ./packages/sdk ./packages/sdk/
COPY ./packages/plugin-sdk ./packages/plugin-sdk/
RUN --mount=type=cache,id=pnpm-server,target=/buildcache/pnpm-store \
  --mount=type=bind,source=package.json,target=package.json \
  --mount=type=bind,source=.pnpmfile.cjs,target=.pnpmfile.cjs \
  --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
  --mount=type=bind,source=pnpm-workspace.yaml,target=pnpm-workspace.yaml \
  --mount=type=bind,source=patches,target=patches \
  pnpm --filter @immich/sdk install --frozen-lockfile && \
  pnpm --filter @immich/sdk build && \
  pnpm --filter @immich/sdk --filter @immich/plugin-sdk --filter immich install --frozen-lockfile && \
  SHARP_IGNORE_GLOBAL_LIBVIPS=true pnpm --filter @immich/plugin-sdk --filter immich build && \
  SHARP_FORCE_GLOBAL_LIBVIPS=true  pnpm --filter immich --prod --no-optional deploy /output/server-pruned

FROM builder AS web

ARG BUILD_ID
ENV IMMICH_BUILD=${BUILD_ID}

WORKDIR /usr/src/app
COPY ./web ./web/
COPY ./i18n ./i18n/
COPY ./packages ./packages/
RUN --mount=type=cache,id=pnpm-web,target=/buildcache/pnpm-store \
  --mount=type=bind,source=package.json,target=package.json \
  --mount=type=bind,source=.pnpmfile.cjs,target=.pnpmfile.cjs \
  --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
  --mount=type=bind,source=pnpm-workspace.yaml,target=pnpm-workspace.yaml \
  --mount=type=bind,source=patches,target=patches \
  SHARP_IGNORE_GLOBAL_LIBVIPS=true pnpm --filter @immich/sdk --filter immich-web install --frozen-lockfile --force && \
  pnpm --filter @immich/sdk build && \
  pnpm --filter @immich/sdk --filter immich-web install --frozen-lockfile --force && \
  pnpm --filter immich-web build

FROM builder AS cli

COPY ./packages ./packages/
RUN --mount=type=cache,id=pnpm-cli,target=/buildcache/pnpm-store \
  --mount=type=bind,source=package.json,target=package.json \
  --mount=type=bind,source=.pnpmfile.cjs,target=.pnpmfile.cjs \
  --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
  --mount=type=bind,source=pnpm-workspace.yaml,target=pnpm-workspace.yaml \
  --mount=type=bind,source=patches,target=patches \
  pnpm --filter @immich/sdk install --frozen-lockfile && \
  pnpm --filter @immich/sdk build && \
  pnpm --filter @immich/sdk --filter @immich/cli install --frozen-lockfile && \
  pnpm --filter @immich/cli build && \
  pnpm --filter @immich/cli --prod --no-optional deploy /output/cli-pruned

FROM builder AS agent-runner

WORKDIR /usr/src/app
COPY ./agent-runner ./agent-runner/
RUN --mount=type=cache,id=pnpm-agent-runner,target=/buildcache/pnpm-store \
  --mount=type=bind,source=package.json,target=package.json \
  --mount=type=bind,source=.pnpmfile.cjs,target=.pnpmfile.cjs \
  --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
  --mount=type=bind,source=pnpm-workspace.yaml,target=pnpm-workspace.yaml \
  --mount=type=bind,source=patches,target=patches \
  pnpm --filter @open-noodle/agent-runner --frozen-lockfile --prod --no-optional deploy /output/agent-runner-pruned

FROM builder AS plugins

ARG TARGETPLATFORM

COPY --from=ghcr.io/jdx/mise:2026.7.11@sha256:6599c81b0da6206cbf5151df97a36794d70aaec4574ceb92d13783b42080b055 /usr/local/bin/mise /usr/local/bin/mise

WORKDIR /app
COPY ./packages/sdk ./packages/sdk/
COPY ./packages/plugin-core ./packages/plugin-core/
COPY ./packages/plugin-gallery ./packages/plugin-gallery/
COPY ./packages/plugin-sdk ./packages/plugin-sdk/
ENV MISE_DATA_DIR=/buildcache/mise

RUN DEBIAN_FRONTEND=noninteractive apt-get update && \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends binaryen && \
  rm -rf /var/lib/apt/lists/*

# Build plugins
RUN --mount=type=cache,id=pnpm-packages,target=/buildcache/pnpm-store \
  --mount=type=cache,id=mise-plugin-tools-${TARGETPLATFORM},target=/buildcache/mise \
  --mount=type=bind,source=package.json,target=package.json \
  --mount=type=bind,source=.pnpmfile.cjs,target=.pnpmfile.cjs \
  --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
  --mount=type=bind,source=pnpm-workspace.yaml,target=pnpm-workspace.yaml \
  --mount=type=bind,source=patches,target=patches \
  pnpm --filter @immich/sdk install --frozen-lockfile && \
  pnpm --filter @immich/sdk build && \
  pnpm --filter @immich/sdk --filter @immich/plugin-sdk --filter @immich/plugin-core --filter @immich/plugin-gallery install --frozen-lockfile && \
  mise exec --no-deps --jobs=1 github:extism/js-pdk@1.6.0 -- \
    pnpm --filter @immich/plugin-sdk --filter @immich/plugin-core --filter @immich/plugin-gallery build

FROM ghcr.io/immich-app/base-server-prod:202607211135@sha256:ced131da7523544fe975cfd25abd67386e712e39496340b437cd95a08d0a18f3

WORKDIR /usr/src/app
ENV NODE_ENV=production \
  NVIDIA_DRIVER_CAPABILITIES=all \
  NVIDIA_VISIBLE_DEVICES=all

COPY --from=server /output/server-pruned ./server
COPY --from=web /usr/src/app/web/build /build/www
COPY --from=cli /output/cli-pruned ./cli
COPY --from=agent-runner /output/agent-runner-pruned ./agent-runner
COPY --from=plugins /app/packages/plugin-core/dist /build/plugins/immich-plugin-core/dist
COPY --from=plugins /app/packages/plugin-core/manifest.json /build/plugins/immich-plugin-core/manifest.json
COPY --from=plugins /app/packages/plugin-gallery/dist /build/plugins/gallery-core/dist
COPY --from=plugins /app/packages/plugin-gallery/manifest.json /build/plugins/gallery-core/manifest.json
RUN ln -s ../../cli/bin/immich server/bin/immich && \
  printf '%s\n' '#!/usr/bin/env bash' 'cd /usr/src/app/agent-runner' 'exec node src/server.mjs "$@"' > server/bin/agent-runner && \
  chmod +x server/bin/agent-runner
COPY LICENSE /licenses/LICENSE.txt
COPY LICENSE /LICENSE

ENV PATH="${PATH}:/usr/src/app/server/bin"

ARG BUILD_ID
ARG BUILD_IMAGE
ARG BUILD_SOURCE_REF
ARG BUILD_SOURCE_COMMIT

ENV IMMICH_BUILD=${BUILD_ID}
ENV IMMICH_BUILD_URL=https://github.com/immich-app/immich/actions/runs/${BUILD_ID}
ENV IMMICH_BUILD_IMAGE=${BUILD_IMAGE}
ENV IMMICH_BUILD_IMAGE_URL=https://github.com/immich-app/immich/pkgs/container/immich-server
ENV IMMICH_REPOSITORY=immich-app/immich
ENV IMMICH_REPOSITORY_URL=https://github.com/immich-app/immich
ENV IMMICH_SOURCE_REF=${BUILD_SOURCE_REF}
ENV IMMICH_SOURCE_COMMIT=${BUILD_SOURCE_COMMIT}
ENV IMMICH_SOURCE_URL=https://github.com/immich-app/immich/commit/${BUILD_SOURCE_COMMIT}

VOLUME /data
EXPOSE 2283
ENTRYPOINT ["tini", "--", "/bin/bash", "-c"]
CMD ["start.sh"]

HEALTHCHECK CMD immich-healthcheck
