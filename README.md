# grok-build-adapter

The **Grok Build** runtime for the [Language Operator](https://github.com/language-operator/language-operator),
running as a native Kubernetes workload.

It builds the runtime image and the Helm chart that registers the `grok-build`
`LanguageAgentRuntime`. The [Grok Build](https://github.com/xai-org/grok-build) TUI
(`grok`) runs inside tmux and is fronted by an xterm.js / WebSocket terminal in the
browser, so working with the agent feels like a real terminal session.

This repository was created from the [`opencode-adapter`](https://github.com/language-operator/opencode-adapter) template.

> **Status:** pre-release. Gateway models, MCP tools, instructions and task mode are
> wired and checked against the grok binary; in-cluster acceptance and the first release
> are tracked in [#1](https://github.com/language-operator/grok-build-adapter/issues/1).

## Architecture

The image is [`coding-runtime`](https://github.com/language-operator/coding-runtime)
plus the Grok Build CLI (npm `@xai-official/grok`, which ships the native binary). The
base owns the OS layer, the web terminal (xterm.js over a node-pty WebSocket bridge,
with a cross-origin guard and a 25s keepalive), `tini`, and the ETL that turns the
operator's `/etc/agent/config.yaml` into a normalized config. What lives here is the
files that describe Grok Build to it:

- **`runtime.json`** — the manifest: where config goes (`GROK_HOME=$STATE_DIR/grok`),
  the serving surface, how tmux launches the TUI, and the task-mode command.
- **`emit.mjs`** — the emitter: normalized config → Grok Build's config.
  - `$GROK_HOME/config.toml`: every gateway model as an OpenAI-compatible BYOK model
    (`base_url` + `env_key`), the primary as the default. With that, grok never shows
    xAI's sign-in screen.
  - `$HOME/.claude.json` `mcpServers`: the agent's MCP tools, which grok reads through
    its Claude Code compatibility layer. Header references become `${NAME}`, which grok
    expands from its environment, so tokens never reach the disk.
  - `$GROK_HOME/rules/langop.md`: persona and instructions, loaded as a global rule.
- **`launch-grok-build.sh`** — what tmux runs. The base has already set the working
  directory (the cloned repo when the agent sets `spec.repository`, else
  `/workspace`), so it opens that project directly, and passes `--continue` once the
  directory has a conversation, so a slept-and-woken agent resumes instead of opening
  blank.
- **`launch-grok-build-task.sh`** — for `spec.execution.mode: task`: sends the agent's
  instructions as one headless prompt (`grok -p … --always-approve`) and exits with
  grok's code — 0 on success, 1 on a model or gateway error.

One container, running the base entrypoint: resolve the environment, seed config,
serve. Seeding runs in the agent container rather than an init container because
the operator mounts `/tmp` there only, so the two would share no writable path.
tmux keeps the session alive across browser reconnects.

## Install

Prerequisite: the [`language-operator`](https://github.com/language-operator/language-operator)
chart must be installed first — it provides the `LanguageAgentRuntime` CRD.

```bash
helm install grok-build oci://ghcr.io/language-operator/charts/grok-build \
  --namespace language-operator
```

Then reference it from a `LanguageAgent`:

```yaml
apiVersion: langop.io/v1alpha1
kind: LanguageAgent
metadata:
  name: my-agent
spec:
  runtime: grok-build
```

## Authentication

The runtime sets `auth.enabled: true`, so access is gated entirely by the cluster's
OIDC proxy: when the `LanguageCluster` has auth enabled the operator injects an
oauth2-proxy sidecar in front of the terminal. There is no built-in password — if
the cluster does not enable auth, the terminal is exposed unauthenticated on its
ingress. Grok Build itself needs no xAI login: it reaches the cluster model gateway as a
custom OpenAI-compatible endpoint, using the per-agent key in `MODEL_API_KEY` when the
deployment supplies one and the gateway's shared placeholder otherwise.

## Development

```bash
make build      # docker build -t ghcr.io/language-operator/grok-build-adapter:latest .
make test       # build, then run the coding-runtime conformance suite
make test-emitter  # unit-test emit.mjs (no Docker)
make publish    # build and push the image to ghcr.io
make dev        # build, import into k3s, and upgrade the runtime release (inner loop)

helm lint chart
helm template grok-build chart
```

## CI

- `build-image.yaml` — builds and pushes the image to `ghcr.io` on push to `main` and `v*` tags.
- `release-chart.yaml` — packages `chart/` and pushes it to `oci://ghcr.io/language-operator/charts`.
- `test.yaml` — builds the image, runs the `coding-runtime` conformance suite against
  it under the operator's posture (read-only root, uid 1000, all capabilities dropped),
  and lints/templates the chart on every PR. The suite is taken out of the image rather
  than fetched, so the checks always match the runtime being checked, and no failures are
  tolerated. A third job unit-tests the emitter.
