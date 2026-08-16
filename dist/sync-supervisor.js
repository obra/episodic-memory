import { randomBytes } from 'crypto';
import { fork } from 'child_process';
import { acquireFileLock, releaseFileLock } from './file-lock.js';
export async function runSyncSupervisor(options) {
    let compromised = null;
    let child = null;
    const lock = acquireFileLock(options.lockPath, {
        ...options.lockOptions,
        onCompromised: error => {
            compromised = error;
            if (child && child.exitCode === null && child.signalCode === null)
                child.kill('SIGTERM');
            options.lockOptions?.onCompromised?.(error);
        },
    });
    if (!lock)
        return { kind: 'skipped', reason: 'sync already running; skipping' };
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const forwardSignal = (signal) => { if (child && child.exitCode === null)
        child.kill(signal); };
    try {
        const token = randomBytes(32).toString('hex');
        const inherited = options.workerStdio === 'inherit';
        child = fork(options.workerScript, options.workerArgs ?? [], {
            env: { ...process.env, ...options.workerEnv, EPISODIC_MEMORY_WRITER_TOKEN: token },
            stdio: inherited ? ['inherit', 'inherit', 'inherit', 'ipc'] : ['ignore', 'ignore', 'pipe', 'ipc'],
        });
        for (const signal of signals)
            process.once(signal, forwardSignal);
        await authorizeChild(child, token, options.handshakeTimeoutMs ?? 5_000);
        let code;
        try {
            code = await waitForChild(child, options.workerTimeoutMs, options.terminationGraceMs);
        }
        catch (error) {
            if (compromised)
                throw new Error(`sync lock heartbeat compromised: ${compromised.message}`);
            throw error;
        }
        if (compromised)
            throw new Error(`sync lock heartbeat compromised: ${compromised.message}`);
        if (code !== 0)
            throw new Error(`sync worker exited ${code}`);
        return { kind: 'completed', code };
    }
    finally {
        for (const signal of signals)
            process.off(signal, forwardSignal);
        if (child && child.exitCode === null && child.signalCode === null)
            child.kill('SIGTERM');
        releaseFileLock(lock);
    }
}
function authorizeChild(child, token, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            child.off('message', onMessage);
            child.off('exit', onExit);
            error ? reject(error) : resolve();
        };
        const onMessage = (message) => {
            if (message?.type !== 'challenge' || message.token !== token)
                return finish(new Error('sync worker handshake token mismatch'));
            child.send?.({ type: 'authorized', token }, error => error ? finish(new Error(`sync worker handshake failed: ${error.message}`)) : finish());
        };
        const onExit = () => finish(new Error('sync worker exited before handshake'));
        const timer = setTimeout(() => finish(new Error('sync worker handshake timed out')), timeoutMs);
        child.on('message', onMessage);
        child.on('exit', onExit);
    });
}
function waitForChild(child, timeoutMs, terminationGraceMs = 5_000) {
    return new Promise((resolve, reject) => {
        let timedOut = false;
        let killTimer = null;
        const timer = timeoutMs ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            killTimer = setTimeout(() => child.kill('SIGKILL'), terminationGraceMs);
        }, timeoutMs) : null;
        child.once('error', error => {
            if (timer)
                clearTimeout(timer);
            if (killTimer)
                clearTimeout(killTimer);
            reject(error);
        });
        child.once('exit', (code, signal) => {
            if (timer)
                clearTimeout(timer);
            if (killTimer)
                clearTimeout(killTimer);
            if (timedOut)
                reject(new Error('sync worker timed out'));
            else if (signal)
                reject(new Error(`sync worker terminated by ${signal}`));
            else
                resolve(code ?? 1);
        });
    });
}
export function authorizeWorkerFromSupervisor(timeoutMs = 5_000) {
    return new Promise((resolve, reject) => {
        const token = process.env.EPISODIC_MEMORY_WRITER_TOKEN;
        if (!token || !process.send || !process.connected)
            return reject(new Error('sync worker requires supervisor IPC'));
        const timer = setTimeout(() => reject(new Error('sync supervisor authorization timed out')), timeoutMs);
        process.once('message', (message) => {
            clearTimeout(timer);
            if (message?.type !== 'authorized' || message.token !== token)
                reject(new Error('sync supervisor authorization mismatch'));
            else
                resolve();
        });
        process.send({ type: 'challenge', token });
    });
}
