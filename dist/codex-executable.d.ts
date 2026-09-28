export interface CodexExecutable {
    command: string;
    identity: string;
}
/** Resolve native executables without a shell. Opaque scripts/wrappers fall
 * back to uncached validation: their interpreter or delegated binary can
 * change independently. The identity is only a cache key: subprocesses retain
 * the caller's original command and argv[0], including native alias behavior. */
export declare function resolveCodexExecutable(command: string): CodexExecutable | undefined;
