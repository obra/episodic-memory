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
export declare function buildCodexDoctorReport(inputs: CodexDoctorInputs): DoctorReport;
