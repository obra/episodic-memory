import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync,
  appendFileSync, utimesSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

// Capture every embedding input and every summarizer call. sync.ts loads both
// via dynamic import and indexer.ts statically; vi.mock intercepts both.
const { embedSpy, summarizeSpy } = vi.hoisted(() => ({
  embedSpy: vi.fn(async (..._args: unknown[]) => new Array(384).fill(0)),
  summarizeSpy: vi.fn(async (..._args: unknown[]) => 'A summary.'),
}));
vi.mock('../src/embeddings.js', () => ({
  initEmbeddings: vi.fn(async () => {}),
  generateExchangeEmbedding: embedSpy,
  generateQueryEmbedding: vi.fn(async () => new Array(384).fill(0)),
  generateEmbedding: vi.fn(),
  initEmbeddingsFailed: false,
}));
vi.mock('../src/summarizer.js', async () => {
  const actual = await vi.importActual<typeof import('../src/summarizer.js')>('../src/summarizer.js');
  return { ...actual, summarizeConversation: summarizeSpy };
});

import { syncConversations } from '../src/sync.js';
import { indexUnprocessed } from '../src/indexer.js';
import { searchConversations } from '../src/search.js';
import { formatConversationAsMarkdown } from '../src/show.js';
import { exportOpencodeSessions } from '../src/opencode-sync.js';
import { createRedactor, DEFAULT_REDACTION_CONFIG } from '../src/redaction.js';
import { FakeSecrets } from './fake-secrets.js';

const SESSION = '4f1c2b3a-1111-4222-8333-944455556666';

interface Seed {
  secrets: string[];
  sha: string;
  guid: string;
}

function seedSecrets(seed: number): Seed {
  const fake = new FakeSecrets(seed);
  return {
    secrets: [
      fake.azureClientSecret(),
      fake.azureStorageKey(),
      fake.sasSignature(),
      fake.githubToken(),
      fake.anthropicKey(),
      fake.password(),
      fake.jwt(),
      fake.privateKeyBlock().split('\n')[2],
    ],
    sha: fake.gitSha(),
    guid: fake.guid(),
  };
}

function claudeTranscript(s: Seed): string {
  const [clientSecret, storageKey, sasSig, ghToken, antKey, password, jwt] = s.secrets;
  const keyBlock = (() => {
    // Rebuild the block whose body line is s.secrets[7].
    const dashes = '-'.repeat(5);
    return `${dashes}BEGIN RSA PRIVATE` + ` KEY${dashes}\n${s.secrets[7]}\n${dashes}END RSA PRIVATE` + ` KEY${dashes}`;
  })();
  const ts = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
  const base = { sessionId: SESSION, isSidechain: false, cwd: '/work/contoso', gitBranch: 'main', version: '2.0.0' };
  const lines = [
    {
      ...base, type: 'user', uuid: 'u1', parentUuid: null, timestamp: ts(1),
      message: {
        role: 'user',
        content: `Deploy with client secret ${clientSecret} for tenant ${s.guid}; last good commit ${s.sha}`,
      },
    },
    {
      ...base, type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: ts(2),
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking the storage account keys.' },
          {
            type: 'tool_use', id: 'toolu_1', name: 'Bash',
            input: { command: `az storage blob upload --connection-string "AccountName=contosodata;AccountKey=${storageKey}" --sas-token "sv=2022-11-02&sig=${sasSig}"` },
          },
        ],
      },
    },
    {
      ...base, type: 'user', uuid: 'u2', parentUuid: 'a1', timestamp: ts(3),
      message: {
        role: 'user',
        content: [{
          type: 'tool_result', tool_use_id: 'toolu_1',
          content: `GITHUB_TOKEN=${ghToken}\nANTHROPIC_API_KEY=${antKey}\npassword: ${password}\n${keyBlock}`,
        }],
      },
    },
    {
      ...base, type: 'assistant', uuid: 'a2', parentUuid: 'u2', timestamp: ts(4),
      message: { role: 'assistant', content: [{ type: 'text', text: `Uploaded. The bearer was Bearer ${jwt}.` }] },
    },
  ];
  return lines.map(l => JSON.stringify(l)).join('\n') + '\n';
}

function codexRollout(s: Seed): string {
  const [clientSecret, storageKey] = s.secrets;
  const lines = [
    { timestamp: '2026-05-12T18:00:00.000Z', type: 'session_meta', payload: { id: '019e4c75-d5bf-7c71-9df7-77f5fb86b711', cwd: '/work/contoso', cli_version: '0.130.0', model_provider: 'openai' } },
    { timestamp: '2026-05-12T18:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `Rotate ${clientSecret} please` }] } },
    { timestamp: '2026-05-12T18:00:04.000Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: `echo AccountKey=${storageKey}` }), call_id: 'c1' } },
    { timestamp: '2026-05-12T18:00:05.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: `AccountKey=${storageKey}` } },
    { timestamp: '2026-05-12T18:00:06.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Rotated.' }] } },
  ];
  return lines.map(l => JSON.stringify(l)).join('\n') + '\n';
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

function dbText(dbPath: string): string {
  if (!existsSync(dbPath)) return '';
  const db = new Database(dbPath, { readonly: true });
  sqliteVec.load(db);
  try {
    const ex = db.prepare('SELECT user_message, assistant_message FROM exchanges').all();
    const tc = db.prepare('SELECT tool_input, tool_result FROM tool_calls').all();
    return JSON.stringify([ex, tc]);
  } finally {
    db.close();
  }
}

function expectNoSecrets(haystack: string, s: Seed, where: string) {
  for (const secret of s.secrets) {
    expect(haystack.includes(secret), `${where} leaked a seeded secret`).toBe(false);
  }
}

describe('redaction pipeline', () => {
  let root: string;
  let sourceDir: string;
  let archiveDir: string;
  let dbPath: string;
  let logged: string[];
  const savedEnv = { ...process.env };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'episodic-memory-redaction-pipeline-'));
    sourceDir = join(root, 'source');
    archiveDir = join(root, 'archive');
    dbPath = join(root, 'db.sqlite');
    mkdirSync(join(sourceDir, '-work-contoso'), { recursive: true });
    process.env.TEST_DB_PATH = dbPath;
    process.env.TEST_PROJECTS_DIR = sourceDir;
    process.env.TEST_ARCHIVE_DIR = archiveDir;
    process.env.EPISODIC_MEMORY_CONFIG_DIR = join(root, 'config');
    delete process.env.EPISODIC_MEMORY_REDACTION;
    delete process.env.EPISODIC_MEMORY_REDACTION_RULES;
    delete process.env.EPISODIC_MEMORY_REDACTION_STRICT;
    delete process.env.EPISODIC_MEMORY_SKIP_SUMMARIES;

    embedSpy.mockClear();
    summarizeSpy.mockClear();
    logged = [];
    for (const method of ['log', 'error', 'warn', 'info'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...savedEnv };
    rmSync(root, { recursive: true, force: true });
  });

  it('a seeded secret appears in zero of: archive, SQLite, embedding input, summarizer input, logs', async () => {
    const s = seedSecrets(2024);
    const claudeSrc = join(sourceDir, '-work-contoso', `${SESSION}.jsonl`);
    writeFileSync(claudeSrc, claudeTranscript(s));
    writeFileSync(join(sourceDir, '-work-contoso', 'rollout-2026-05-12T18-00-00-019e4c75-d5bf-7c71-9df7-77f5fb86b711.jsonl'), codexRollout(s));

    const result = await syncConversations(sourceDir, archiveDir);
    expect(result.errors).toEqual([]);
    expect(result.copied).toBe(2);
    expect(result.indexed).toBe(2);
    expect(result.summarized).toBe(2);
    expect(result.redactions?.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.redactions)).not.toMatch(/[A-Za-z0-9+/]{30,}/);

    // (1) archive
    const archived = walkFiles(archiveDir).filter(f => f.endsWith('.jsonl'));
    expect(archived.length).toBe(2);
    for (const file of archived) {
      const text = readFileSync(file, 'utf-8');
      expectNoSecrets(text, s, `archive ${file}`);
      expect(text).toContain('[REDACTED:');
    }

    // (2) SQLite text columns (exchanges + tool_calls)
    const stored = dbText(dbPath);
    expect(stored.length).toBeGreaterThan(0);
    expectNoSecrets(stored, s, 'SQLite');
    expect(stored).toContain('[REDACTED:');

    // (3) embedding input
    expect(embedSpy).toHaveBeenCalled();
    expectNoSecrets(JSON.stringify(embedSpy.mock.calls), s, 'embedding input');

    // (4) summarizer input — and resume/fork must be off, since those paths
    // would hand the model the unredacted source transcript.
    expect(summarizeSpy).toHaveBeenCalledTimes(2);
    expectNoSecrets(JSON.stringify(summarizeSpy.mock.calls), s, 'summarizer input');
    for (const call of summarizeSpy.mock.calls) {
      expect(call[2]).toMatchObject({ allowResume: false });
    }

    // (5) logs
    expectNoSecrets(logged.join('\n'), s, 'console output');
  });

  it('archive stays valid JSONL with the same line count, and show/read still render it', async () => {
    const s = seedSecrets(7);
    const src = join(sourceDir, '-work-contoso', `${SESSION}.jsonl`);
    writeFileSync(src, claudeTranscript(s));
    await syncConversations(sourceDir, archiveDir, { skipSummaries: true });

    const archived = join(archiveDir, '-work-contoso', `${SESSION}.jsonl`);
    const srcLines = readFileSync(src, 'utf-8').split('\n');
    const outLines = readFileSync(archived, 'utf-8').split('\n');
    expect(outLines.length).toBe(srcLines.length);
    outLines.filter(Boolean).forEach(l => expect(() => JSON.parse(l)).not.toThrow());

    // The archive keeps the source mtime so the next sync treats it as current.
    expect(Math.abs(statSync(archived).mtimeMs - statSync(src).mtimeMs)).toBeLessThan(2);
    const again = await syncConversations(sourceDir, archiveDir, { skipSummaries: true });
    expect(again.copied).toBe(0);

    const md = formatConversationAsMarkdown(readFileSync(archived, 'utf-8'));
    expect(md).toContain('[REDACTED:azure-client-secret]');
    expectNoSecrets(md, s, 'show output');
  });

  it('git SHAs and GUIDs remain findable via text search', async () => {
    const s = seedSecrets(31);
    writeFileSync(join(sourceDir, '-work-contoso', `${SESSION}.jsonl`), claudeTranscript(s));
    await syncConversations(sourceDir, archiveDir, { skipSummaries: true });

    const bySha = await searchConversations(s.sha, { mode: 'text' });
    expect(bySha.length).toBe(1);
    const byGuid = await searchConversations(s.guid, { mode: 'text' });
    expect(byGuid.length).toBe(1);
    const byToken = await searchConversations('[REDACTED:azure-client-secret]', { mode: 'text' });
    expect(byToken.length).toBe(1);
  });

  it('fails closed in strict mode: a corrupt rules file leaves no new archive or index content', async () => {
    const s = seedSecrets(5);
    writeFileSync(join(sourceDir, '-work-contoso', `${SESSION}.jsonl`), claudeTranscript(s));
    const rules = join(root, 'rules.json');
    writeFileSync(rules, '{ "rules": [ { "id": "x", "pattern": "(" } ] }');
    process.env.EPISODIC_MEMORY_REDACTION_RULES = rules;

    await expect(syncConversations(sourceDir, archiveDir)).rejects.toThrow(/redaction/i);
    expect(walkFiles(archiveDir)).toEqual([]);
    expect(dbText(dbPath)).toBe('');
    expect(embedSpy).not.toHaveBeenCalled();
    expect(summarizeSpy).not.toHaveBeenCalled();
  });

  it('EPISODIC_MEMORY_REDACTION=off restores the byte-for-byte copy and resume-capable summaries', async () => {
    process.env.EPISODIC_MEMORY_REDACTION = 'off';
    const s = seedSecrets(8);
    const src = join(sourceDir, '-work-contoso', `${SESSION}.jsonl`);
    writeFileSync(src, claudeTranscript(s));
    await syncConversations(sourceDir, archiveDir);
    expect(readFileSync(join(archiveDir, '-work-contoso', `${SESSION}.jsonl`), 'utf-8')).toBe(readFileSync(src, 'utf-8'));
    expect(summarizeSpy.mock.calls[0][2]).toMatchObject({ allowResume: true });
  });

  it('.NET/Azure key-context secrets (no recognizable shape) never reach archive or SQLite', async () => {
    const fake = new FakeSecrets(1999);
    const appsettingsSecret = fake.passphrase();
    const appSettingValue = fake.passphrase();
    const vaultValue = fake.passphrase();
    const mcpSecret = fake.passphrase();
    const seed: Seed = { secrets: [appsettingsSecret, appSettingValue, vaultValue, mcpSecret], sha: fake.gitSha(), guid: fake.guid() };
    const base = { sessionId: SESSION, isSidechain: false, cwd: '/work/contoso' };
    const lines = [
      { ...base, type: 'user', uuid: 'u1', parentUuid: null, timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: 'Why does the API fail to get a token?' } },
      { ...base, type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-01-01T00:00:01Z', message: { role: 'assistant', content: [
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/work/contoso/appsettings.Development.json' } },
      ] } },
      { ...base, type: 'user', uuid: 'u2', parentUuid: 'a1', timestamp: '2026-01-01T00:00:02Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify({ AzureAd: { TenantId: seed.guid, ClientSecret: appsettingsSecret } }, null, 2) }] } },
      { ...base, type: 'assistant', uuid: 'a2', parentUuid: 'u2', timestamp: '2026-01-01T00:00:03Z', message: { role: 'assistant', content: [
        { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'az webapp config appsettings list -g rg -n app && az keyvault secret show --vault-name kv -n Db' } },
      ] } },
      { ...base, type: 'user', uuid: 'u3', parentUuid: 'a2', timestamp: '2026-01-01T00:00:04Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content:
          JSON.stringify([{ name: 'Stripe__ApiKey', slotSetting: false, value: appSettingValue }], null, 2) + '\n' +
          JSON.stringify({ id: 'https://kv.vault.azure.net/secrets/Db/0123', value: vaultValue }, null, 2) }] },
        toolUseResult: { structuredContent: { name: 'GraphClientSecret', value: mcpSecret } } },
      { ...base, type: 'assistant', uuid: 'a3', parentUuid: 'u3', timestamp: '2026-01-01T00:00:05Z', message: { role: 'assistant', content: [{ type: 'text', text: 'The client secret has expired.' }] } },
    ];
    writeFileSync(join(sourceDir, '-work-contoso', `${SESSION}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const result = await syncConversations(sourceDir, archiveDir, { skipSummaries: true });
    expect(result.errors).toEqual([]);
    const archived = readFileSync(join(archiveDir, '-work-contoso', `${SESSION}.jsonl`), 'utf-8');
    expectNoSecrets(archived, seed, 'archive');
    expectNoSecrets(dbText(dbPath), seed, 'SQLite');
    expectNoSecrets(JSON.stringify(embedSpy.mock.calls), seed, 'embedding input');
    expect(archived).toContain(seed.guid);
    archived.split('\n').filter(Boolean).forEach(l => expect(() => JSON.parse(l)).not.toThrow());
  });

  it('the `index` path (indexUnprocessed) parses the redacted archive, not the source', async () => {
    const s = seedSecrets(77);
    writeFileSync(join(sourceDir, '-work-contoso', `${SESSION}.jsonl`), claudeTranscript(s));

    await indexUnprocessed(1, false);

    const archived = walkFiles(archiveDir).filter(f => f.endsWith('.jsonl'));
    expect(archived.length).toBe(1);
    expectNoSecrets(readFileSync(archived[0], 'utf-8'), s, 'archive (index path)');
    expectNoSecrets(dbText(dbPath), s, 'SQLite (index path)');
    expectNoSecrets(JSON.stringify(embedSpy.mock.calls), s, 'embedding input (index path)');
    expect(summarizeSpy).toHaveBeenCalledTimes(1);
    expectNoSecrets(JSON.stringify(summarizeSpy.mock.calls), s, 'summarizer input (index path)');
    expect(summarizeSpy.mock.calls[0][2]).toMatchObject({ allowResume: false });
  });

  it('the `index` path refreshes an indexed archive even when the append left the source mtime no newer', async () => {
    const fake = new FakeSecrets(78);
    const secret = fake.azureClientSecret();
    const base = { sessionId: SESSION, isSidechain: false, cwd: '/work/contoso', gitBranch: 'main', version: '2.0.0' };
    const exchange = (n: number, text: string) => [
      { ...base, type: 'user', uuid: `u${n}`, parentUuid: n > 1 ? `a${n - 1}` : null,
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
        message: { role: 'user', content: text } },
      { ...base, type: 'assistant', uuid: `a${n}`, parentUuid: `u${n}`,
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, n, 30)).toISOString(),
        message: { role: 'assistant', content: [{ type: 'text', text: `Reply ${n}.` }] } },
    ].map(l => JSON.stringify(l) + '\n').join('');
    const src = join(sourceDir, '-work-contoso', `${SESSION}.jsonl`);

    writeFileSync(src, exchange(1, 'First question.'));
    await indexUnprocessed(1, true);
    const archived = walkFiles(archiveDir).filter(f => f.endsWith('.jsonl'))[0];
    const archivedMtime = statSync(archived).mtime;

    // Append, then pin the source mtime to the archive's: copyIfNewer's mtime
    // check alone would treat the archive as current.
    appendFileSync(src, exchange(2, `Second question with ${secret} as the secret`));
    utimesSync(src, archivedMtime, archivedMtime);
    await indexUnprocessed(1, true);

    const text = dbText(dbPath);
    expect(text).toContain('Second question with [REDACTED:');
    expect(text).not.toContain(secret);
  });
});

describe('redaction: opencode staging export', () => {
  let root: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'episodic-memory-redaction-opencode-'));
    process.env.EPISODIC_MEMORY_OPENCODE_DB_PATH = join(root, 'opencode.db');
    process.env.EPISODIC_MEMORY_OPENCODE_TRANSCRIPT_DIR = join(root, 'transcripts');
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    rmSync(root, { recursive: true, force: true });
  });

  it('redacts secrets before the staging JSONL is written', () => {
    const fake = new FakeSecrets(55);
    const secret = fake.azureStorageKey();
    const db = new Database(join(root, 'opencode.db'));
    db.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL, name TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, sandboxes TEXT NOT NULL);
      CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL, directory TEXT NOT NULL, title TEXT NOT NULL, version TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, agent TEXT, model TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    `);
    db.prepare(`INSERT INTO project VALUES ('p1', '/work/x', 'X', 1700000000000, 1700000000000, '[]')`).run();
    db.prepare(`INSERT INTO session VALUES ('ses_1', 'p1', 's', '/work/x', 'T', '1.0.0', 1700000000000, 1700000004000, 'build', NULL)`).run();
    db.prepare(`INSERT INTO message VALUES ('m1', 'ses_1', 1700000001000, 1700000001000, ?)`).run(JSON.stringify({ role: 'user' }));
    db.prepare(`INSERT INTO part VALUES ('pt1', 'm1', 'ses_1', 1700000001000, 1700000001000, ?)`).run(
      JSON.stringify({ type: 'text', text: `AccountKey=${secret}` })
    );
    db.close();

    const result = exportOpencodeSessions({ redactor: createRedactor(DEFAULT_REDACTION_CONFIG) });
    expect(result.exported).toBe(1);
    const files = walkFiles(join(root, 'transcripts'));
    expect(files.length).toBe(1);
    const text = readFileSync(files[0], 'utf-8');
    expect(text).not.toContain(secret);
    expect(text).toContain('[REDACTED:connection-string-secret]');
  });
});
