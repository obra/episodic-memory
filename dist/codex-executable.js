import fs from 'fs';
import path from 'path';
/** Resolve native executables without a shell. Opaque scripts/wrappers fall
 * back to uncached validation: their interpreter or delegated binary can
 * change independently. The identity is only a cache key: subprocesses retain
 * the caller's original command and argv[0], including native alias behavior. */
export function resolveCodexExecutable(command) {
    const windows = process.platform === 'win32';
    const hasPath = path.isAbsolute(command) || command.includes('/') || (windows && command.includes('\\'));
    if (!command || command === '.')
        return undefined;
    // Drive-relative paths, quoted PATH syntax and the Windows cwd-search
    // policy are deliberately left uncached rather than approximating lookup.
    if (windows && !path.isAbsolute(command) && command.includes(':'))
        return undefined;
    const pathKey = Object.keys(process.env).sort().find(key => windows ? key.toLowerCase() === 'path' : key === 'PATH');
    const searchPath = pathKey ? process.env[pathKey] : undefined;
    // A missing PATH has platform-specific defaults. Leave that case to spawn.
    if (!hasPath && searchPath === undefined)
        return undefined;
    if (windows && !hasPath && (/["']/.test(searchPath) || Object.keys(process.env).some(key => key.toLowerCase() === 'nodefaultcurrentdirectoryinexepath')))
        return undefined;
    const name = path.basename(command);
    const dot = name.indexOf('.');
    const nameHasExtension = dot >= 0 && dot < name.length - 1;
    // libuv's exact-name flag for path-qualified extensionless executables has
    // varied across runtimes; do not cache that ambiguous case.
    if (windows && hasPath && !nameHasExtension)
        return undefined;
    const directories = hasPath ? [''] : [
        ...(windows ? [process.cwd()] : []),
        ...searchPath.split(path.delimiter).filter(dir => !windows || dir.length > 0),
    ];
    for (const directory of directories) {
        const candidate = path.resolve(directory, command);
        // libuv's shell-free Windows lookup considers .com/.exe, not PATHEXT.
        const suffixBase = candidate.endsWith('.') ? candidate : `${candidate}.`;
        const candidates = windows
            ? [...(nameHasExtension ? [candidate] : []), `${suffixBase}com`, `${suffixBase}exe`]
            : [candidate];
        for (const file of candidates) {
            try {
                const resolved = fs.realpathSync(file);
                const stat = fs.statSync(resolved, { bigint: true });
                if (!stat.isFile())
                    continue;
                fs.accessSync(resolved, windows ? fs.constants.F_OK : fs.constants.X_OK);
                // Only native executables have an identity bounded by this file.
                const fd = fs.openSync(resolved, 'r');
                const magic = Buffer.alloc(4);
                try {
                    fs.readSync(fd, magic, 0, 4, 0);
                }
                finally {
                    fs.closeSync(fd);
                }
                const native = windows ? magic.subarray(0, 2).toString() === 'MZ'
                    : ['7f454c46', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca'].includes(magic.toString('hex'));
                if (!native)
                    return undefined;
                return {
                    command: resolved,
                    identity: [resolved, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].join('|'),
                };
            }
            catch (error) {
                // Unknown resolution/permissions must never reuse a successful check.
                if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')
                    return undefined;
            }
        }
    }
    return undefined;
}
