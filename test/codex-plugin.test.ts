import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(import.meta.dirname, '..');

function readJson(relPath: string): any {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), 'utf-8'));
}

describe('Codex plugin packaging', () => {
  it('declares Codex plugin metadata and entry points', () => {
    const manifestPath = join(REPO_ROOT, '.codex-plugin/plugin.json');
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = readJson('.codex-plugin/plugin.json');

    expect(manifest.name).toBe('episodic-memory');
    expect(manifest.version).toBe(readJson('package.json').version);
    expect(manifest.skills).toBe('./skills/');
    expect(manifest.hooks).toBe('./hooks/hooks.json');
    expect(manifest.mcpServers).toBe('./.mcp.json');
    expect(manifest.interface.displayName).toBe('Episodic Memory');
    expect(manifest.interface.shortDescription).toContain('conversation memory');
  });

  it('defines a relative MCP server command for Codex', () => {
    const mcpPath = join(REPO_ROOT, '.mcp.json');
    expect(existsSync(mcpPath)).toBe(true);

    const mcp = readJson('.mcp.json');
    expect(mcp).toEqual({
      mcpServers: {
        'episodic-memory': {
          command: 'node',
          args: ['./cli/mcp-server-wrapper.js'],
          cwd: '.',
          env_vars: [
            'EPISODIC_MEMORY_CONFIG_DIR',
            'PERSONAL_SUPERPOWERS_DIR',
            'XDG_CONFIG_HOME',
            'EPISODIC_MEMORY_DB_PATH',
            'CONVERSATION_SEARCH_EXCLUDE_PROJECTS'
          ]
        }
      }
    });
  });

  it('declares a Codex marketplace for local install testing', () => {
    const marketplacePath = join(REPO_ROOT, '.agents/plugins/marketplace.json');
    expect(existsSync(marketplacePath)).toBe(true);

    const marketplace = readJson('.agents/plugins/marketplace.json');
    expect(marketplace.name).toBe('episodic-memory-dev');
    expect(marketplace.plugins).toContainEqual({
      name: 'episodic-memory',
      source: {
        source: 'url',
        url: './'
      },
      policy: {
        installation: 'AVAILABLE',
        authentication: 'ON_USE'
      }
    });
  });

  it('includes Codex manifest in version bump config', () => {
    const bump = readJson('.version-bump.json');
    expect(bump.files).toContainEqual({
      path: '.codex-plugin/plugin.json',
      field: 'version'
    });
  });
});
