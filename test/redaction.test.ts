import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, chmodSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  createRedactor,
  loadRedactor,
  loadRedactionConfig,
  getRedactionSettings,
  redactJsonlLine,
  copyFileRedacted,
  FindingsTally,
  RedactionConfigError,
  DEFAULT_REDACTION_CONFIG,
  type Redactor,
} from '../src/redaction.js';
import { FakeSecrets, redactionTokens } from './fake-secrets.js';

const ctx = { source: 'test', path: '/tmp/x.jsonl' };

function defaults(): Redactor {
  return createRedactor(DEFAULT_REDACTION_CONFIG);
}

/** Assert `secret` is gone, the expected token is present, and findings name the rule. */
function expectRedacted(redactor: Redactor, text: string, secret: string, ruleId: string) {
  const result = redactor.redact(text, ctx);
  expect(result.text).not.toContain(secret);
  expect(result.text).toContain(`[REDACTED:${ruleId}]`);
  expect(result.findings.find(f => f.ruleId === ruleId)?.count ?? 0).toBeGreaterThan(0);
  // Findings carry rule IDs and counts, never the matched value.
  expect(JSON.stringify(result.findings)).not.toContain(secret);
  return result;
}

describe('redaction: default rules (positive)', () => {
  let fake: FakeSecrets;
  let redactor: Redactor;

  beforeEach(() => {
    fake = new FakeSecrets(42);
    redactor = defaults();
  });

  it('azure-client-secret in pasted `az ad sp credential reset` output', () => {
    const secret = fake.azureClientSecret();
    const text = `{\n  "appId": "${fake.guid()}",\n  "password": "${secret}",\n  "tenant": "${fake.guid()}"\n}`;
    expectRedacted(redactor, text, secret, 'azure-client-secret');
  });

  it('azure-client-secret bare in prose', () => {
    const secret = fake.azureClientSecret();
    expectRedacted(redactor, `use ${secret} as the client secret`, secret, 'azure-client-secret');
  });

  it('azure-client-secret at the end of a sentence', () => {
    const secret = fake.azureClientSecret();
    const out = expectRedacted(redactor, `The client secret is ${secret}.`, secret, 'azure-client-secret');
    expect(out.text).toBe('The client secret is [REDACTED:azure-client-secret].');
  });

  it('azure-storage-key in `az storage account keys list` output', () => {
    const secret = fake.azureStorageKey();
    const text = `[\n  {\n    "keyName": "key1",\n    "permissions": "FULL",\n    "value": "${secret}"\n  }\n]`;
    expectRedacted(redactor, text, secret, 'azure-storage-key');
  });

  it('connection-string-secret redacts only the value, keeping account and endpoint searchable', () => {
    const key = fake.azureStorageKey();
    const text = `DefaultEndpointsProtocol=https;AccountName=contosodata;AccountKey=${key};EndpointSuffix=core.windows.net`;
    const result = expectRedacted(redactor, text, key, 'connection-string-secret');
    expect(result.text).toContain('AccountName=contosodata');
    expect(result.text).toContain('EndpointSuffix=core.windows.net');
  });

  it('connection-string-secret in an appsettings.json blob (SQL Server password field)', () => {
    const pw = fake.password();
    const text = JSON.stringify({
      ConnectionStrings: {
        Default: `Server=tcp:contoso-sql.database.windows.net,1433;Database=orders;User ID=app;Password=${pw};Encrypt=True;`,
      },
    }, null, 2);
    const result = expectRedacted(redactor, text, pw, 'connection-string-secret');
    expect(result.text).toContain('contoso-sql.database.windows.net');
    expect(result.text).toContain('Database=orders');
  });

  it('connection-string-secret for Service Bus SharedAccessKey', () => {
    const key = fake.chars('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', 43) + '=';
    const text = `Endpoint=sb://contoso.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=${key}`;
    const result = expectRedacted(redactor, text, key, 'connection-string-secret');
    expect(result.text).toContain('SharedAccessKeyName=RootManageSharedAccessKey');
  });

  it('connection-string-secret keywords are case-insensitive, as in ADO.NET', () => {
    // Letters only: secret-assignment needs a digit, so this rule is the only catch.
    const pw = fake.chars('abcdefghijklmnopqrstuvwxyz', 19);
    for (const keyword of ['password', 'PASSWORD', 'pwd', 'accountkey']) {
      const result = expectRedacted(redactor, `Server=db;Database=app;${keyword}=${pw};`, pw, 'connection-string-secret');
      expect(result.text).toContain(`${keyword}=[REDACTED:connection-string-secret];`);
    }
  });

  it('azure-sas-token redacts the sig while keeping the blob URL', () => {
    const sig = fake.sasSignature();
    const text = `https://contoso.blob.core.windows.net/backups/db.bak?sv=2022-11-02&ss=b&srt=co&sp=rl&se=2026-12-31T00:00:00Z&sig=${sig}`;
    const result = expectRedacted(redactor, text, sig, 'azure-sas-token');
    expect(result.text).toContain('https://contoso.blob.core.windows.net/backups/db.bak?sv=2022-11-02');
  });

  it('private-key-block (multi-line, PEM)', () => {
    const block = fake.privateKeyBlock('RSA');
    const body = block.split('\n')[2];
    const result = expectRedacted(redactor, `cat key.pem\n${block}\n$ `, body, 'private-key-block');
    expect(result.text).not.toContain('PRIVATE KEY');
  });

  it('private-key-block (OPENSSH, escaped newlines as in nested JSON)', () => {
    const block = fake.privateKeyBlock('OPENSSH').replace(/\n/g, '\\n');
    const body = block.split('\\n')[3];
    expectRedacted(redactor, `{"content":"${block}"}`, body, 'private-key-block');
  });

  it('private-key-block truncated (no END marker) is still redacted to end of text', () => {
    const block = fake.privateKeyBlock('EC');
    const truncated = block.split('\n').slice(0, 4).join('\n');
    const body = truncated.split('\n')[2];
    expectRedacted(redactor, truncated, body, 'private-key-block');
  });

  it('jwt (Azure access token from `az account get-access-token`)', () => {
    const token = fake.jwt();
    const text = `{\n  "accessToken": "${token}",\n  "expiresOn": "2026-10-04 12:00:00.000000",\n  "tokenType": "Bearer"\n}`;
    const result = redactor.redact(text, ctx);
    expect(result.text).not.toContain(token);
    expect(redactionTokens(result.text).length).toBeGreaterThan(0);
  });

  it('bearer-token in an Authorization header', () => {
    const token = fake.bearerOpaque();
    expectRedacted(redactor, `curl -H "Authorization: Bearer ${token}" https://api.example.com`, token, 'bearer-token');
  });

  it('basic-auth in an Authorization header', () => {
    const token = fake.basicAuth();
    expectRedacted(redactor, `Authorization: Basic ${token}`, token, 'basic-auth');
  });

  it('anthropic-api-key', () => {
    const key = fake.anthropicKey();
    expectRedacted(redactor, `export ANTHROPIC_API_KEY=${key}`, key, 'anthropic-api-key');
  });

  it('openai-api-key', () => {
    const key = fake.openAiKey();
    expectRedacted(redactor, `OPENAI_API_KEY="${key}"`, key, 'openai-api-key');
  });

  it('github-token (classic) and fine-grained PAT', () => {
    const classic = fake.githubToken();
    expectRedacted(redactor, `git remote set-url origin https://${classic}@github.com/o/r.git`, classic, 'github-token');
    const fine = fake.githubFineGrainedPat();
    expectRedacted(redactor, `GH_TOKEN=${fine}`, fine, 'github-token');
  });

  it('aws-access-key-id and aws-secret-access-key in ~/.aws/credentials', () => {
    const id = fake.awsAccessKeyId();
    const secret = fake.awsSecretAccessKey();
    const text = `[default]\naws_access_key_id = ${id}\naws_secret_access_key = ${secret}\n`;
    expectRedacted(redactor, text, id, 'aws-access-key-id');
    expectRedacted(redactor, text, secret, 'aws-secret-access-key');
  });

  it('slack-token, google-api-key, npm-token', () => {
    const slack = fake.slackToken();
    expectRedacted(redactor, `SLACK_BOT_TOKEN=${slack}`, slack, 'slack-token');
    const google = fake.googleApiKey();
    expectRedacted(redactor, `key=${google}&q=coffee`, google, 'google-api-key');
    const npm = fake.npmToken();
    expectRedacted(redactor, `//registry.npmjs.org/:_authToken=${npm}`, npm, 'npm-token');
  });

  it('url-credentials redacts only the password', () => {
    const pw = fake.password().replace(/[#%^*!]/g, 'x');
    const text = `DATABASE_URL=postgres://app_user:${pw}@db.internal:5432/orders`;
    const result = expectRedacted(redactor, text, pw, 'url-credentials');
    expect(result.text).toContain('app_user');
    expect(result.text).toContain('@db.internal:5432/orders');
  });

  it('secret-assignment covers env, YAML, and JSON shapes (decrypted SOPS output)', () => {
    const a = fake.password();
    const b = fake.password();
    const c = fake.password();
    const yaml = `database:\n  host: db.internal\n  password: ${a}\nazure:\n  client_secret: "${b}"\n`;
    const env = `AZURE_CLIENT_SECRET=${c}`;
    for (const [text, secret] of [[yaml, a], [yaml, b], [env, c]] as const) {
      const result = redactor.redact(text, ctx);
      expect(result.text).not.toContain(secret);
    }
    expect(redactor.redact(yaml, ctx).text).toContain('host: db.internal');
  });

  it('quoted-secret-assignment redacts a JSON "clientSecret" field', () => {
    const secret = fake.password();
    expectRedacted(redactor, JSON.stringify({ clientId: fake.guid(), clientSecret: secret }), secret, 'quoted-secret-assignment');
  });
});

describe('redaction: allowlist and false-positive resistance (negative)', () => {
  let fake: FakeSecrets;
  let redactor: Redactor;

  beforeEach(() => {
    fake = new FakeSecrets(7);
    redactor = defaults();
  });

  function expectUntouched(text: string) {
    const result = redactor.redact(text, ctx);
    expect(result.text).toBe(text);
    expect(result.findings).toEqual([]);
  }

  it('git SHAs (full and short) survive', () => {
    const sha = fake.gitSha();
    expectUntouched(`commit ${sha}\nAuthor: someone\n\n    fix: thing (${sha.slice(0, 7)})`);
  });

  it('a git SHA assigned to a token-like key is still allowlisted', () => {
    const sha = fake.gitSha();
    expectUntouched(`token: ${sha}`);
  });

  it('GUIDs (tenant, client, object IDs) survive', () => {
    expectUntouched(JSON.stringify({ tenantId: fake.guid(), clientId: fake.guid(), objectId: fake.guid() }));
  });

  it('ARM resource IDs survive', () => {
    expectUntouched(
      `/subscriptions/${fake.guid()}/resourceGroups/rg-prod-eastus/providers/Microsoft.Storage/storageAccounts/contosodata`
    );
  });

  it('error codes and HTTP statuses survive', () => {
    expectUntouched('AADSTS7000215: Invalid client secret provided. Status: 401 Unauthorized. AuthorizationFailed (403)');
  });

  it('base64 image data survives', () => {
    expectUntouched(JSON.stringify({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo' + fake.base64Blob(20000) + '==' } }));
  });

  it('npm integrity hashes (sha512, 88 chars) survive', () => {
    expectUntouched(`"integrity": "sha512-${fake.base64Blob(86)}=="`);
  });

  it('minified JS survives', () => {
    expectUntouched(
      'function a(e,t){var n=e.password,r=t.token;return n&&r?{password:n,token:r,expires_in:3600}:null}' +
      'const s=new URLSearchParams({grant_type:"client_credentials"});'
    );
  });

  it('code that reads secrets (not literals) survives', () => {
    expectUntouched('const password = getPassword();\nconst token = process.env.GITHUB_TOKEN;\npassword = os.environ["DB_PASSWORD"]');
  });

  it('member-access references to secrets survive, even with digits (env.AUTH0_CLIENT_SECRET)', () => {
    expectUntouched('client_id: env.AUTH0_CLIENT_ID,\n  client_secret: env.AUTH0_CLIENT_SECRET,\n  token: this.config.apiToken2;');
  });

  it('placeholders and SOPS-encrypted values survive', () => {
    expectUntouched('password: ${DB_PASSWORD}\nclient_secret: <your-secret-here>\napi_key: ENC[AES256_GCM,data:abc,iv:def,tag:ghi,type:str]');
  });

  it('PWD and other env noise survive', () => {
    expectUntouched('PWD=/home/user1/src/project2\nOLDPWD=/home/user1\nmax_tokens: 4096\ntokenizer: bert-base-uncased');
  });

  it('Markdown about connection-string keywords survives', () => {
    expectUntouched('Set `AccountKey=`, `SharedAccessKey=`, `Password=` or `Pwd=` in the connection string.');
  });

  it('prose about tokens and passwords survives', () => {
    expectUntouched('Rotate the bearer token every 90 days. Basic authentication is disabled. The password policy requires 14 characters.');
  });
});

describe('redaction: idempotency', () => {
  it('redacting already-redacted text is a no-op and tokens match no rule', () => {
    const fake = new FakeSecrets(99);
    const redactor = defaults();
    const text = [
      `AccountKey=${fake.azureStorageKey()}`,
      `password: ${fake.password()}`,
      `Authorization: Bearer ${fake.jwt()}`,
      fake.privateKeyBlock(),
      `client secret ${fake.azureClientSecret()}`,
      `https://u:${fake.password().replace(/[#%^*!]/g, 'y')}@host/x`,
    ].join('\n');
    const once = redactor.redact(text, ctx);
    expect(once.findings.length).toBeGreaterThan(0);
    const twice = redactor.redact(once.text, ctx);
    expect(twice.text).toBe(once.text);
    expect(twice.findings).toEqual([]);
  });

  it('every token for every default rule id is inert', () => {
    const redactor = defaults();
    for (const id of redactor.ruleIds) {
      for (const shape of [`[REDACTED:${id}]`, `password: [REDACTED:${id}]`, `Bearer [REDACTED:${id}]`, `AccountKey=[REDACTED:${id}];`]) {
        const result = redactor.redact(shape, ctx);
        expect(result.findings, `${id} in ${shape}`).toEqual([]);
      }
    }
  });

  it('a match that runs into an existing token redacts the part outside it, keeping the token', () => {
    // Text already partly redacted, e.g. by an older rule set before `redact --rewrite`.
    const redactor = defaults();
    const fake = new FakeSecrets(12);
    const prefix = fake.chars('abcdefghijklmnopqrstuvwxyz0123456789', 10);
    const once = redactor.redact(`Server=db;Password=${prefix}[REDACTED:jwt];`, ctx);
    expect(once.text).toBe('Server=db;Password=[REDACTED:connection-string-secret][REDACTED:jwt];');
    const twice = redactor.redact(once.text, ctx);
    expect(twice.text).toBe(once.text);
    expect(twice.findings).toEqual([]);
  });
});

describe('redaction: entropy fallback', () => {
  it('is off by default', () => {
    const fake = new FakeSecrets(3);
    const blob = fake.opaqueHighEntropy();
    const result = defaults().redact(`the signing value is ${blob}`, ctx);
    expect(result.text).toContain(blob);
  });

  it('when enabled, fires near a keyword but not elsewhere or on allowlisted shapes', () => {
    const fake = new FakeSecrets(4);
    const redactor = createRedactor({
      ...DEFAULT_REDACTION_CONFIG,
      entropy: { ...DEFAULT_REDACTION_CONFIG.entropy, enabled: true },
    });
    const blob = fake.opaqueHighEntropy(48);
    const near = redactor.redact(`signing key is ${blob}`, ctx);
    expect(near.text).not.toContain(blob);
    expect(near.text).toContain('[REDACTED:high-entropy]');

    const far = redactor.redact(`the build artifact digest ${fake.opaqueHighEntropy(48)}`, ctx);
    expect(far.findings).toEqual([]);

    const sha = fake.gitSha();
    expect(redactor.redact(`key ${sha}`, ctx).text).toContain(sha);
  });
});

describe('redaction: JSONL line handling', () => {
  const redactor = defaults();
  const fake = new FakeSecrets(11);

  it('redacts string values inside JSON and keeps the line valid JSON', () => {
    const key = fake.azureStorageKey();
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: `AccountKey=${key}` }] },
      uuid: 'u1',
    });
    const out = redactJsonlLine(line, redactor, ctx);
    expect(out).not.toContain(key);
    const parsed = JSON.parse(out);
    expect(parsed.uuid).toBe('u1');
    expect(parsed.message.content[0].content).toBe('AccountKey=[REDACTED:connection-string-secret]');
  });

  it('redacts tool inputs (nested objects) too', () => {
    const pw = fake.password();
    const line = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: `mysql -u root --password=${pw}` } }] },
    });
    const out = redactJsonlLine(line, redactor, ctx);
    expect(out).not.toContain(pw);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('returns unchanged lines byte-for-byte (formatting preserved)', () => {
    const line = '{"type":"user",  "message":{"role":"user","content":"caf\\u00e9 hello"}}';
    expect(redactJsonlLine(line, redactor, ctx)).toBe(line);
  });

  it('redacts non-JSON lines (e.g. a torn last line) as raw text', () => {
    const key = fake.azureStorageKey();
    const torn = `{"type":"user","message":{"content":"AccountKey=${key}`;
    const out = redactJsonlLine(torn, redactor, ctx);
    expect(out).not.toContain(key);
  });

  it('preserves CRLF line endings', () => {
    const pw = fake.password();
    const line = JSON.stringify({ content: `password: ${pw}` }) + '\r';
    const out = redactJsonlLine(line, redactor, ctx);
    expect(out.endsWith('\r')).toBe(true);
    expect(out).not.toContain(pw);
  });

  it('tallies findings by rule id', () => {
    const tally = new FindingsTally();
    redactJsonlLine(JSON.stringify({ a: `password: ${fake.password()}`, b: `password: ${fake.password()}` }), redactor, ctx, tally);
    expect(tally.toArray()).toEqual([{ ruleId: 'secret-assignment', count: 2 }]);
    expect(tally.total).toBe(2);
  });
});

describe('redaction: copyFileRedacted', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'episodic-memory-redact-copy-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('streams a file, keeps one output line per input line, and keeps the trailing-newline shape', () => {
    const fake = new FakeSecrets(5);
    const redactor = defaults();
    const secrets: string[] = [];
    const lines: string[] = [];
    for (let i = 0; i < 3000; i++) {
      if (i % 500 === 0) {
        const s = fake.azureClientSecret();
        secrets.push(s);
        lines.push(JSON.stringify({ type: 'user', i, message: { content: `secret is ${s}` } }));
      } else {
        lines.push(JSON.stringify({ type: 'assistant', i, message: { content: 'x'.repeat(i % 700) } }));
      }
    }
    const src = join(dir, 'src.jsonl');
    const dest = join(dir, 'dest.jsonl');
    writeFileSync(src, lines.join('\n'));  // no trailing newline
    const tally = new FindingsTally();
    copyFileRedacted(src, dest, redactor, ctx, tally);
    const out = readFileSync(dest, 'utf-8');
    for (const s of secrets) expect(out).not.toContain(s);
    expect(out.split('\n').length).toBe(lines.length);
    expect(out.endsWith('\n')).toBe(false);
    expect(tally.total).toBe(secrets.length);
    out.split('\n').forEach(l => expect(() => JSON.parse(l)).not.toThrow());
  });

  it('handles multi-byte UTF-8 across chunk boundaries', () => {
    const redactor = defaults();
    const src = join(dir, 'utf8.jsonl');
    const dest = join(dir, 'utf8-out.jsonl');
    const line = JSON.stringify({ content: '日本語テキスト🙂'.repeat(200_000) });
    writeFileSync(src, line + '\n' + line + '\n');
    copyFileRedacted(src, dest, redactor, ctx);
    expect(readFileSync(dest, 'utf-8')).toBe(readFileSync(src, 'utf-8'));
  });

  // Windows ignores POSIX mode bits.
  it.skipIf(process.platform === 'win32')('creates dest with the source mode, not the 0666 default', () => {
    const src = join(dir, 'private.jsonl');
    const dest = join(dir, 'private-out.jsonl');
    writeFileSync(src, '{"type":"user"}\n');
    chmodSync(src, 0o600);
    copyFileRedacted(src, dest, defaults(), ctx);
    expect(statSync(dest).mode & 0o777).toBe(0o600);
  });
});

describe('redaction: settings and rules loading', () => {
  let dir: string;
  const saved = { ...process.env };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'episodic-memory-redact-cfg-'));
    process.env.EPISODIC_MEMORY_CONFIG_DIR = join(dir, 'config');
    mkdirSync(process.env.EPISODIC_MEMORY_CONFIG_DIR, { recursive: true });
    delete process.env.EPISODIC_MEMORY_REDACTION;
    delete process.env.EPISODIC_MEMORY_REDACTION_RULES;
    delete process.env.EPISODIC_MEMORY_REDACTION_STRICT;
  });

  afterEach(() => {
    process.env = { ...saved };
    rmSync(dir, { recursive: true, force: true });
  });

  it('is on and strict by default', () => {
    expect(getRedactionSettings(process.env)).toMatchObject({ enabled: true, strict: true });
  });

  it('EPISODIC_MEMORY_REDACTION=off disables it', () => {
    process.env.EPISODIC_MEMORY_REDACTION = 'off';
    expect(getRedactionSettings(process.env).enabled).toBe(false);
    expect(loadRedactor(process.env)).toBeNull();
  });

  it('loads the bundled defaults when no rules file exists', () => {
    const redactor = loadRedactor(process.env)!;
    expect(redactor.ruleIds).toEqual(DEFAULT_REDACTION_CONFIG.rules.map(r => r.id));
  });

  it('picks up redaction-rules.json from the config dir and merges it with defaults', () => {
    writeFileSync(join(process.env.EPISODIC_MEMORY_CONFIG_DIR!, 'redaction-rules.json'), JSON.stringify({
      rules: [{ id: 'internal-ticket-secret', pattern: 'TKT-SECRET-[0-9]{6}' }],
      disableRules: ['basic-auth'],
    }));
    const redactor = loadRedactor(process.env)!;
    expect(redactor.ruleIds).toContain('internal-ticket-secret');
    expect(redactor.ruleIds).toContain('azure-storage-key');
    expect(redactor.ruleIds).not.toContain('basic-auth');
    expect(redactor.redact('ref TKT-SECRET-123456', ctx).text).toBe('ref [REDACTED:internal-ticket-secret]');
  });

  it('EPISODIC_MEMORY_REDACTION_RULES points at a custom file; includeDefaults:false replaces the defaults', () => {
    const file = join(dir, 'custom.json');
    writeFileSync(file, JSON.stringify({ includeDefaults: false, rules: [{ id: 'only-this', pattern: 'zzz[0-9]+' }] }));
    process.env.EPISODIC_MEMORY_REDACTION_RULES = file;
    const redactor = loadRedactor(process.env)!;
    expect(redactor.ruleIds).toEqual(['only-this']);
  });

  it('strict mode throws RedactionConfigError on a corrupt rules file', () => {
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{ "rules": [ this is not json');
    process.env.EPISODIC_MEMORY_REDACTION_RULES = file;
    expect(() => loadRedactor(process.env)).toThrow(RedactionConfigError);
  });

  it('strict mode throws when the custom rules path does not exist', () => {
    process.env.EPISODIC_MEMORY_REDACTION_RULES = join(dir, 'missing.json');
    expect(() => loadRedactor(process.env)).toThrow(RedactionConfigError);
  });

  it('non-strict mode warns and returns null (pass-through) on a corrupt rules file', () => {
    const file = join(dir, 'bad.json');
    writeFileSync(file, 'nope');
    process.env.EPISODIC_MEMORY_REDACTION_RULES = file;
    process.env.EPISODIC_MEMORY_REDACTION_STRICT = '0';
    const warn = vi.fn();
    expect(loadRedactor(process.env, warn)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('rejects invalid rules: bad regex, bad id, empty-matching pattern, bad secretGroup', () => {
    const bad = [
      { id: 'bad-regex', pattern: '(unclosed' },
      { id: 'Bad Id!', pattern: 'abc' },
      { id: 'empty-match', pattern: 'a*' },
      { id: 'bad-group', pattern: 'abc', secretGroup: 2 },
    ];
    for (const rule of bad) {
      expect(() => loadRedactionConfig({ includeDefaults: false, rules: [rule] } as any), rule.id).toThrow(RedactionConfigError);
    }
  });

  it('rule-load errors never echo text being redacted (only config details)', () => {
    const file = join(dir, 'bad.json');
    writeFileSync(file, JSON.stringify({ rules: [{ id: 'x', pattern: '(' }] }));
    process.env.EPISODIC_MEMORY_REDACTION_RULES = file;
    try {
      loadRedactor(process.env);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('x');
    }
  });
});

describe('redaction: key context (.NET / Azure shapes)', () => {
  let fake: FakeSecrets;
  let redactor: Redactor;
  beforeEach(() => {
    fake = new FakeSecrets(2112);
    redactor = defaults();
  });

  function expectGone(text: string, secret: string, ruleId?: string) {
    const result = redactor.redact(text, ctx);
    expect(result.text, text).not.toContain(secret);
    if (ruleId) expect(result.text).toContain(`[REDACTED:${ruleId}]`);
    return result;
  }

  it('appsettings.json fields, no digit required when the key is quoted JSON', () => {
    const pw = fake.passphrase();
    const text = JSON.stringify({ AzureAd: { TenantId: fake.guid(), ClientId: fake.guid(), ClientSecret: pw } }, null, 2);
    const r = expectGone(text, pw, 'quoted-secret-assignment');
    expect(r.text).toContain('"TenantId"');
  });

  it('C# object initializers and locals', () => {
    const a = fake.passphrase();
    const b = fake.passphrase();
    expectGone(`var cred = new ClientSecretCredential(tenant, client) { ClientSecret = "${a}", };`, a, 'quoted-secret-assignment');
    expectGone(`string apiKey = "${b}";`, b, 'quoted-secret-assignment');
  });

  it('`az webapp config appsettings list` name/value pairs (name first and value first)', () => {
    const a = fake.passphrase();
    const b = fake.passphrase();
    const text = JSON.stringify([
      { name: 'WEBSITE_RUN_FROM_PACKAGE', slotSetting: false, value: '1' },
      { name: 'Stripe__ApiKey', slotSetting: false, value: a },
      { value: b, slotSetting: true, name: 'DB_PASSWORD' },
    ], null, 2);
    const r = expectGone(text, a, 'name-value-secret');
    expect(r.text).not.toContain(b);
    expect(r.text).toContain('WEBSITE_RUN_FROM_PACKAGE');
    expect(r.text).toContain('"value": "1"');
  });

  it('Kubernetes env entries', () => {
    const a = fake.passphrase();
    expectGone(`env:\n  - {"name": "ConnectionStrings__Redis", "value": "redis:6380"}\n  - {"name": "JWT_SIGNING_KEY", "value": "${a}"}`, a);
  });

  it('`az keyvault secret show` value (any secret name, nested attributes)', () => {
    const a = fake.passphrase();
    const text = JSON.stringify({
      attributes: { created: '2026-01-01T00:00:00+00:00', enabled: true, recoveryLevel: 'Recoverable' },
      contentType: null,
      id: 'https://contoso-kv.vault.azure.net/secrets/StorageThing/0123456789abcdef0123456789abcdef',
      name: 'StorageThing',
      tags: {},
      value: a,
    }, null, 2);
    const r = expectGone(text, a, 'azure-keyvault-secret');
    expect(r.text).toContain('contoso-kv.vault.azure.net/secrets/StorageThing');
  });

  it('web.config appSettings in either attribute order', () => {
    const a = fake.passphrase();
    const b = fake.passphrase();
    expectGone(`<appSettings>\n  <add key="SendGridApiKey" value="${a}" />\n  <add value="${b}" key="AdminPassword"/>\n  <add key="Environment" value="Production" />\n</appSettings>`, a, 'xml-appsettings-secret');
    const r = redactor.redact(`<add value="${b}" key="AdminPassword"/>`, ctx);
    expect(r.text).not.toContain(b);
    expect(redactor.redact('<add key="Environment" value="Production" />', ctx).findings).toEqual([]);
  });

  it('publish profiles and XML secret attributes/elements', () => {
    const a = fake.passphrase();
    const b = fake.passphrase();
    const r = expectGone(`<publishProfile profileName="app - Web Deploy" userName="$contoso-app" userPWD="${a}" destinationAppUrl="https://contoso-app.azurewebsites.net" />`, a, 'xml-secret-attribute');
    expect(r.text).toContain('userName="$contoso-app"');
    expect(r.text).toContain('https://contoso-app.azurewebsites.net');
    expectGone(`<Credentials><ClientSecret>${b}</ClientSecret></Credentials>`, b, 'xml-secret-element');
  });

  it('a GUID in a password slot is redacted (legacy create-for-rbac), but GUID IDs elsewhere are kept', () => {
    const pw = fake.guid();
    const tenant = fake.guid();
    const r = expectGone(JSON.stringify({ appId: fake.guid(), password: pw, tenant }), pw);
    expect(r.text).toContain(tenant);
  });

  it('leaves placeholders, labels and non-secret neighbours alone', () => {
    const untouched = [
      '{"ClientSecret": "#{ClientSecret}#", "ApiKey": "__API_KEY__", "Password": "$(DbPassword)", "Token": "${TOKEN}", "Secret": "<your-secret>"}',
      'ErrorMessage = "Invalid password or username";',
      '{"tokenType": "Bearer", "secretName": "db-password", "maxTokens": "4096", "passwordPolicy": "strict"}',
      'options.Password = configuration["Db:Password"];',
      '<add key="Environment" value="Production" />',
      '{"name": "TokenEndpoint", "value": "https://login.microsoftonline.com/common/oauth2/v2.0/token"}',
      '<UserSecretsId>' + 'a1b2c3d4-0000-1111-2222-333344445555' + '</UserSecretsId>',
      'PWD="/home/user1/src"',
    ];
    for (const text of untouched) {
      const r = redactor.redact(text, ctx);
      expect(r.findings, text).toEqual([]);
    }
  });
});

describe('redaction: structured JSON (field names as context, keys redacted)', () => {
  const redactor = createRedactor(DEFAULT_REDACTION_CONFIG);
  const fake = new FakeSecrets(4242);

  it('redacts a value whose own field name is secret-looking, with no shape match', () => {
    const pw = fake.passphrase();
    const line = JSON.stringify({ type: 'user', toolUseResult: { structuredContent: { clientId: 'app', clientSecret: pw } } });
    const out = redactJsonlLine(line, redactor, ctx);
    expect(out).not.toContain(pw);
    expect(JSON.parse(out).toolUseResult.structuredContent).toEqual({ clientId: 'app', clientSecret: '[REDACTED:secret-field]' });
  });

  it('redacts the value of a {name, value} object whose name is secret-looking', () => {
    const pw = fake.passphrase();
    const line = JSON.stringify({ result: [{ name: 'Db__Password', value: pw }, { name: 'Region', value: 'eastus' }] });
    const out = JSON.parse(redactJsonlLine(line, redactor, ctx));
    expect(out.result).toEqual([{ name: 'Db__Password', value: '[REDACTED:secret-field]' }, { name: 'Region', value: 'eastus' }]);
  });

  it('redacts a structured Key Vault secret bundle value', () => {
    const pw = fake.passphrase();
    const line = JSON.stringify({ result: { id: 'https://kv.vault.azure.net/secrets/Anything/1', value: pw, attributes: { enabled: true } } });
    expect(redactJsonlLine(line, redactor, ctx)).not.toContain(pw);
  });

  it('redacts secrets used as object keys', () => {
    const token = fake.githubToken();
    const line = JSON.stringify({ cache: { [token]: { user: 'octocat' } } });
    const out = redactJsonlLine(line, redactor, ctx);
    expect(out).not.toContain(token);
    expect(JSON.parse(out).cache['[REDACTED:github-token]']).toEqual({ user: 'octocat' });
  });

  it('leaves harness structure alone (thinking signatures, usage, token_count, apiKeySource)', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm', signature: fake.base64Blob(200) }], usage: { input_tokens: 12, output_tokens: 3 } } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1 } } } }),
      JSON.stringify({ type: 'system', subtype: 'init', apiKeySource: 'none', tokenizer: 'cl100k' }),
      JSON.stringify({ secretName: 'db-password', passwordPolicy: 'strict', password: '${DB_PASSWORD}', token: '' }),
    ];
    for (const line of lines) expect(redactJsonlLine(line, redactor, ctx), line).toBe(line);
  });

  it('redacts a secret field whole when a text rule already redacted only part of it', () => {
    const word = fake.chars('abcdefghijklmnopqrstuvwxyz', 12);
    const line = JSON.stringify({ password: `${word} ${fake.jwt()}` });
    const out = redactJsonlLine(line, redactor, ctx);
    expect(out).not.toContain(word);
    expect(JSON.parse(out).password).toBe('[REDACTED:secret-field]');
  });

  it('is idempotent on structured redactions', () => {
    const line = JSON.stringify({ a: { clientSecret: fake.passphrase() }, b: [{ name: 'API_KEY', value: fake.passphrase() }] });
    const once = redactJsonlLine(line, redactor, ctx);
    expect(redactJsonlLine(once, redactor, ctx)).toBe(once);
  });

  it('can be turned off via secretFields.enabled=false', () => {
    const r = createRedactor({ ...DEFAULT_REDACTION_CONFIG, secretFields: { ...DEFAULT_REDACTION_CONFIG.secretFields, enabled: false } });
    const pw = fake.passphrase();
    expect(redactJsonlLine(JSON.stringify({ x: { clientSecret: pw } }), r, ctx)).toContain(pw);
  });
});
