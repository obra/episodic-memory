import fs from 'fs';
import { execFileSync } from 'child_process';

export interface CloneCopyOptions {
  platform?: NodeJS.Platform;
  runCp?: (args: string[]) => void;
}

function defaultRunCp(args: string[]): void {
  execFileSync('/bin/cp', args, { stdio: 'ignore' });
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
export function cloneOrCopyFileSync(
  src: string,
  dest: string,
  { platform = process.platform, runCp = defaultRunCp }: CloneCopyOptions = {},
): void {
  if (platform === 'darwin') {
    try {
      runCp(['-c', src, dest]);
      return;
    } catch {
      // Not APFS, or cp unavailable: fall through to a plain copy.
    }
  }
  fs.copyFileSync(src, dest);
}
