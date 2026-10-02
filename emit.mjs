/**
 * Grok Build emitter — placeholder.
 *
 * Grok Build reads its configuration from $GROK_HOME (set in runtime.json to
 * ${STATE_DIR}/grok): config.toml for the provider (`base_url`, `env_key`,
 * `model`), plus its MCP setup. The translation from the normalized operator
 * config into those files is issue #1, which first has to confirm that Grok
 * Build runs against a custom base_url with no xAI login, and what shape its
 * MCP configuration takes.
 *
 * Until then this writes nothing. `emit` stays a pure function of
 * `(config, ctx)` returning descriptors, so #1 only has to fill in the body.
 */

export function emit() {
  return [];
}

export default emit;
