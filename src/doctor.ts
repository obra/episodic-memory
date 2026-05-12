import {
  MIN_CODEX_VERSION,
  parseCodexCliVersion,
  versionMeetsMinimum,
} from './codex-support.js';

export interface CodexDoctorInputs {
  codexVersionOutput: string;
  featuresOutput: string;
  mcpListOutput: string;
  codexHome: string;
  sessionsDirExists: boolean;
  logPath: string;
  dbPath: string;
}

export interface DoctorReport {
  ok: boolean;
  text: string;
}

function parseFeatureState(featuresOutput: string, feature: string): boolean | undefined {
  const line = featuresOutput
    .split(/\r?\n/)
    .map(entry => entry.trim())
    .find(entry => entry.startsWith(`${feature} `));
  if (!line) {
    return undefined;
  }
  const lastColumn = line.split(/\s+/).at(-1);
  if (lastColumn === 'true') return true;
  if (lastColumn === 'false') return false;
  return undefined;
}

function parseMcpState(mcpListOutput: string): 'enabled' | 'disabled' | 'missing' {
  const line = mcpListOutput
    .split(/\r?\n/)
    .map(entry => entry.trim())
    .find(entry => entry.startsWith('episodic-memory '));
  if (!line) {
    return 'missing';
  }
  return line.includes(' enabled') ? 'enabled' : 'disabled';
}

export function buildCodexDoctorReport(inputs: CodexDoctorInputs): DoctorReport {
  const version = parseCodexCliVersion(inputs.codexVersionOutput);
  const versionOk = version !== undefined && versionMeetsMinimum(version);
  const pluginHooksEnabled = parseFeatureState(inputs.featuresOutput, 'plugin_hooks');
  const pluginsEnabled = parseFeatureState(inputs.featuresOutput, 'plugins');
  const mcpState = parseMcpState(inputs.mcpListOutput);

  const issues: string[] = [];
  if (!versionOk) {
    issues.push(`Codex must be upgraded with codex update (minimum ${MIN_CODEX_VERSION}).`);
  }
  if (pluginsEnabled === false) {
    issues.push('Codex plugins are disabled; run codex features enable plugins.');
  }
  if (pluginHooksEnabled !== true) {
    issues.push('Codex plugin hooks are not enabled; run codex features enable plugin_hooks.');
  }
  if (!inputs.sessionsDirExists) {
    issues.push('Codex sessions directory does not exist yet; start at least one Codex session.');
  }
  if (mcpState !== 'enabled') {
    issues.push('Episodic Memory MCP server is not enabled in codex mcp list.');
  }

  const lines = [
    'Episodic Memory Codex Doctor',
    '================================',
    '',
    `Codex version: ${inputs.codexVersionOutput.trim() || '(not found)'} ${versionOk ? `(ok; minimum ${MIN_CODEX_VERSION})` : `(requires minimum ${MIN_CODEX_VERSION})`}`,
    `Codex home: ${inputs.codexHome}`,
    `Codex sessions: ${inputs.sessionsDirExists ? 'found' : 'missing'}`,
    `Plugins feature: ${pluginsEnabled === true ? 'enabled' : pluginsEnabled === false ? 'disabled' : 'unknown'}`,
    `Plugin hooks feature: ${pluginHooksEnabled === true ? 'enabled' : pluginHooksEnabled === false ? 'disabled' : 'unknown'}`,
    `Episodic Memory MCP: ${mcpState}`,
    `Index database: ${inputs.dbPath}`,
    `Hook/background sync log: ${inputs.logPath}`,
    '',
    'Hook trust: open /hooks in Codex, review the Episodic Memory hook, and press t to trust it.',
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
