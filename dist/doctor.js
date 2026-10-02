import { MIN_CODEX_VERSION, parseCodexCliVersion, versionMeetsMinimum, } from './codex-support.js';
function parseFeatureState(featuresOutput, feature) {
    const line = featuresOutput
        .split(/\r?\n/)
        .map(entry => entry.trim())
        .find(entry => entry.startsWith(`${feature} `));
    if (!line) {
        return undefined;
    }
    const lastColumn = line.split(/\s+/).at(-1);
    if (lastColumn === 'true')
        return true;
    if (lastColumn === 'false')
        return false;
    return undefined;
}
function parseMcpState(mcpListOutput) {
    const line = mcpListOutput
        .split(/\r?\n/)
        .map(entry => entry.trim())
        .find(entry => entry.startsWith('episodic-memory '));
    if (!line) {
        return 'missing';
    }
    return line.includes(' enabled') ? 'enabled' : 'disabled';
}
function parsePluginState(output) {
    if (output === undefined)
        return 'unknown';
    const registry = parseJsonConfig(output);
    if (!registry || !Array.isArray(registry.installed))
        return 'unknown';
    const plugins = registry.installed.filter((entry) => entry?.name === 'episodic-memory');
    if (plugins.some((entry) => entry.installed === true && entry.enabled === true))
        return 'enabled';
    if (plugins.some((entry) => entry.installed === true && entry.enabled === false))
        return 'disabled';
    if (plugins.some((entry) => entry.installed !== false))
        return 'unknown';
    return 'missing';
}
function formatHookTrustState(hookTrustState) {
    switch (hookTrustState) {
        case 'trusted':
            return 'trusted';
        case 'untrusted':
            return 'untrusted; open /hooks in Codex, review the Episodic Memory hook, and press t to trust it.';
        case 'modified':
            return 'modified since it was trusted; open /hooks in Codex, review the Episodic Memory hook, and press t to trust it again.';
        case 'not_found':
            return 'not found; confirm the Episodic Memory plugin is installed and enabled.';
        case 'unknown':
            return 'unknown; could not inspect Codex hooks. Open /hooks in Codex to verify trust.';
    }
}
export function buildCodexDoctorReport(inputs) {
    const version = parseCodexCliVersion(inputs.codexVersionOutput);
    const versionOk = version !== undefined && versionMeetsMinimum(version);
    const hooksEnabled = parseFeatureState(inputs.featuresOutput, 'hooks');
    const pluginsEnabled = parseFeatureState(inputs.featuresOutput, 'plugins');
    const failures = inputs.observationFailures ?? [];
    const explicitMcpState = inputs.mcpListInspected === false ? 'not inspected'
        : failures.some(failure => failure.startsWith('MCP list'))
            ? 'unknown' : parseMcpState(inputs.mcpListOutput);
    const pluginState = failures.some(failure => failure.startsWith('plugin registry'))
        ? 'unknown' : parsePluginState(inputs.pluginListOutput);
    const pluginMcpAvailable = pluginState === 'enabled' && inputs.pluginMcpDeclared === true;
    const mcpState = explicitMcpState === 'enabled' || pluginMcpAvailable ? 'enabled' : explicitMcpState;
    const hookDisabled = inputs.hookEnabledState === 'disabled' || hooksEnabled === false;
    const issues = [];
    if (!versionOk) {
        issues.push(`Codex must be upgraded with codex update (minimum ${MIN_CODEX_VERSION}).`);
    }
    if (pluginsEnabled === false) {
        issues.push('Codex plugins are disabled by policy; review that setting only if plugin use is intended.');
    }
    else if (pluginsEnabled === undefined) {
        issues.push('Codex plugins feature state could not be verified.');
    }
    if (hooksEnabled === undefined) {
        issues.push('Codex hooks feature state could not be verified.');
    }
    if (!inputs.sessionsDirExists) {
        issues.push('Codex sessions directory does not exist yet; start at least one Codex session.');
    }
    if (mcpState !== 'enabled') {
        issues.push('Episodic Memory MCP configuration could not be verified from native plugin or explicit registration evidence.');
    }
    if (inputs.pluginListOutput !== undefined && pluginState !== 'enabled' && explicitMcpState !== 'enabled') {
        issues.push(`Episodic Memory plugin registry state: ${pluginState}.`);
    }
    if (pluginState === 'enabled' && inputs.pluginMcpDeclared !== true && explicitMcpState !== 'enabled') {
        issues.push('The enabled plugin MCP declaration could not be verified.');
    }
    if (!hookDisabled && (inputs.hookTrustState === 'untrusted' || inputs.hookTrustState === 'modified')) {
        issues.push('Episodic Memory Codex hook is not trusted; open /hooks in Codex and press t to trust it.');
    }
    else if (!hookDisabled && inputs.hookTrustState === 'not_found') {
        issues.push('Episodic Memory Codex hook was not found; confirm the plugin is installed and enabled.');
    }
    else if (!hookDisabled && inputs.hookTrustState === 'unknown') {
        issues.push('Episodic Memory Codex hook trust could not be verified.');
    }
    for (const failure of failures)
        issues.push(`Native inspection unavailable: ${failure}.`);
    const lines = [
        'Episodic Memory Codex Doctor',
        '================================',
        '',
        `Codex version: ${inputs.codexVersionOutput.trim() || '(not found)'} ${versionOk ? `(ok; minimum ${MIN_CODEX_VERSION})` : `(requires minimum ${MIN_CODEX_VERSION})`}`,
        `Codex home: ${inputs.codexHome}`,
        `Codex sessions: ${inputs.sessionsDirExists ? 'found' : 'missing'}`,
        `Plugins feature: ${pluginsEnabled === true ? 'enabled' : pluginsEnabled === false ? 'disabled' : 'unknown'}`,
        `Hooks feature: ${hooksEnabled === true ? 'enabled' : hooksEnabled === false ? 'disabled' : 'unknown'}`,
        `Plugin registry: ${pluginState}`,
        `Plugin MCP: ${inputs.pluginMcpDeclared === true ? 'declared' : inputs.pluginMcpDeclared === false ? 'not declared' : 'unknown'}`,
        `Explicit MCP: ${explicitMcpState}`,
        `Episodic Memory MCP: ${mcpState}`,
        'MCP runtime: not probed; configuration is not a successful tool loop.',
        `Index database: ${inputs.dbPath}`,
        `Hook/background sync log: ${inputs.logPath}`,
        '',
        `Hook execution: ${hookDisabled ? 'disabled' : inputs.hookEnabledState ?? 'not inspected'}`,
        `Hook trust: ${hookDisabled ? inputs.hookTrustState : formatHookTrustState(inputs.hookTrustState)}`,
    ];
    if (issues.length > 0) {
        lines.push('', 'Issues:');
        for (const issue of issues) {
            lines.push(`- ${issue}`);
        }
    }
    return {
        ok: issues.length === 0,
        text: `${lines.join('\n')}\n`,
    };
}
function parseJsonConfig(output) {
    try {
        return JSON.parse(output);
    }
    catch {
        return undefined;
    }
}
function opencodePluginState(config) {
    if (!config || typeof config !== 'object') {
        return 'unknown';
    }
    const plugins = Array.isArray(config.plugin) ? config.plugin : [];
    const configured = plugins.some((entry) => {
        if (typeof entry === 'string') {
            return entry === 'episodic-memory' || entry === 'episodic-memory/server';
        }
        if (Array.isArray(entry) && typeof entry[0] === 'string') {
            return entry[0] === 'episodic-memory' || entry[0] === 'episodic-memory/server';
        }
        return false;
    });
    return configured ? 'configured' : 'missing';
}
function opencodeMcpState(config) {
    if (!config || typeof config !== 'object') {
        return 'unknown';
    }
    const mcp = config.mcp;
    if (!mcp || typeof mcp !== 'object') {
        return 'missing';
    }
    const entry = mcp['episodic-memory'];
    if (!entry || typeof entry !== 'object') {
        return 'missing';
    }
    if (entry.enabled === false || entry.disabled === true) {
        return 'disabled';
    }
    return 'enabled';
}
export function buildOpencodeDoctorReport(inputs) {
    const version = parseCodexCliVersion(inputs.opencodeVersionOutput);
    const versionOk = version !== undefined;
    const config = parseJsonConfig(inputs.debugConfigOutput);
    const pluginState = opencodePluginState(config);
    const mcpState = opencodeMcpState(config);
    const issues = [];
    if (!versionOk) {
        issues.push('opencode was not found or did not report a version.');
    }
    if (pluginState !== 'configured') {
        issues.push('Episodic Memory opencode plugin is not configured; add "episodic-memory" to the opencode plugin array.');
    }
    if (!inputs.dbExists) {
        issues.push('opencode database does not exist yet; start at least one opencode session.');
    }
    if (mcpState !== 'enabled') {
        issues.push('Episodic Memory MCP server is not enabled in opencode config.');
    }
    const lines = [
        'Episodic Memory opencode Doctor',
        '=================================',
        '',
        `opencode version: ${inputs.opencodeVersionOutput.trim() || '(not found)'} ${versionOk ? '(found)' : '(missing)'}`,
        `opencode database: ${inputs.dbExists ? 'found' : 'missing'} (${inputs.dbPath})`,
        `Generated transcripts: ${inputs.transcriptDirExists ? 'found' : 'missing until first sync'} (${inputs.transcriptDir})`,
        `opencode plugin: ${pluginState}`,
        `Episodic Memory MCP: ${mcpState}`,
        `Hook/background sync log: ${inputs.logPath}`,
    ];
    if (issues.length > 0) {
        lines.push('', 'Issues:');
        for (const issue of issues) {
            lines.push(`- ${issue}`);
        }
    }
    return {
        ok: issues.length === 0,
        text: `${lines.join('\n')}\n`,
    };
}
