import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSummarizerQueryOptions } from '../src/summarizer.js';

describe('isolated Claude summarizer authentication', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'episodic-auth-settings-'));
    vi.stubEnv('CLAUDE_CONFIG_DIR', root);
    vi.stubEnv('ANTHROPIC_BASE_URL', undefined);
    vi.stubEnv('EPISODIC_MEMORY_API_BASE_URL', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps the user credential helper and endpoint without loading behavior settings', () => {
    writeFileSync(join(root, 'settings.json'), JSON.stringify({
      apiKeyHelper: 'existing-credential-helper',
      env: { ANTHROPIC_BASE_URL: 'https://fixture.invalid/api', UNRELATED: 'excluded' },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'must-not-run' }] }] },
      enabledPlugins: { 'fixture@marketplace': true },
      permissions: { allow: ['Bash(*)'] },
      model: 'must-not-select',
    }));

    const options = buildSummarizerQueryOptions({ model: 'haiku' });
    expect(options.settings).toEqual({ apiKeyHelper: 'existing-credential-helper' });
    expect(options.env).toMatchObject({ ANTHROPIC_BASE_URL: 'https://fixture.invalid/api' });
    expect((options.env as Record<string, unknown>).UNRELATED).toBeUndefined();
    expect(options.settingSources).toEqual([]);
    expect(options.tools).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.persistSession).toBe(false);
    expect(options.model).toBe('haiku');
  });

  it('preserves explicit inherited and episodic endpoint overrides', () => {
    writeFileSync(join(root, 'settings.json'), JSON.stringify({
      env: { ANTHROPIC_BASE_URL: 'https://settings.invalid' },
    }));
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://inherited.invalid');
    expect(buildSummarizerQueryOptions({ model: 'haiku' }).env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://inherited.invalid',
    });
    vi.stubEnv('EPISODIC_MEMORY_API_BASE_URL', 'https://explicit.invalid');
    expect(buildSummarizerQueryOptions({ model: 'haiku' }).env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://explicit.invalid',
    });
  });

  it('leaves native environment and OAuth authentication available when settings are absent', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-fixture-value');
    const options = buildSummarizerQueryOptions({ model: 'haiku' });
    expect(options.settings).toBeUndefined();
    expect(options.env).toMatchObject({ ANTHROPIC_API_KEY: 'synthetic-fixture-value' });
    expect(options.settingSources).toEqual([]);
  });

  it('refuses malformed authentication settings without exposing their contents', () => {
    writeFileSync(join(root, 'settings.json'), '{"apiKeyHelper":"PRIVATE_FIXTURE_VALUE",');
    expect(() => buildSummarizerQueryOptions({ model: 'haiku' }))
      .toThrow(/^Cannot read Claude summarizer authentication settings$/);
  });
});
