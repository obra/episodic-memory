import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { syncConversations } from '../src/sync.js';

describe('sync command', () => {
  let testDir: string;
  let sourceDir: string;
  let destDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-sync-test-'));
    sourceDir = join(testDir, 'source');
    destDir = join(testDir, 'dest');

    // Create source directory
    mkdirSync(sourceDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should copy new files from source to destination', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const testFile = join(sourceDir, 'project-a', 'test.jsonl');
    writeFileSync(testFile, 'test content', 'utf-8');

    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(result.copied).toBe(1);
    expect(result.skipped).toBe(0);

    // Verify file was copied
    const destFile = join(destDir, 'project-a', 'test.jsonl');
    expect(statSync(destFile).isFile()).toBe(true);
  });

  it('should skip files that have not been modified', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const testFile = join(sourceDir, 'project-a', 'test.jsonl');
    writeFileSync(testFile, 'test content', 'utf-8');

    // First sync - should copy
    await syncConversations(sourceDir, destDir, { skipIndex: true });

    // Second sync - should skip (same mtime)
    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(result.copied).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should copy files that were modified after previous sync', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    const testFile = join(sourceDir, 'project-a', 'test.jsonl');
    writeFileSync(testFile, 'version 1', 'utf-8');

    // First sync
    await syncConversations(sourceDir, destDir, { skipIndex: true });

    // Modify source file (update mtime)
    const now = new Date();
    const future = new Date(now.getTime() + 5000);
    writeFileSync(testFile, 'version 2', 'utf-8');
    utimesSync(testFile, future, future);

    // Second sync - should copy updated file
    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(result.copied).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('should handle multiple projects', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    mkdirSync(join(sourceDir, 'project-b'), { recursive: true });
    mkdirSync(join(sourceDir, 'project-c'), { recursive: true });
    writeFileSync(join(sourceDir, 'project-a', 'test1.jsonl'), 'content 1', 'utf-8');
    writeFileSync(join(sourceDir, 'project-b', 'test2.jsonl'), 'content 2', 'utf-8');
    writeFileSync(join(sourceDir, 'project-c', 'test3.jsonl'), 'content 3', 'utf-8');

    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(result.copied).toBe(3);
    expect(result.skipped).toBe(0);
  });

  it('should only sync jsonl files', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    writeFileSync(join(sourceDir, 'project-a', 'test.jsonl'), 'good', 'utf-8');
    writeFileSync(join(sourceDir, 'project-a', 'test.txt'), 'bad', 'utf-8');
    writeFileSync(join(sourceDir, 'project-a', 'test.json'), 'bad', 'utf-8');

    const result = await syncConversations(sourceDir, destDir, { skipIndex: true });

    expect(result.copied).toBe(1);
  });
});
