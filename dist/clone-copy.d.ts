export interface CloneCopyOptions {
    platform?: NodeJS.Platform;
    runCp?: (args: string[]) => void;
}
/**
 * Copy a transcript into the archive, sharing disk blocks when the filesystem
 * allows it.
 *
 * The archive mirrors every live transcript, so a plain copy doubles their disk
 * use (21 GB → 42 GB on one machine). On APFS a clone costs nothing until either
 * file changes, and the archive copy still survives when the harness deletes the
 * original.
 *
 * Node cannot clone on macOS: COPYFILE_FICLONE silently falls back to a full
 * copy and COPYFILE_FICLONE_FORCE throws ENOSYS (Node 24). `cp -c` calls
 * clonefile(2) directly. Any failure falls back to fs.copyFileSync.
 */
export declare function cloneOrCopyFileSync(src: string, dest: string, { platform, runCp }?: CloneCopyOptions): void;
