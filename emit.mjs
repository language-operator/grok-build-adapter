/**
 * Grok Build emitter.
 *
 * Models go in $GROK_HOME/config.toml (runtime.json points GROK_HOME at
 * ${STATE_DIR}/grok). That is the only file that can carry a model's
 * `base_url`: the console-synced managed_config.toml beside it is deleted by
 * grok on a run without a deployment login, and the GROK_CONFIG /
 * GROK_CONFIG_PATH overlay drops `base_url` by design.
 *
 * config.toml is owned outright and rewritten on every seed, the same stance
 * opencode-adapter takes with opencode.jsonc. Anything written there at runtime
 * — a /model pick, grok's own markers — is reset on the next boot; grok
 * regenerates its markers itself. The runtime can only manage JSON key-by-key,
 * and this file is TOML, so per-key ownership is not available for it.
 *
 * MCP servers go where per-key ownership *is* available: the `mcpServers` key
 * of $HOME/.claude.json, which grok reads through its Claude Code
 * compatibility layer (shown as `[claude]` in `grok inspect`) and whose
 * `${NAME}` header references it expands. A server added with `grok mcp add`
 * lands in config.toml instead, so it is never touched here.
 *
 * What a gateway model needs to skip the browser sign-in entirely is a
 * `[model."<id>"]` entry with `base_url` and a credential, selected as
 * `[models] default`. Every model is pointed at the cluster gateway's
 * OpenAI-compatible endpoint, which aggregates all of them behind one URL.
 */

/**
 * A TOML basic string. JSON's escaping is valid TOML for everything JSON
 * escapes; TOML additionally forbids a raw DEL, which JSON leaves alone.
 */
const str = (s) => JSON.stringify(String(s)).replace(/\u007f/g, '\\u007f');

/** Keys are always quoted: model ids carry dots (`grok-4.20`), which a bare key would split. */
const key = str;

function table(name, entries) {
  const lines = [`[${name.map(key).join('.')}]`];
  for (const [k, v] of entries) {
    if (v === undefined || v === null) continue;
    lines.push(`${key(k)} = ${typeof v === 'boolean' ? String(v) : str(v)}`);
  }
  return lines.join('\n');
}

/**
 * The gateway credential, as grok should see it.
 *
 * With a per-agent key, `env_key` names the variable and grok reads it when it
 * sends a request, so the key never lands in config.toml on the workspace
 * volume. Without one — or on a base too old to render references — fall back
 * to the shared placeholder, which is not a secret: a missing gateway key costs
 * attribution and nothing else, so it should not fail the boot.
 */
function gatewayCredential(config, renderRef) {
  const ref = config.gateway.apiKeyRef;
  if (ref && renderRef) {
    const name = renderRef(ref, { path: 'gateway.apiKey', rewrite: (n) => n });
    if (name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return ['env_key', name];
  }
  return ['api_key', config.gateway.apiKey];
}

export function emit(config, { renderHeaders = null, renderRef = null } = {}) {
  const grokHome = `${config.paths.stateDir}/grok`;

  // An external server's headers go in as `${NAME}`, which grok expands from
  // its environment when it loads the server, so the token is never written to
  // disk. Rendering is all-or-nothing: a server whose headers cannot all be
  // rendered is left out (the helper warns) rather than configured without auth
  // to 401 unexplained. A base without the helper cannot honour headers at all;
  // failing the seed says so.
  const mcpServer = (tool) => {
    if (!tool.headers) return { type: 'http', url: tool.endpoint };
    if (!renderHeaders) {
      throw new Error(`tool '${tool.name}' has headers, which need coding-runtime's ctx.renderHeaders; rebuild on a base that provides it`);
    }
    const headers = renderHeaders(tool.headers, {
      path: `tools.${tool.name}`,
      rewrite: (name) => `\${${name}}`,
      clientSyntax: /\$\{/,
    });
    return headers ? { type: 'http', url: tool.endpoint, headers } : null;
  };

  const mcpServers = config.tools.map((tool) => [tool.name, mcpServer(tool)]).filter(([, server]) => server);

  // Auto-update stays off: the binary lives on the read-only root filesystem,
  // and the version is pinned by the image.
  const sections = [table(['cli'], [['auto_update', false]])];

  const primary = config.models.primary?.id;
  if (primary) {
    // session_summary too: it otherwise defaults to a built-in xAI model, and
    // every session title would be requested from the gateway under a name it
    // does not serve.
    sections.push(table(['models'], [['default', primary], ['session_summary', primary]]));
  }

  if (config.gateway) {
    const [credKey, credValue] = gatewayCredential(config, renderRef);
    for (const m of config.models.ordered) {
      sections.push(table(['model', m.id], [
        ['model', m.id],
        ['base_url', config.gateway.openaiBaseUrl],
        [credKey, credValue],
      ]));
    }
  }

  const writes = [
    {
      path: `${grokHome}/config.toml`,
      contents: `# Written by the Language Operator runtime on every start; edits here are reset.\n\n${sections.join('\n\n')}\n`,
    },
    // Supplied on every run, null included, so a tool the operator withdrew is
    // removed rather than lingering.
    {
      path: `${config.paths.home}/.claude.json`,
      values: { mcpServers: mcpServers.length > 0 ? Object.fromEntries(mcpServers) : null },
      owns: ['mcpServers'],
    },
  ];

  // Persona and instructions become a global rule, so the TUI opens with the
  // agent already briefed — no timing dependence on when the user first types.
  // Grok caps each rules file at 10,000 characters.
  const standing = [config.systemPrompt, config.instructions].filter(Boolean).join('\n\n');
  if (standing) writes.push({ path: `${grokHome}/rules/langop.md`, contents: `${standing}\n` });

  // The task itself, for a task-mode run: launch-grok-build-task sends it as
  // the one headless prompt.
  if (config.instructions) writes.push({ path: `${grokHome}/task.md`, contents: `${config.instructions}\n` });

  return writes;
}

export default emit;
