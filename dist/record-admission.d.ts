import type { ConversationExchange } from './types.js';
import { type FindingsTally, type Redactor } from './redaction.js';
/** Scan decoded instruction records without retaining the whole transcript. */
export declare function shouldSkipConversation(filePath: string): boolean;
interface ExchangeExclusion {
    session_id: string;
    transcript: string;
    line_start: number;
    line_end: number;
}
interface ToolExclusion {
    session_id: string;
    transcript: string;
    call_id: string;
}
export interface RecordExclusions {
    version: 1;
    exchanges: ExchangeExclusion[];
    tool_calls: ToolExclusion[];
    screening?: {
        engine: 'gitleaks';
        executable: string;
        sha256: string;
        timeout_ms: number;
        max_record_bytes: number;
    };
}
export declare function readRecordExclusions(): RecordExclusions | null;
export declare function excludedSession(policy: RecordExclusions | null, sessionId?: string): boolean;
/** Read original inputs without mutation, preserving their physical line numbers. */
export declare function admittedConversationLines(file: string, policy?: RecordExclusions | null): AsyncGenerator<string>;
/** Read the admitted display input without changing original physical coordinates. */
export declare function readAdmittedConversation(file: string, startLine?: number, endLine?: number): Promise<string>;
/** Enforce the same rule for direct callers that bypass transcript parsing. */
export declare function admitExchange(exchange: ConversationExchange, policy?: RecordExclusions | null): ConversationExchange | null;
/** Publish only admitted bytes. Never write an unfiltered temporary copy. */
export declare function archiveAdmittedConversation(source: string, destination: string, policy?: RecordExclusions | null, redactor?: Redactor | null, tally?: FindingsTally): Promise<boolean>;
/** Request-local admission: retained search rows are not trusted merely because they were indexed. */
export declare function createSearchAdmission(): {
    admit(exchange: ConversationExchange): ConversationExchange | null;
    summary(exchange: ConversationExchange, text: string): string | undefined;
    verify(): void;
};
export {};
