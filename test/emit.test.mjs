// Unit tests for emit.mjs. The emitter is a pure function of (config, ctx), so
// it is exercised here with hand-built normalized configs (docs/config-schema.md
// in coding-runtime) and a ctx that follows coding-runtime's renderHeaders /
// renderRef contract: `$(NAME)` is rewritten when NAME is set, and the whole
// value is refused (null) when it is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emit } from '../emit.mjs';

const ENV = { MODEL_API_KEY: 'sk-agent', EXT_TOKEN: 'tok' };
const REF = /\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g;

function render(value, rewrite) {
  for (const [, name] of String(value).matchAll(REF)) if (!ENV[name]) return null;
  return String(value).replace(REF, (_, name) => rewrite(name));
}

const ctx = {
  renderRef: (value, { rewrite }) => render(value, rewrite),
  renderHeaders: (headers, { rewrite }) => {
    const out = {};
    for (const [k, v] of Object.entries(headers)) {
      out[k] = render(v, rewrite);
      if (out[k] === null) return null;
    }
    return out;
  },
};

function config(overrides = {}) {
  const models = [{ id: 'claude-sonnet-4-5' }, { id: 'grok-4.20-0309-reasoning' }];
  return {
    instructions: 'Fix the build.',
    systemPrompt: 'Tone: terse.',
    gateway: {
      openaiBaseUrl: 'http://gateway.default.svc.cluster.local:8000/v1',
      apiKey: 'sk-langop-proxy',
      apiKeyRef: '$(MODEL_API_KEY)',
    },
    models: { primary: models[0], ordered: models },
    tools: [],
    paths: { stateDir: '/workspace/.state', home: '/workspace/.home' },
    ...overrides,
  };
}

const byName = (writes) => Object.fromEntries(writes.map((w) => [w.path.split('/').pop(), w]));

test('models point at the gateway, credential by env reference', () => {
  const { 'config.toml': toml } = byName(emit(config(), ctx));
  assert.equal(toml.path, '/workspace/.state/grok/config.toml');
  assert.match(toml.contents, /^\["models"\]\n"default" = "claude-sonnet-4-5"\n"session_summary" = "claude-sonnet-4-5"$/m);
  // A dotted id stays one key.
  assert.match(toml.contents, /^\["model"\."grok-4\.20-0309-reasoning"\]$/m);
  assert.match(toml.contents, /^"base_url" = "http:\/\/gateway\.default\.svc\.cluster\.local:8000\/v1"$/m);
  assert.match(toml.contents, /^"env_key" = "MODEL_API_KEY"$/m);
  assert.doesNotMatch(toml.contents, /sk-agent|api_key/);
  assert.match(toml.contents, /^\["cli"\]\n"auto_update" = false$/m);
});

test('without a per-agent key, the shared placeholder is used', () => {
  const c = config();
  c.gateway.apiKeyRef = null;
  const { 'config.toml': toml } = byName(emit(c, ctx));
  assert.match(toml.contents, /^"api_key" = "sk-langop-proxy"$/m);
  assert.doesNotMatch(toml.contents, /env_key/);
});

test('an unset key reference falls back to the placeholder', () => {
  const c = config();
  c.gateway.apiKeyRef = '$(UNSET_KEY)';
  assert.match(byName(emit(c, ctx))['config.toml'].contents, /^"api_key" = "sk-langop-proxy"$/m);
});

test('strings are escaped for TOML', () => {
  const c = config({ models: { primary: { id: 'a"b\\c\u007f' }, ordered: [{ id: 'a"b\\c\u007f' }] } });
  const { contents } = byName(emit(c, ctx))['config.toml'];
  assert.match(contents, /^"default" = "a\\"b\\\\c\\u007f"$/m);
  assert.match(contents, /^\["model"\."a\\"b\\\\c\\u007f"\]$/m);
});

test('no gateway and no models leaves only [cli]', () => {
  const c = config({ gateway: null, models: { primary: null, ordered: [] } });
  const { contents } = byName(emit(c, ctx))['config.toml'];
  assert.doesNotMatch(contents, /\["models?"/);
  assert.match(contents, /\["cli"\]/);
});

test('MCP servers are managed in ~/.claude.json, headers as ${NAME}', () => {
  const tools = [
    { name: 'a-tool', endpoint: 'http://a-tool.tools.svc.cluster.local:8080/mcp', headers: null },
    { name: 'ext', endpoint: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer $(EXT_TOKEN)' } },
    { name: 'broken', endpoint: 'https://mcp.example.com/x', headers: { Authorization: 'Bearer $(UNSET)' } },
  ];
  const { '.claude.json': json } = byName(emit(config({ tools }), ctx));
  assert.equal(json.path, '/workspace/.home/.claude.json');
  assert.deepEqual(json.owns, ['mcpServers']);
  assert.deepEqual(json.values.mcpServers, {
    'a-tool': { type: 'http', url: 'http://a-tool.tools.svc.cluster.local:8080/mcp' },
    ext: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${EXT_TOKEN}' } },
  });
});

test('no tools still states the key, as null', () => {
  assert.deepEqual(byName(emit(config(), ctx))['.claude.json'].values, { mcpServers: null });
});

test('a header-bearing tool without renderHeaders fails the seed', () => {
  const tools = [{ name: 'ext', endpoint: 'https://x/mcp', headers: { A: 'b' } }];
  assert.throws(() => emit(config({ tools }), {}), /renderHeaders/);
});

test('instructions become a rule and the task prompt', () => {
  const w = byName(emit(config(), ctx));
  assert.equal(w['langop.md'].path, '/workspace/.state/grok/rules/langop.md');
  assert.equal(w['langop.md'].contents, 'Tone: terse.\n\nFix the build.\n');
  assert.equal(w['task.md'].path, '/workspace/.state/grok/task.md');
  assert.equal(w['task.md'].contents, 'Fix the build.\n');
});

test('no instructions writes no task, and no persona or instructions no rule', () => {
  const w = byName(emit(config({ instructions: null, systemPrompt: null }), ctx));
  assert.equal(w['task.md'], undefined);
  assert.equal(w['langop.md'], undefined);
});
