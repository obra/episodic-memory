import { describe, expect, it } from 'vitest';
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
    });

    expect(report.ok).toBe(true);
    expect(report.text).toContain('Codex version: codex-cli 0.130.0 (ok; minimum 0.130.0)');
    expect(report.text).toContain('Plugin hooks feature: enabled');
    expect(report.text).toContain('Episodic Memory MCP: enabled');
    expect(report.text).toContain('/hooks');
    expect(report.text).toContain('/tmp/superpowers/logs/episodic-memory.log');
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
    });

    expect(report.ok).toBe(false);
    expect(report.text).toContain('minimum 0.130.0');
    expect(report.text).toContain('codex update');
  });
});
