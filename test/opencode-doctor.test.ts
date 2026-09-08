import { describe, expect, it } from 'vitest';
import { buildOpencodeDoctorReport } from '../src/doctor.js';

describe('opencode doctor report', () => {
  it('reports plugin, MCP, database, transcript, and log state', () => {
    const report = buildOpencodeDoctorReport({
      opencodeVersionOutput: '1.17.8',
      debugConfigOutput: JSON.stringify({
        plugin: ['episodic-memory'],
        mcp: {
          'episodic-memory': {
            type: 'local',
            command: ['episodic-memory-mcp-server'],
            enabled: true,
          },
        },
      }),
      dbPath: '/tmp/opencode/opencode.db',
      dbExists: true,
      transcriptDir: '/tmp/superpowers/opencode-transcripts',
      transcriptDirExists: true,
      logPath: '/tmp/superpowers/logs/episodic-memory.log',
    });

    expect(report.ok).toBe(true);
    expect(report.text).toContain('opencode version: 1.17.8 (found)');
    expect(report.text).toContain('opencode plugin: configured');
    expect(report.text).toContain('Episodic Memory MCP: enabled');
    expect(report.text).toContain('/tmp/superpowers/logs/episodic-memory.log');
  });

  it('reports missing setup pieces', () => {
    const report = buildOpencodeDoctorReport({
      opencodeVersionOutput: '',
      debugConfigOutput: JSON.stringify({ plugin: [], mcp: {} }),
      dbPath: '/tmp/opencode/opencode.db',
      dbExists: false,
      transcriptDir: '/tmp/superpowers/opencode-transcripts',
      transcriptDirExists: false,
      logPath: '/tmp/superpowers/logs/episodic-memory.log',
    });

    expect(report.ok).toBe(false);
    expect(report.text).toContain('opencode was not found');
    expect(report.text).toContain('add "episodic-memory"');
    expect(report.text).toContain('start at least one opencode session');
    expect(report.text).toContain('MCP server is not enabled');
  });
});
