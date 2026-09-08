import type { CodexHookTrustState } from './codex-hook-trust.js';
export interface CodexDoctorInputs {
    codexVersionOutput: string;
    featuresOutput: string;
    mcpListOutput: string;
    codexHome: string;
    sessionsDirExists: boolean;
    logPath: string;
    dbPath: string;
    hookTrustState: CodexHookTrustState;
}
export interface DoctorReport {
    ok: boolean;
    text: string;
}
export interface OpencodeDoctorInputs {
    opencodeVersionOutput: string;
    debugConfigOutput: string;
    dbPath: string;
    dbExists: boolean;
    transcriptDir: string;
    transcriptDirExists: boolean;
    logPath: string;
}
export declare function buildCodexDoctorReport(inputs: CodexDoctorInputs): DoctorReport;
export declare function buildOpencodeDoctorReport(inputs: OpencodeDoctorInputs): DoctorReport;
