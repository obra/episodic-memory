import { describe, expect, it } from 'vitest';
import { trustStateFromHooksList } from '../src/codex-hook-trust.js';
import { buildCodexDoctorReport } from '../src/doctor.js';

describe('Codex doctor report', () => {
  it('reports the production support floor, plugin hook state, MCP state, and log path', () => {
    const report = buildCodexDoctorReport({
      codexVersionOutput: 'codex-cli 0.130.0',
      featuresOutput: 'hooks stable true\nplugin_hooks under development true\nplugins stable true\n',
      mcpListOutput: 'episodic-memory  node  ./cli/mcp-server-wrapper.js  enabled',
      codexHome: '/tmp/codex-home',
      sessionsDirExists: true,
      logPath: '/tmp/superpowers/logs/episodic-memory.log',
      dbPath: '/tmp/superpowers/conversation-index/db.sqlite',
      hookTrustState: 'trusted',
    });

    expect(report.ok).toBe(true);
    expect(report.text).toContain('Codex version: codex-cli 0.130.0 (ok; minimum 0.130.0)');
    expect(report.text).toContain('Hooks feature: enabled');
    expect(report.text).toContain('Episodic Memory MCP: enabled');
    expect(report.text).toContain('Hook trust: trusted');
    expect(report.text).toContain('/tmp/superpowers/logs/episodic-memory.log');
  });

  it('does not tell users to trust hooks when the Episodic Memory hook is already trusted', () => {
    const report = buildCodexDoctorReport({
      codexVersionOutput: 'codex-cli 0.130.0',
      featuresOutput: 'hooks stable true\nplugin_hooks under development true\nplugins stable true\n',
      mcpListOutput: 'episodic-memory  node  ./cli/mcp-server-wrapper.js  enabled',
      codexHome: '/tmp/codex-home',
      sessionsDirExists: true,
      logPath: '/tmp/superpowers/logs/episodic-memory.log',
      dbPath: '/tmp/superpowers/conversation-index/db.sqlite',
      hookTrustState: 'trusted',
    });

    expect(report.ok).toBe(true);
    expect(report.text).toContain('Hook trust: trusted');
    expect(report.text).not.toContain('/hooks');
  });

  it('tells users to trust hooks when the Episodic Memory hook is untrusted', () => {
    const report = buildCodexDoctorReport({
      codexVersionOutput: 'codex-cli 0.130.0',
      featuresOutput: 'hooks stable true\nplugin_hooks under development true\nplugins stable true\n',
      mcpListOutput: 'episodic-memory  node  ./cli/mcp-server-wrapper.js  enabled',
      codexHome: '/tmp/codex-home',
      sessionsDirExists: true,
      logPath: '/tmp/superpowers/logs/episodic-memory.log',
      dbPath: '/tmp/superpowers/conversation-index/db.sqlite',
      hookTrustState: 'untrusted',
    });

    expect(report.ok).toBe(false);
    expect(report.text).toContain('Hook trust: untrusted');
    expect(report.text).toContain('/hooks');
  });

  it('fails when Codex is below the support floor', () => {
    const report = buildCodexDoctorReport({
      codexVersionOutput: 'codex-cli 0.129.9',
      featuresOutput: '',
      mcpListOutput: '',
      codexHome: '/tmp/codex-home',
      sessionsDirExists: false,
      logPath: '/tmp/superpowers/logs/episodic-memory.log',
      dbPath: '/tmp/superpowers/conversation-index/db.sqlite',
      hookTrustState: 'trusted',
    });

    expect(report.ok).toBe(false);
    expect(report.text).toContain('minimum 0.130.0');
    expect(report.text).toContain('codex update');
  });

  it('reads Episodic Memory hook trust from Codex hooks/list results', () => {
    expect(trustStateFromHooksList({
      data: [{
        hooks: [{
          pluginId: 'episodic-memory@episodic-memory-dev',
          key: 'episodic-memory@episodic-memory-dev:hooks/hooks.json:session_start:0:0',
          trustStatus: 'trusted',
        }],
      }],
    })).toBe('trusted');

    expect(trustStateFromHooksList({
      data: [{
        hooks: [{
          pluginId: 'episodic-memory@episodic-memory-dev',
          key: 'episodic-memory@episodic-memory-dev:hooks/hooks.json:session_start:0:0',
          trustStatus: 'untrusted',
        }],
      }],
    })).toBe('untrusted');

    expect(trustStateFromHooksList({
      data: [{
        hooks: [{
          pluginId: 'episodic-memory@episodic-memory-dev',
          key: 'episodic-memory@episodic-memory-dev:hooks/hooks.json:session_start:0:0',
          trustStatus: 'modified',
        }],
      }],
    })).toBe('modified');
  });

  const modernInputs = {
    codexVersionOutput: 'codex-cli 0.159.3',
    featuresOutput: 'hooks stable true\nplugin_hooks removed false\nplugins stable true\n',
    mcpListOutput: '',
    pluginListOutput: JSON.stringify({ installed: [{
      pluginId: 'episodic-memory@different-market', name: 'episodic-memory',
      version: '9.0.0', installed: true, enabled: true,
      source: { source: 'local', path: '/alternative/plugin' },
    }] }),
    pluginMcpDeclared: true,
    codexHome: '/alternative/codex-home',
    sessionsDirExists: true,
    logPath: '/alternative/log', dbPath: '/alternative/db',
    hookTrustState: 'trusted' as const,
    hookEnabledState: 'disabled' as const,
  };

  it('accepts declared plugin MCP without obsolete feature or duplicate registration advice', () => {
    const report = buildCodexDoctorReport(modernInputs);
    expect(report.ok).toBe(true);
    expect(report.text).toContain('Plugin MCP: declared');
    expect(report.text).toContain('Hook execution: disabled');
    expect(report.text).toContain('MCP runtime: not probed');
    expect(report.text).not.toContain('enable plugin_hooks');
    expect(report.text).not.toContain('not enabled in codex mcp list');
    expect(report.text).not.toContain('press t');
  });

  it('distinguishes disabled plugin and failed registry observation from confirmed absence', () => {
    const disabled = buildCodexDoctorReport({ ...modernInputs, pluginListOutput: JSON.stringify({
      installed: [{ name: 'episodic-memory', installed: true, enabled: false }],
    }) });
    expect(disabled.ok).toBe(false);
    expect(disabled.text).toContain('Plugin registry: disabled');
    const unknown = buildCodexDoctorReport({ ...modernInputs, pluginListOutput: 'not json',
      observationFailures: ['plugin registry (timeout)'],
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.text).toContain('Plugin registry: unknown');
    expect(unknown.text).not.toContain('Plugin registry: missing');
  });

  it('does not present failed feature or MCP inspections as disabled or missing', () => {
    const report = buildCodexDoctorReport({ ...modernInputs, featuresOutput: '', mcpListOutput: '',
      observationFailures: ['features (failed)', 'MCP list (timeout)'],
    });
    expect(report.ok).toBe(false);
    expect(report.text).toContain('Hooks feature: unknown');
    expect(report.text).toContain('Explicit MCP: unknown');
    expect(report.text).not.toContain('features enable');
  });

  it('does not recommend trusting a deliberately disabled hook', () => {
    const report = buildCodexDoctorReport({ ...modernInputs, hookTrustState: 'modified' });
    expect(report.ok).toBe(true);
    expect(report.text).toContain('Hook execution: disabled');
    expect(report.text).not.toContain('press t');
  });

  it('does not require the explicit-registry fallback for a declared native plugin', () => {
    const report = buildCodexDoctorReport({ ...modernInputs, mcpListInspected: false });
    expect(report.ok).toBe(true);
    expect(report.text).toContain('Explicit MCP: not inspected');
  });

  it('does not let a trusted inactive copy mask an active modified hook', () => {
    expect(trustStateFromHooksList({ data: [{ hooks: [
      { pluginId: 'episodic-memory@old', enabled: false, trustStatus: 'trusted' },
      { pluginId: 'episodic-memory@active', enabled: true, trustStatus: 'modified' },
    ] }] })).toBe('modified');
  });
});
