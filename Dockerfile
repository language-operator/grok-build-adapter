# -----------------------------------------------------------------------------
# Grok Build adapter.
#
# The OS layer, the web terminal, tini, and the /etc/agent/config.yaml ETL all
# live in coding-runtime. What is left here is the Grok Build CLI plus the three
# files that describe it to the base: a manifest, an emitter, and a launcher.
#
# The base is pinned by tag *and* digest. Never :latest, and never a `main`
# build — metadata-action stamps those with the version literal `main`, which no
# `requires.codingRuntime` range can satisfy, so every boot would warn about a
# version mismatch that is not real.
# -----------------------------------------------------------------------------
ARG BASE=ghcr.io/language-operator/coding-runtime:0.1.4@sha256:2f31ef9b04e72bec3a4bb79db59a82a4aa74f89538cfc118d75e0a852734b0aa
ARG GROK_VERSION=1.0.46

FROM ${BASE}
ARG GROK_VERSION

# Grok Build CLI (TUI). The npm package carries the native binary in a
# per-platform optional dependency, and its postinstall points the global
# `grok` bin at the extracted binary, so nothing is fetched at runtime. Pinned —
# do not track `latest`, so runtime behaviour is reproducible.
#
# The postinstall also writes a copy of the binary and a config.toml under
# root's ~/.grok. Nothing runs as root, so that is dead weight; drop it.
USER root
RUN npm install -g --no-audit --no-fund "@xai-official/grok@${GROK_VERSION}" \
    && npm cache clean --force \
    && rm -rf /root/.grok

# runtime.json       — what this adapter is: config dir, serving surface, tmux launch.
# emit.mjs           — normalized operator config -> Grok Build config.
# launch-grok-build  — what tmux runs inside the terminal.
COPY runtime.json /etc/coding-runtime/runtime.json
COPY emit.mjs /opt/adapter/emit.mjs
COPY --chmod=755 launch-grok-build.sh /usr/local/bin/launch-grok-build

# The operator pins the agent container to uid 1000 with no override, and the
# base already has a matching passwd entry. Do not create a user here.
USER node
