import { spawn } from 'child_process';
import readline from 'readline';
import { pluginMcpDeclaration } from './doctor-observations.js';
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function hookBelongsToEpisodicMemory(hook) {
    const pluginId = typeof hook.pluginId === 'string' ? hook.pluginId : '';
    const key = typeof hook.key === 'string' ? hook.key : '';
    return pluginId.startsWith('episodic-memory@') || key.startsWith('episodic-memory@');
}
export function hookStateFromHooksList(result) {
    if (!isRecord(result) || !Array.isArray(result.data)) {
        return { trustState: 'unknown', enabledState: 'unknown' };
    }
    const matchingHooks = [];
    for (const entry of result.data) {
        if (!isRecord(entry) || !Array.isArray(entry.hooks))
            continue;
        for (const hook of entry.hooks) {
            if (isRecord(hook) && hookBelongsToEpisodicMemory(hook)) {
                matchingHooks.push(hook);
            }
        }
    }
    if (matchingHooks.length === 0) {
        return { trustState: 'not_found', enabledState: 'not_found' };
    }
    const active = matchingHooks.filter(hook => hook.enabled !== false && hook.disabled !== true);
    const enabledState = active.some(hook => hook.enabled === true || hook.disabled === false)
        ? 'enabled' : active.length === 0 ? 'disabled' : 'unknown';
    const trustStates = (active.length > 0 ? active : matchingHooks)
        .map(hook => hook.trustStatus ?? hook.trust ?? hook.trust_status)
        .filter((trust) => typeof trust === 'string');
    const trustState = trustStates.includes('modified') ? 'modified'
        : trustStates.includes('untrusted') ? 'untrusted'
            : trustStates.length !== (active.length > 0 ? active : matchingHooks).length ? 'unknown'
                : trustStates.every(trust => trust === 'trusted' || trust === 'managed') ? 'trusted' : 'unknown';
    return { trustState, enabledState };
}
export function trustStateFromHooksList(result) {
    return hookStateFromHooksList(result).trustState;
}
export async function detectCodexIntegrationState(codexHome, cwd, timeoutMs = 10000) {
    const child = spawn('codex', ['app-server'], {
        env: { ...process.env, CODEX_HOME: codexHome },
        stdio: ['pipe', 'pipe', 'ignore'],
    });
    const rl = readline.createInterface({ input: child.stdout });
    const pending = new Map();
    let nextId = 1;
    child.on('error', error => {
        for (const entry of pending.values()) {
            entry.reject(error);
        }
        pending.clear();
    });
    rl.on('line', line => {
        if (!line.trim())
            return;
        let message;
        try {
            message = JSON.parse(line);
        }
        catch {
            return;
        }
        if (typeof message.id !== 'number')
            return;
        const entry = pending.get(message.id);
        if (!entry)
            return;
        pending.delete(message.id);
        if (message.error) {
            entry.reject(new Error(JSON.stringify(message.error)));
        }
        else {
            entry.resolve(message.result);
        }
    });
    const send = (method, params) => {
        const id = nextId++;
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
        });
    };
    const notify = (method) => {
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
        const hooks = hookStateFromHooksList(hooksList);
        const observed = { hooks, failures: [] };
        try {
            const result = await send('plugin/list', {
                cwds: [cwd], forceRefetch: false, marketplaceKinds: ['local'],
            });
            if (!isRecord(result) || !Array.isArray(result.marketplaces))
                throw new Error('invalid registry');
            const installed = [];
            let declared = false;
            for (const market of result.marketplaces) {
                if (!isRecord(market) || !Array.isArray(market.plugins))
                    throw new Error('invalid marketplace');
                for (const plugin of market.plugins) {
                    if (!isRecord(plugin) || plugin.name !== 'episodic-memory')
                        continue;
                    installed.push(plugin);
                    if (plugin.installed !== true || plugin.enabled !== true)
                        continue;
                    if (typeof plugin.id !== 'string' || typeof market.name !== 'string') {
                        declared = undefined;
                        continue;
                    }
                    const detail = await send('plugin/read', {
                        pluginName: plugin.name,
                        ...(typeof market.path === 'string' ? { marketplacePath: market.path }
                            : { remoteMarketplaceName: market.name }),
                    });
                    const state = pluginMcpDeclaration(detail, plugin.id);
                    if (state === true)
                        declared = true;
                    else if (state === undefined && declared !== true)
                        declared = undefined;
                }
            }
            observed.pluginListOutput = JSON.stringify({ installed });
            observed.pluginMcpDeclared = declared;
            if (declared === undefined)
                observed.failures.push('plugin declaration (unknown)');
        }
        catch {
            observed.failures.push('plugin registry (unavailable)');
        }
        return observed;
    }
    catch {
        return { hooks: { trustState: 'unknown', enabledState: 'unknown' },
            failures: ['hooks/plugin native inspection (unavailable)'] };
    }
    finally {
        clearTimeout(timeout);
        rl.close();
        child.kill('SIGTERM');
    }
}
export async function detectCodexHookState(codexHome, cwd, timeoutMs = 10000) {
    return (await detectCodexIntegrationState(codexHome, cwd, timeoutMs)).hooks;
}
export async function detectCodexHookTrustState(codexHome, cwd, timeoutMs = 10000) {
    return (await detectCodexHookState(codexHome, cwd, timeoutMs)).trustState;
}
