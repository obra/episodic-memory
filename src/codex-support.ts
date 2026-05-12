export const MIN_CODEX_VERSION = '0.130.0';

export function parseCodexCliVersion(output: string): string | undefined {
  return output.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
}

export function compareSemver(a: string, b: string): number {
  const aParts = a.split('.').map(part => Number.parseInt(part, 10));
  const bParts = b.split('.').map(part => Number.parseInt(part, 10));

  for (let i = 0; i < 3; i++) {
    const aPart = Number.isFinite(aParts[i]) ? aParts[i] : 0;
    const bPart = Number.isFinite(bParts[i]) ? bParts[i] : 0;
    if (aPart !== bPart) {
      return aPart - bPart;
    }
  }

  return 0;
}

export function versionMeetsMinimum(version: string, minimum = MIN_CODEX_VERSION): boolean {
  return compareSemver(version, minimum) >= 0;
}

export function codexVersionRequirementMessage(versionOutput: string): string {
  const version = parseCodexCliVersion(versionOutput);
  if (!version) {
    return `Codex summarization requires codex-cli >= ${MIN_CODEX_VERSION}; unable to parse version from: ${versionOutput.trim() || '(empty output)'}`;
  }
  return `Codex summarization requires codex-cli >= ${MIN_CODEX_VERSION}; found ${version}. Run codex update and retry.`;
}
