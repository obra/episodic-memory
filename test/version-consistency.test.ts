import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { VERSION } from '../src/version.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relPath: string): any {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), 'utf-8'));
}

describe('version sources of truth', () => {
  // package.json is THE source. Every other version field must equal it.
  const pkg = readJson('package.json');

  it('VERSION constant in src/version.ts equals package.json version', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('.claude-plugin/plugin.json version equals package.json version', () => {
    const plugin = readJson('.claude-plugin/plugin.json');
    expect(plugin.version).toBe(pkg.version);
  });

  it('.claude-plugin/marketplace.json plugins[0].version equals package.json version', () => {
    const marketplace = readJson('.claude-plugin/marketplace.json');
    expect(marketplace.plugins[0].version).toBe(pkg.version);
  });
});
