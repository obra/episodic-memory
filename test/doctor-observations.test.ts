import { describe, expect, it } from 'vitest';
import { captureNative, pluginMcpDeclaration } from '../src/doctor-observations.js';

describe('native doctor observations', () => {
  it('returns no apparent absence on a failed or timed-out command', () => {
    const timeout = Object.assign(new Error('test timeout'), { code: 'ETIMEDOUT' });
    const fake = ((..._args: any[]) => ({ error: timeout, status: null, stdout: 'stale' })) as any;
    expect(captureNative('native', [], process.env, fake)).toEqual({ output: '', failure: 'timeout' });
    const failed = ((..._args: any[]) => ({ status: 1, stdout: 'partial', stderr: 'failed' })) as any;
    expect(captureNative('native', [], process.env, failed)).toEqual({ output: '', failure: 'exit 1' });
  });

  it('keeps stderr out of successful structured stdout and closes input', () => {
    let options: any;
    const fake = ((_command: any, _args: any, supplied: any) => {
      options = supplied;
      return { status: 0, stdout: '{"installed":[]}', stderr: 'warning' };
    }) as any;
    expect(captureNative('native', [], process.env, fake).output).toBe('{"installed":[]}');
    expect(options.stdio[0]).toBe('ignore');
    expect(options.timeout).toBe(10000);
  });

  it('uses native materialized details, independent of marketplace, version or source path', () => {
    const id = 'episodic-memory@alternative';
    const plugin = { summary: { id, name: 'episodic-memory', installed: true, enabled: true,
      source: { type: 'local', path: '/not-the-installed-artifact' } }, mcpServers: ['episodic-memory'] };
    expect(pluginMcpDeclaration({ plugin }, id)).toBe(true);
    expect(pluginMcpDeclaration({ plugin: { ...plugin, mcpServers: [] } }, id)).toBe(false);
    expect(pluginMcpDeclaration({ installed: [plugin.summary] }, id)).toBeUndefined();
    expect(pluginMcpDeclaration({ plugin }, 'episodic-memory@different')).toBeUndefined();
    expect(pluginMcpDeclaration({ plugin: { ...plugin, summary: { ...plugin.summary, enabled: false } } }, id)).toBe(false);
    expect(pluginMcpDeclaration({ plugin: { ...plugin, mcpServers: null } }, id)).toBeUndefined();
  });
});
