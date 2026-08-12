import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { findMissingDeps, REQUIRED_PACKAGES } from '../cli/install-check.js';

function stagePackage(nodeModules: string, name: string, manifest: object = { name, version: '0.0.0' }): void {
  const dir = join(nodeModules, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest), 'utf-8');
}

describe('findMissingDeps — wrapper install-health probe (#95 Bug 1)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-install-check-'));
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('returns the full required-packages list when node_modules is missing entirely', () => {
    const missing = findMissingDeps(testDir);
    expect(missing).toEqual([...REQUIRED_PACKAGES]);
  });

  it('returns the full list when node_modules is empty (recently-created folder)', () => {
    mkdirSync(join(testDir, 'node_modules'), { recursive: true });
    expect(findMissingDeps(testDir)).toEqual([...REQUIRED_PACKAGES]);
  });

  it('returns an empty list when every required package has a package.json', () => {
    const nodeModules = join(testDir, 'node_modules');
    mkdirSync(nodeModules, { recursive: true });
    for (const pkg of REQUIRED_PACKAGES) {
      stagePackage(nodeModules, pkg);
    }
    expect(findMissingDeps(testDir)).toEqual([]);
  });

  it('flags the partial-extraction case where a package directory exists but its package.json is missing (the reporter\'s exact failure on Windows 11)', () => {
    const nodeModules = join(testDir, 'node_modules');
    mkdirSync(nodeModules, { recursive: true });
    for (const pkg of REQUIRED_PACKAGES) {
      stagePackage(nodeModules, pkg);
    }
    // Simulate the bug from #95: better-sqlite3 directory exists with `deps/` and `LICENSE` but no package.json.
    const broken = join(nodeModules, 'better-sqlite3');
    rmSync(join(broken, 'package.json'));
    mkdirSync(join(broken, 'deps'), { recursive: true });
    writeFileSync(join(broken, 'LICENSE'), 'MIT', 'utf-8');

    expect(findMissingDeps(testDir)).toEqual(['better-sqlite3']);
  });

  it('returns multiple missing packages so the operator can see the full scope of damage in one log line', () => {
    const nodeModules = join(testDir, 'node_modules');
    mkdirSync(nodeModules, { recursive: true });
    // Only stage two of the required packages, leaving the rest missing.
    stagePackage(nodeModules, '@anthropic-ai/claude-agent-sdk');
    stagePackage(nodeModules, 'sqlite-vec');

    const missing = findMissingDeps(testDir);
    expect(missing).toContain('better-sqlite3');
    expect(missing).toContain('@huggingface/transformers');
    expect(missing).toContain('onnxruntime-node');
    expect(missing).not.toContain('@anthropic-ai/claude-agent-sdk');
    expect(missing).not.toContain('sqlite-vec');
  });

  it('treats a package npm nested under its dependent as installed, not missing (#105)', () => {
    const nodeModules = join(testDir, 'node_modules');
    mkdirSync(nodeModules, { recursive: true });
    for (const pkg of REQUIRED_PACKAGES) {
      stagePackage(nodeModules, pkg);
    }
    // Reproduce the real layout: a version conflict stops npm hoisting
    // onnxruntime-node, so it lands under @huggingface/transformers instead.
    rmSync(join(nodeModules, 'onnxruntime-node'), { recursive: true, force: true });
    stagePackage(
      join(nodeModules, '@huggingface', 'transformers', 'node_modules'),
      'onnxruntime-node'
    );

    // Node's resolver finds it there, so the wrapper must not reinstall on
    // every launch — that reinstall is what trips the 30s MCP connect timeout.
    expect(findMissingDeps(testDir)).toEqual([]);
  });

  it('still flags a nested package whose manifest is missing (partial extraction, one level down)', () => {
    const nodeModules = join(testDir, 'node_modules');
    mkdirSync(nodeModules, { recursive: true });
    for (const pkg of REQUIRED_PACKAGES) {
      stagePackage(nodeModules, pkg);
    }
    rmSync(join(nodeModules, 'onnxruntime-node'), { recursive: true, force: true });
    // Directory exists nested, but no package.json — same damage as #95.
    mkdirSync(
      join(nodeModules, '@huggingface', 'transformers', 'node_modules', 'onnxruntime-node'),
      { recursive: true }
    );

    expect(findMissingDeps(testDir)).toEqual(['onnxruntime-node']);
  });

  it('does not require optional / OS-specific deps (sharp, fsevents) — those are excluded by design', () => {
    const nodeModules = join(testDir, 'node_modules');
    mkdirSync(nodeModules, { recursive: true });
    for (const pkg of REQUIRED_PACKAGES) {
      stagePackage(nodeModules, pkg);
    }
    // sharp and fsevents are NOT staged — should still report no missing deps.
    expect(findMissingDeps(testDir)).toEqual([]);
    expect(REQUIRED_PACKAGES).not.toContain('sharp');
    expect(REQUIRED_PACKAGES).not.toContain('fsevents');
  });
});
