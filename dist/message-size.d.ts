export declare const DEFAULT_MAX_MESSAGE_BYTES: number;
export declare function getMaxMessageBytes(env?: NodeJS.ProcessEnv): number;
export declare function isOversizeExchange(exchange: {
    userMessage?: string;
    assistantMessage?: string;
}, maxBytes: number): boolean;
