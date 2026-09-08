type ShellPromise = Promise<{
    exitCode: number;
    stdout?: Buffer;
    stderr?: Buffer;
}> & {
    quiet(): ShellPromise;
    nothrow(): ShellPromise;
};
type Shell = (strings: TemplateStringsArray, ...expressions: unknown[]) => ShellPromise;
interface PluginInput {
    $: Shell;
    client?: {
        app?: {
            log?: (input: {
                body: {
                    service: string;
                    level: 'debug' | 'info' | 'warn' | 'error';
                    message: string;
                    extra?: Record<string, unknown>;
                };
            }) => Promise<unknown>;
        };
    };
}
interface PluginOptions {
    command?: unknown;
    summaryLimit?: unknown;
}
interface OpencodeEvent {
    type?: string;
}
interface Hooks {
    event?: (input: {
        event: OpencodeEvent;
    }) => Promise<void>;
}
export declare function server(input: PluginInput, options?: PluginOptions): Promise<Hooks>;
declare const _default: {
    id: string;
    server: typeof server;
};
export default _default;
