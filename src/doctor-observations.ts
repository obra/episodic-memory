import { spawnSync } from 'child_process';

export interface NativeObservation {
  output: string;
  failure?: string;
}

export function captureNative(
  command: string, args: string[], env = process.env, execute = spawnSync
): NativeObservation {
  const result = execute(command, args, {
    encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'], env,
  });
  if (result.error) {
    return { output: '', failure: (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
      ? 'timeout' : 'unavailable' };
  }
  if (result.status !== 0) return { output: '', failure: `exit ${result.status ?? 'unknown'}` };
  return { output: String(result.stdout ?? '').trim() };
}

/** Trust the native materialized plugin detail, not a mutable source directory or inferred cache path. */
export function pluginMcpDeclaration(detail: unknown, expectedId: string): boolean | undefined {
  if (typeof detail !== 'object' || detail === null) return undefined;
  const plugin = (detail as any).plugin;
  if (!plugin || plugin.summary?.id !== expectedId || plugin.summary?.name !== 'episodic-memory') {
    return undefined;
  }
  if (plugin.summary.installed !== true || plugin.summary.enabled !== true) return false;
  if (!Array.isArray(plugin.mcpServers) || !plugin.mcpServers.every((name: unknown) => typeof name === 'string')) {
    return undefined;
  }
  return plugin.mcpServers.includes('episodic-memory');
}
