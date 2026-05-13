import { spawn } from 'child_process';
import readline from 'readline';

export type CodexHookTrustState = 'trusted' | 'untrusted' | 'modified' | 'not_found' | 'unknown';

interface JsonRpcMessage {
  id?: number;
  result?: unknown;
  error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hookBelongsToEpisodicMemory(hook: Record<string, unknown>): boolean {
  const pluginId = typeof hook.pluginId === 'string' ? hook.pluginId : '';
  const key = typeof hook.key === 'string' ? hook.key : '';
  return pluginId.startsWith('episodic-memory@') || key.startsWith('episodic-memory@');
}

export function trustStateFromHooksList(result: unknown): CodexHookTrustState {
  if (!isRecord(result) || !Array.isArray(result.data)) {
    return 'unknown';
  }

  const matchingHooks: Record<string, unknown>[] = [];
  for (const entry of result.data) {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) continue;
    for (const hook of entry.hooks) {
      if (isRecord(hook) && hookBelongsToEpisodicMemory(hook)) {
        matchingHooks.push(hook);
      }
    }
  }

  if (matchingHooks.length === 0) {
    return 'not_found';
  }

  const trustStates = matchingHooks
    .map(hook => hook.trustStatus ?? hook.trust ?? hook.trust_status)
    .filter((trust): trust is string => typeof trust === 'string');

  if (trustStates.includes('trusted') || trustStates.includes('managed')) {
    return 'trusted';
  }
  if (trustStates.includes('modified')) {
    return 'modified';
  }
  if (trustStates.includes('untrusted')) {
    return 'untrusted';
  }
  return 'unknown';
}

export async function detectCodexHookTrustState(
  codexHome: string,
  cwd: string,
  timeoutMs = 10000
): Promise<CodexHookTrustState> {
  const child = spawn('codex', ['app-server'], {
    env: { ...process.env, CODEX_HOME: codexHome },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const rl = readline.createInterface({ input: child.stdout });
  const pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  let nextId = 1;

  child.on('error', error => {
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  });

  rl.on('line', line => {
    if (!line.trim()) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message.id !== 'number') return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) {
      entry.reject(new Error(JSON.stringify(message.error)));
    } else {
      entry.resolve(message.result);
    }
  });

  const send = (method: string, params?: unknown): Promise<unknown> => {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  };

  const notify = (method: string): void => {
    child.stdin.write(`${JSON.stringify({ method })}\n`);
  };

  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    for (const entry of pending.values()) {
      entry.reject(new Error('timed out inspecting Codex hooks'));
    }
    pending.clear();
  }, timeoutMs);

  try {
    await send('initialize', {
      clientInfo: { name: 'episodic-memory-doctor', version: '0.0.0' },
      capabilities: { experimentalApi: true },
    });
    notify('initialized');
    const hooksList = await send('hooks/list', { cwds: [cwd] });
    return trustStateFromHooksList(hooksList);
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timeout);
    rl.close();
    child.kill('SIGTERM');
  }
}
