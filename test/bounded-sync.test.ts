import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { requireSuccessfulBoundedSync, syncBoundedSourceDirs } from '../src/bounded-sync.js';
import { RunBudget } from '../src/rclone-transport.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('bounded serial sync publication', () => {
  it('publishes ledger and exchanges only after verified upload and cleans staging', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'episodic-bounded-sync-')); dirs.push(dir);
    const source = join(dir, 'source'); const cache = join(dir, 'cache'); const dbPath = join(dir, 'db.sqlite');
    mkdirSync(join(source, 'project-a'), { recursive: true });
    const sourceFile = join(source, 'project-a', 'session.jsonl');
    writeFileSync(sourceFile, 'line1\nline2\n');
    const events: string[] = [];
    const transport = { uploadVerified: async (local: string) => {
      events.push('upload'); const content = readFileSync(local); return { bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') };
    }};
    const result = await syncBoundedSourceDirs({
      sourceDirs: [source], cacheDir: cache, remoteBase: 'remote:archive', dbPath,
      transport: transport as any, freeBytes: () => 20 * 1024 ** 3,
      prepare: async (local, project, remoteKey, objectId) => {
        events.push('prepare');
        return { summaryText: 'summary', summaryState: 'ready', exchanges: [{
          exchange: { id: 'e1', project, timestamp: '2026-01-01', userMessage: 'u', assistantMessage: 'a',
            archivePath: remoteKey, archiveObjectId: objectId, lineStart: 1, lineEnd: 2 },
          embedding: new Array(384).fill(0),
        }] };
      },
    });
    expect(result).toMatchObject({ uploaded: 1, indexed: 1, errors: [] });
    const db = new Database(dbPath, { readonly: true });
    expect((db.prepare('SELECT COUNT(*) c FROM archive_objects').get() as any).c).toBe(1);
    expect((db.prepare('SELECT COUNT(*) c FROM exchanges').get() as any).c).toBe(1);
    db.close();
    expect(events).toEqual(['prepare', 'upload']);
  });

  it('does not publish exchanges when upload verification fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'episodic-bounded-fail-')); dirs.push(dir);
    const source = join(dir, 'source'); mkdirSync(join(source, 'p'), { recursive: true }); writeFileSync(join(source, 'p', 's.jsonl'), 'x');
    const dbPath = join(dir, 'db.sqlite');
    const result = await syncBoundedSourceDirs({ sourceDirs: [source], cacheDir: join(dir, 'cache'), remoteBase: 'remote:a', dbPath,
      transport: { uploadVerified: async () => { throw new Error('remote integrity mismatch'); } } as any,
      freeBytes: () => 20 * 1024 ** 3,
      prepare: async () => ({ summaryText: null, summaryState: 'missing', exchanges: [] }),
    });
    expect(result.errors[0].error).toMatch(/integrity/);
    const db = new Database(dbPath, { readonly: true });
    expect((db.prepare('SELECT COUNT(*) c FROM archive_objects').get() as any).c).toBe(0);
    db.close();
  });

  it('rolls back a failed SQLite publication and retries the deterministic remote key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'episodic-bounded-retry-')); dirs.push(dir);
    const source = join(dir, 'source'); mkdirSync(join(source, 'p'), { recursive: true }); writeFileSync(join(source, 'p', 's.jsonl'), 'x');
    const dbPath = join(dir, 'db.sqlite'); let uploads = 0; let valid = false; const budget = new RunBudget();
    const common = { sourceDirs: [source], cacheDir: join(dir, 'cache'), remoteBase: 'remote:a', dbPath,
      transport: { uploadVerified: async (local: string) => { uploads++; const data = readFileSync(local); return { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }; } } as any,
      freeBytes: () => 20 * 1024 ** 3,
      budget,
      prepare: async (_local: string, project: string, remoteKey: string, objectId: string) => ({ summaryText: null, summaryState: 'missing' as const,
        exchanges: [{ exchange: { id: 'e', project, timestamp: '2026-01-01', userMessage: 'u', assistantMessage: 'a', archivePath: remoteKey,
          archiveObjectId: objectId, lineStart: 1, lineEnd: 1 }, embedding: new Array(valid ? 384 : 1).fill(0) }] }),
    };
    const failed = await syncBoundedSourceDirs(common); expect(failed.errors).toHaveLength(1);
    expect(budget.files).toBe(1);
    let db = new Database(dbPath, { readonly: true });
    expect((db.prepare('SELECT COUNT(*) c FROM archive_objects').get() as any).c).toBe(0); db.close();
    valid = true;
    const retried = await syncBoundedSourceDirs(common); expect(retried.uploaded).toBe(1); expect(uploads).toBe(2);
    db = new Database(dbPath, { readonly: true });
    expect((db.prepare('SELECT COUNT(*) c FROM archive_objects').get() as any).c).toBe(1); db.close();
  });

  it('namespaces identical project paths from different conversation roots', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'episodic-bounded-roots-')); dirs.push(dir);
    const projects = join(dir, 'projects'); const transcripts = join(dir, 'transcripts');
    for (const root of [projects, transcripts]) {
      mkdirSync(join(root, 'same-project'), { recursive: true });
      writeFileSync(join(root, 'same-project', 'same.jsonl'), root);
    }
    const remoteKeys: string[] = [];
    const result = await syncBoundedSourceDirs({
      sourceDirs: [projects, transcripts], cacheDir: join(dir, 'cache'), remoteBase: 'remote:archive', dbPath: join(dir, 'db.sqlite'),
      freeBytes: () => 20 * 1024 ** 3,
      transport: { uploadVerified: async (local: string, remoteKey: string) => {
        remoteKeys.push(remoteKey); const data = readFileSync(local);
        return { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
      } } as any,
      prepare: async () => ({ summaryText: null, summaryState: 'empty', exchanges: [] }),
    });
    expect(result.uploaded).toBe(2);
    expect(new Set(remoteKeys).size).toBe(2);
    expect(remoteKeys.some(key => key.includes('/claude-projects/'))).toBe(true);
    expect(remoteKeys.some(key => key.includes('/claude-transcripts/'))).toBe(true);
  });

  it('does not upload or index conversations carrying the privacy marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'episodic-bounded-private-')); dirs.push(dir);
    const source = join(dir, 'projects'); mkdirSync(join(source, 'p'), { recursive: true });
    writeFileSync(join(source, 'p', 'private.jsonl'), '<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>');
    let uploads = 0;
    const result = await syncBoundedSourceDirs({
      sourceDirs: [source], cacheDir: join(dir, 'cache'), remoteBase: 'remote:archive', dbPath: join(dir, 'db.sqlite'),
      freeBytes: () => 20 * 1024 ** 3,
      transport: { uploadVerified: async () => { uploads += 1; return { bytes: 0, sha256: '' }; } } as any,
      prepare: async () => { throw new Error('private conversation was prepared'); },
    });
    expect(result).toMatchObject({ uploaded: 0, indexed: 0, skipped: 1, errors: [] });
    expect(uploads).toBe(0);
  });

  it('rechecks staged bytes when a privacy marker is appended after source precheck', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'episodic-bounded-private-race-')); dirs.push(dir);
    const source = join(dir, 'projects'); mkdirSync(join(source, 'p'), { recursive: true });
    const sourceFile = join(source, 'p', 'private.jsonl');
    writeFileSync(sourceFile, 'initial public content');
    let appended = false; let uploads = 0;
    const result = await syncBoundedSourceDirs({
      sourceDirs: [source], cacheDir: join(dir, 'cache'), remoteBase: 'remote:archive', dbPath: join(dir, 'db.sqlite'),
      freeBytes: () => {
        if (!appended) {
          appended = true;
          writeFileSync(sourceFile, '<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>', { flag: 'a' });
        }
        return 20 * 1024 ** 3;
      },
      transport: { uploadVerified: async () => { uploads += 1; return { bytes: 0, sha256: '' }; } } as any,
      prepare: async () => { throw new Error('private conversation was prepared'); },
    });
    expect(result).toMatchObject({ uploaded: 0, indexed: 0, skipped: 1, errors: [] });
    expect(uploads).toBe(0);
  });

  it('skips private transcripts before budget admission and continues with later files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'episodic-bounded-private-budget-')); dirs.push(dir);
    const source = join(dir, 'projects'); mkdirSync(join(source, 'p'), { recursive: true });
    const privateContent = '<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>';
    writeFileSync(join(source, 'p', 'a-private.jsonl'), privateContent);
    writeFileSync(join(source, 'p', 'b-public.jsonl'), 'public');
    const admitted: number[] = [];
    const budget = {
      canStart: (bytes: number) => { admitted.push(bytes); return { allowed: bytes !== Buffer.byteLength(privateContent), reason: 'private file consumed budget' }; },
      record: () => {},
    };
    let uploads = 0;
    const result = await syncBoundedSourceDirs({
      sourceDirs: [source], cacheDir: join(dir, 'cache'), remoteBase: 'remote:archive', dbPath: join(dir, 'db.sqlite'), budget: budget as any,
      freeBytes: () => 20 * 1024 ** 3,
      transport: { uploadVerified: async (local: string) => { uploads += 1; const data = readFileSync(local); return { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }; } } as any,
      prepare: async () => ({ summaryText: null, summaryState: 'empty', exchanges: [] }),
    });
    expect(result).toMatchObject({ uploaded: 1, skipped: 1, errors: [] });
    expect(admitted).toEqual([Buffer.byteLength('public')]);
    expect(uploads).toBe(1);
  });

  it('turns accumulated bounded-sync errors into a failing worker result', () => {
    expect(() => requireSuccessfulBoundedSync({ uploaded: 0, indexed: 0, skipped: 0, errors: [{ file: 'x', error: 'failed' }] }))
      .toThrow(/bounded sync failed for 1 file/);
  });

  it('replaces all prior exchanges when a transcript is rewritten', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'episodic-bounded-replace-')); dirs.push(dir);
    const source = join(dir, 'source'); mkdirSync(join(source, 'p'), { recursive: true }); const file = join(source, 'p', 's.jsonl'); writeFileSync(file, 'v1');
    const dbPath = join(dir, 'db.sqlite'); let version = 1;
    const options = { sourceDirs: [source], cacheDir: join(dir, 'cache'), remoteBase: 'remote:a', dbPath,
      transport: { uploadVerified: async (local: string) => { const data = readFileSync(local); return { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }; } } as any,
      freeBytes: () => 20 * 1024 ** 3,
      prepare: async (_local: string, project: string, remoteKey: string, objectId: string) => ({ summaryText: null, summaryState: 'missing' as const,
        exchanges: Array.from({ length: version === 1 ? 2 : 1 }, (_, index) => ({ exchange: { id: `e${index + 1}`, project,
          timestamp: '2026-01-01', userMessage: 'u', assistantMessage: 'a', archivePath: remoteKey,
          archiveObjectId: objectId, lineStart: 1, lineEnd: 1 }, embedding: new Array(384).fill(0) })) }),
    };
    expect((await syncBoundedSourceDirs(options)).uploaded).toBe(1);
    version = 2; writeFileSync(file, 'version-two');
    const future = new Date(Date.now() + 5000); utimesSync(file, future, future);
    expect((await syncBoundedSourceDirs(options)).uploaded).toBe(1);
    const db = new Database(dbPath, { readonly: true });
    expect((db.prepare('SELECT COUNT(*) c FROM exchanges').get() as any).c).toBe(1);
    expect((db.prepare('SELECT id FROM exchanges').get() as any).id).toBe('e1'); db.close();
  });
});
