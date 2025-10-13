import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { verifyIndex, repairIndex, VerificationResult } from './verify.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initDatabase, insertExchange } from './db.js';
import { ConversationExchange } from './types.js';

describe('verifyIndex', () => {
  const testDir = path.join(os.tmpdir(), 'conversation-search-test-' + Date.now());
  const projectsDir = path.join(testDir, '.claude', 'projects');
  const archiveDir = path.join(testDir, '.config', 'superpowers', 'conversation-archive');
  const dbPath = path.join(testDir, '.config', 'superpowers', 'conversation-index', 'db.sqlite');

  beforeEach(() => {
    // Create test directories
    fs.mkdirSync(path.join(testDir, '.config', 'superpowers', 'conversation-index'), { recursive: true });
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });

    // Override environment paths for testing
    process.env.TEST_PROJECTS_DIR = projectsDir;
    process.env.TEST_ARCHIVE_DIR = archiveDir;
    process.env.TEST_DB_PATH = dbPath;
  });

  afterEach(() => {
    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
    delete process.env.TEST_PROJECTS_DIR;
    delete process.env.TEST_ARCHIVE_DIR;
    delete process.env.TEST_DB_PATH;
  });

  it('detects missing summaries', async () => {
    // Create a test conversation file without a summary
    const projectArchive = path.join(archiveDir, 'test-project');
    fs.mkdirSync(projectArchive, { recursive: true });

    const conversationPath = path.join(projectArchive, 'test-conversation.jsonl');

    // Create proper JSONL format (one JSON object per line)
    const messages = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' }, timestamp: '2024-01-01T00:00:00Z' }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Hi there!' }, timestamp: '2024-01-01T00:00:01Z' })
    ];
    fs.writeFileSync(conversationPath, messages.join('\n'));

    const result = await verifyIndex();

    expect(result.missing.length).toBe(1);
    expect(result.missing[0].path).toBe(conversationPath);
    expect(result.missing[0].reason).toBe('No summary file');
  });

  it('detects orphaned database entries', async () => {
    // Initialize database
    const db = initDatabase();

    // Create an exchange in the database
    const exchange: ConversationExchange = {
      id: 'orphan-id-1',
      project: 'deleted-project',
      timestamp: '2024-01-01T00:00:00Z',
      userMessage: 'This conversation was deleted',
      assistantMessage: 'But still in database',
      archivePath: path.join(archiveDir, 'deleted-project', 'deleted.jsonl'),
      lineStart: 1,
      lineEnd: 2
    };

    const embedding = new Array(384).fill(0.1);
    insertExchange(db, exchange, embedding);
    db.close();

    // Verify detects orphaned entry (file doesn't exist)
    const result = await verifyIndex();

    expect(result.orphaned.length).toBe(1);
    expect(result.orphaned[0].uuid).toBe('orphan-id-1');
    expect(result.orphaned[0].path).toBe(exchange.archivePath);
  });

  it('detects outdated files (file modified after last_indexed)', async () => {
    // Create conversation file with summary
    const projectArchive = path.join(archiveDir, 'test-project');
    fs.mkdirSync(projectArchive, { recursive: true });

    const conversationPath = path.join(projectArchive, 'updated-conversation.jsonl');
    const summaryPath = conversationPath.replace('.jsonl', '-summary.txt');

    // Create initial conversation
    const messages = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' }, timestamp: '2024-01-01T00:00:00Z' }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Hi there!' }, timestamp: '2024-01-01T00:00:01Z' })
    ];
    fs.writeFileSync(conversationPath, messages.join('\n'));
    fs.writeFileSync(summaryPath, 'Test summary');

    // Index it
    const db = initDatabase();
    const exchange: ConversationExchange = {
      id: 'updated-id-1',
      project: 'test-project',
      timestamp: '2024-01-01T00:00:00Z',
      userMessage: 'Hello',
      assistantMessage: 'Hi there!',
      archivePath: conversationPath,
      lineStart: 1,
      lineEnd: 2
    };

    const embedding = new Array(384).fill(0.1);
    insertExchange(db, exchange, embedding);

    // Get the last_indexed timestamp
    const row = db.prepare(`SELECT last_indexed FROM exchanges WHERE id = ?`).get('updated-id-1') as any;
    const lastIndexed = row.last_indexed;
    db.close();

    // Wait a bit, then modify the file
    await new Promise(resolve => setTimeout(resolve, 10));

    // Update the conversation file
    const updatedMessages = [
      ...messages,
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'New message' }, timestamp: '2024-01-01T00:00:02Z' })
    ];
    fs.writeFileSync(conversationPath, updatedMessages.join('\n'));

    // Verify detects outdated file
    const result = await verifyIndex();

    expect(result.outdated.length).toBe(1);
    expect(result.outdated[0].path).toBe(conversationPath);
    expect(result.outdated[0].dbTime).toBe(lastIndexed);
    expect(result.outdated[0].fileTime).toBeGreaterThan(lastIndexed);
  });

  // Note: Parser is resilient to malformed JSON - it skips bad lines
  // Corruption detection would require file system errors or permission issues
  // which are harder to test. Skipping for now as missing summaries is the
  // primary use case for verification.
});

describe('repairIndex', () => {
  const testDir = path.join(os.tmpdir(), 'conversation-repair-test-' + Date.now());
  const projectsDir = path.join(testDir, '.claude', 'projects');
  const archiveDir = path.join(testDir, '.config', 'superpowers', 'conversation-archive');
  const dbPath = path.join(testDir, '.config', 'superpowers', 'conversation-index', 'db.sqlite');

  beforeEach(() => {
    // Create test directories
    fs.mkdirSync(path.join(testDir, '.config', 'superpowers', 'conversation-index'), { recursive: true });
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });

    // Override environment paths for testing
    process.env.TEST_PROJECTS_DIR = projectsDir;
    process.env.TEST_ARCHIVE_DIR = archiveDir;
    process.env.TEST_DB_PATH = dbPath;
  });

  afterEach(() => {
    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
    delete process.env.TEST_PROJECTS_DIR;
    delete process.env.TEST_ARCHIVE_DIR;
    delete process.env.TEST_DB_PATH;
  });

  it('deletes orphaned database entries during repair', async () => {
    // Initialize database with orphaned entry
    const db = initDatabase();

    const exchange: ConversationExchange = {
      id: 'orphan-repair-1',
      project: 'deleted-project',
      timestamp: '2024-01-01T00:00:00Z',
      userMessage: 'This conversation was deleted',
      assistantMessage: 'But still in database',
      archivePath: path.join(archiveDir, 'deleted-project', 'deleted.jsonl'),
      lineStart: 1,
      lineEnd: 2
    };

    const embedding = new Array(384).fill(0.1);
    insertExchange(db, exchange, embedding);
    db.close();

    // Verify it's there
    const dbBefore = initDatabase();
    const beforeCount = dbBefore.prepare(`SELECT COUNT(*) as count FROM exchanges WHERE id = ?`).get('orphan-repair-1') as { count: number };
    expect(beforeCount.count).toBe(1);
    dbBefore.close();

    // Run repair
    const issues = await verifyIndex();
    expect(issues.orphaned.length).toBe(1);
    await repairIndex(issues);

    // Verify it's gone
    const dbAfter = initDatabase();
    const afterCount = dbAfter.prepare(`SELECT COUNT(*) as count FROM exchanges WHERE id = ?`).get('orphan-repair-1') as { count: number };
    expect(afterCount.count).toBe(0);
    dbAfter.close();
  });

  it('re-indexes outdated files during repair', { timeout: 30000 }, async () => {
    // Create conversation file with summary
    const projectArchive = path.join(archiveDir, 'test-project');
    fs.mkdirSync(projectArchive, { recursive: true });

    const conversationPath = path.join(projectArchive, 'outdated-repair.jsonl');
    const summaryPath = conversationPath.replace('.jsonl', '-summary.txt');

    // Create initial conversation
    const messages = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' }, timestamp: '2024-01-01T00:00:00Z' }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Hi there!' }, timestamp: '2024-01-01T00:00:01Z' })
    ];
    fs.writeFileSync(conversationPath, messages.join('\n'));
    fs.writeFileSync(summaryPath, 'Old summary');

    // Index it
    const db = initDatabase();
    const exchange: ConversationExchange = {
      id: 'outdated-repair-1',
      project: 'test-project',
      timestamp: '2024-01-01T00:00:00Z',
      userMessage: 'Hello',
      assistantMessage: 'Hi there!',
      archivePath: conversationPath,
      lineStart: 1,
      lineEnd: 2
    };

    const embedding = new Array(384).fill(0.1);
    insertExchange(db, exchange, embedding);

    // Get the last_indexed timestamp
    const beforeRow = db.prepare(`SELECT last_indexed FROM exchanges WHERE id = ?`).get('outdated-repair-1') as any;
    const beforeIndexed = beforeRow.last_indexed;
    db.close();

    // Wait a bit, then modify the file
    await new Promise(resolve => setTimeout(resolve, 10));

    // Update the conversation file (add new exchange)
    const updatedMessages = [
      ...messages,
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'New message' }, timestamp: '2024-01-01T00:00:02Z' }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'New response' }, timestamp: '2024-01-01T00:00:03Z' })
    ];
    fs.writeFileSync(conversationPath, updatedMessages.join('\n'));

    // Verify detects outdated
    const issues = await verifyIndex();
    expect(issues.outdated.length).toBe(1);

    // Wait a bit to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 10));

    // Run repair
    await repairIndex(issues);

    // Verify it was re-indexed with new timestamp
    const dbAfter = initDatabase();
    const afterRow = dbAfter.prepare(`SELECT MAX(last_indexed) as last_indexed FROM exchanges WHERE archive_path = ?`).get(conversationPath) as any;
    expect(afterRow.last_indexed).toBeGreaterThan(beforeIndexed);

    // Verify no longer outdated
    const verifyAfter = await verifyIndex();
    expect(verifyAfter.outdated.length).toBe(0);

    dbAfter.close();
  });
});
