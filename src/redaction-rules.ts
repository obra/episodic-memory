import type { RedactionConfig } from './redaction.js';

/**
 * Bundled default redaction rules.
 *
 * Patterns are ported from gitleaks' rule set (https://github.com/gitleaks/gitleaks,
 * MIT), trimmed to the credentials that realistically show up in Claude Code /
 * Codex transcripts for an Azure-heavy stack, and rewritten for JavaScript
 * regex (lookbehind instead of gitleaks' consuming boundary groups, so
 * adjacent matches aren't swallowed).
 *
 * Order matters: rules run top to bottom, and a later rule never re-matches
 * inside an earlier rule's `[REDACTED:...]` token. Specific shapes go first so
 * the token names the most precise rule; the generic `secret-assignment`
 * keyword rule goes last.
 *
 * `secretGroup` replaces only that capture group, so surrounding context
 * (connection-string server names, SAS URL paths, usernames) stays searchable.
 *
 * `keywords` is a case-insensitive prefilter: a rule only runs on text that
 * contains at least one keyword. It keeps the per-string cost low on large
 * transcripts and bounds the generic rules' work.
 *
 * Users extend or override these with `redaction-rules.json`; see
 * docs/REDACTION.md. `episodic-memory redact --print-default-rules` dumps
 * this object as JSON.
 */
// Names that mark the value next to them as a secret, for the key-context
// rules below. A name must END in one of these (optionally plus digits), so
// tokenType, secretName, passwordPolicy, TokenEndpoint and maxTokens don't
// count. `pwd` is deliberately absent (the PWD env var); `userPWD` is handled
// by xml-secret-attribute.
const SECRET_NAME =
  String.raw`(?:secret|password|passwd|passphrase|api[_-]?key|access[_-]?key|account[_-]?key|private[_-]?key|` +
  String.raw`shared[_-]?(?:access[_-]?)?key|primary[_-]?key|secondary[_-]?key|master[_-]?key|signing[_-]?key|` +
  String.raw`subscription[_-]?key|client[_-]?key|encryption[_-]?key|token|credentials?)\d*`;

// Value is not a template/placeholder: ${X} $(X) $X #{X}# {{x}} <x> %X% __X__,
// an existing token, a type name (Swagger "string"), or a mask (*****).
const NOT_PLACEHOLDER =
  String.raw`(?!\[REDACTED:|\$\{|\$\(|\$[A-Za-z_]\w*["'<\s]|#\{|\{\{|<[^>]*>|%[A-Za-z_]\w*%|__[A-Za-z0-9_]+__|` +
  String.raw`(?:string|null|true|false|none|undefined|\*+)["'<])`;

// A JSON string value (escapes allowed), captured.
const JSON_STRING_VALUE = String.raw`"${NOT_PLACEHOLDER}([^"\\]+(?:\\.[^"\\]*)*)"`;
// Sibling members inside the same object: strings, or anything but braces/quotes.
const SAME_OBJECT = String.raw`(?:[^{}"]|"(?:[^"\\]|\\.)*"){0,400}?`;
const KEY_VAULT_ID =
  String.raw`"id"[ \t]*:[ \t]*"https://[^"\s]+\.vault\.(?:azure\.net|azure\.cn|usgovcloudapi\.net|microsoftazure\.de)/secrets/[^"\s]*"`;

export const DEFAULT_REDACTION_CONFIG: RedactionConfig = {
  rules: [
    {
      id: 'private-key-block',
      description: 'PEM/OpenSSH private key block; a truncated block (no END line) is redacted to the end of the text',
      pattern: String.raw`-----BEGIN[A-Z0-9 _-]{0,40}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END[A-Z0-9 _-]{0,40}PRIVATE KEY(?: BLOCK)?-----|$)`,
      keywords: ['private key'],
    },
    {
      id: 'connection-string-secret',
      description: 'Secret value inside an Azure/ADO.NET connection string; account, server and database names are kept. Keywords are case-insensitive, as in ADO.NET; a path after Pwd= is the shell PWD variable and is kept; the value needs a letter or digit, so Markdown like `Password=` is kept',
      pattern: String.raw`\b(?:(?:AccountKey|SharedAccessKey|SharedAccessSignature|SharedSecret|ClientSecret|Password)=|Pwd=(?![/~]))(?![\[$<{%])(?=[^;"'\s]*[A-Za-z0-9])([^;"'\s]+)`,
      flags: 'i',
      secretGroup: 1,
      keywords: ['accountkey', 'sharedaccess', 'sharedsecret', 'clientsecret', 'password', 'pwd'],
    },
    {
      id: 'azure-sas-token',
      description: 'Signature of an Azure SAS token; the resource URL and other SAS parameters are kept',
      pattern: String.raw`\bsig=([A-Za-z0-9%+/=_-]{16,})`,
      secretGroup: 1,
      keywords: ['sig='],
    },
    {
      id: 'jwt',
      description: 'JSON Web Token (Entra ID / Azure access tokens, id tokens)',
      pattern: String.raw`\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`,
      keywords: ['eyj'],
    },
    {
      id: 'anthropic-api-key',
      pattern: String.raw`\bsk-ant-[a-z]{2,10}\d{2}-[A-Za-z0-9_-]{32,}`,
      keywords: ['sk-ant-'],
    },
    {
      id: 'openai-api-key',
      pattern: String.raw`\bsk-(?:[a-z]+-)?[A-Za-z0-9_-]{16,}T3BlbkFJ[A-Za-z0-9_-]{16,}`,
      keywords: ['t3blbkfj'],
    },
    {
      id: 'github-token',
      description: 'GitHub classic, OAuth, app and fine-grained tokens',
      pattern: String.raw`\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b`,
      keywords: ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'],
    },
    {
      id: 'aws-access-key-id',
      pattern: String.raw`\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b`,
      keywords: ['akia', 'asia', 'abia', 'acca'],
    },
    {
      id: 'aws-secret-access-key',
      pattern: String.raw`aws[_-]?secret[_-]?access[_-]?key["']?[ \t]*[:=][ \t]*["']?([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+])`,
      flags: 'i',
      secretGroup: 1,
      keywords: ['secret'],
    },
    {
      id: 'slack-token',
      pattern: String.raw`\bxox[abposr]-[A-Za-z0-9-]{10,}`,
      keywords: ['xox'],
    },
    {
      id: 'google-api-key',
      pattern: String.raw`\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])`,
      keywords: ['aiza'],
    },
    {
      id: 'npm-token',
      pattern: String.raw`\bnpm_[A-Za-z0-9]{36}\b`,
      keywords: ['npm_'],
    },
    {
      id: 'azure-client-secret',
      description: 'Entra ID (Azure AD) application client secret: 3 chars, a digit, "Q~", 31-34 chars. A trailing "." may follow, so a secret ending a sentence still matches',
      pattern: String.raw`(?<![A-Za-z0-9_~.-])[A-Za-z0-9_~.]{3}\dQ~[A-Za-z0-9_~.-]{31,34}(?![A-Za-z0-9_~-])`,
      keywords: ['q~'],
    },
    {
      id: 'azure-storage-key',
      description: 'Standalone 64-byte base64 key (Azure Storage, Cosmos DB, Function keys). Not preceded by "-" so sha512- integrity hashes survive',
      pattern: String.raw`(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/]{86}==(?![A-Za-z0-9+/=])`,
    },
    {
      id: 'url-credentials',
      description: 'Password in URL userinfo (between "user:" and "@host"); the user and host are kept',
      pattern: String.raw`\b[a-zA-Z][a-zA-Z0-9+.-]*://[^\s:@/"'<>]+:(?![\[$<{%])([^\s@/"'<>]+)@`,
      secretGroup: 1,
      keywords: ['://'],
    },
    {
      id: 'bearer-token',
      pattern: String.raw`\bBearer\s+([A-Za-z0-9\-._~+/]{20,}=*)`,
      flags: 'i',
      secretGroup: 1,
      keywords: ['bearer'],
    },
    {
      id: 'basic-auth',
      pattern: String.raw`\bAuthorization[ \t]*:[ \t]*Basic\s+([A-Za-z0-9+/]{8,}={0,2})`,
      flags: 'i',
      secretGroup: 1,
      keywords: ['basic'],
    },
    {
      id: 'azure-keyvault-secret',
      description: 'The "value" of a Key Vault secret bundle (az keyvault secret show/set, SDK JSON), whatever the secret is named',
      pattern:
        KEY_VAULT_ID + String.raw`(?:[^{}]|\{[^{}]*\}){0,800}?"value"[ \t]*:[ \t]*` + JSON_STRING_VALUE +
        String.raw`|"value"[ \t]*:[ \t]*` + JSON_STRING_VALUE + String.raw`(?=(?:[^{}]|\{[^{}]*\}){0,800}?` + KEY_VAULT_ID + ')',
      secretGroup: [1, 2],
      useAllowlist: false,
      keywords: ['.vault.'],
    },
    {
      id: 'name-value-secret',
      description:
        'The "value" of a {"name"/"key": <secret-looking name>, "value": ...} object, in either order: ' +
        'az webapp/functionapp config appsettings list, Kubernetes env, ARM/Bicep parameters',
      pattern:
        String.raw`"(?:name|key)"[ \t]*:[ \t]*"[^"\\]{0,80}?` + SECRET_NAME + '"' + SAME_OBJECT +
        String.raw`"value"[ \t]*:[ \t]*` + JSON_STRING_VALUE +
        String.raw`|"value"[ \t]*:[ \t]*` + JSON_STRING_VALUE + '(?=' + SAME_OBJECT +
        String.raw`"(?:name|key)"[ \t]*:[ \t]*"[^"\\]{0,80}?` + SECRET_NAME + '")',
      flags: 'i',
      secretGroup: [1, 2],
      useAllowlist: false,
      keywords: ['"value"'],
    },
    {
      id: 'xml-appsettings-secret',
      description: 'web.config / app.config <add key="<secret-looking name>" value="..."/>, either attribute order',
      pattern:
        String.raw`<add\b[^>]*?\bkey[ \t]*=[ \t]*"[^"]{0,80}?` + SECRET_NAME + String.raw`"[^>]*?\bvalue[ \t]*=[ \t]*"` +
        NOT_PLACEHOLDER + String.raw`([^"]+)"` +
        String.raw`|<add\b[^>]*?\bvalue[ \t]*=[ \t]*"` + NOT_PLACEHOLDER + String.raw`([^"]+)"(?=[^>]*?\bkey[ \t]*=[ \t]*"[^"]{0,80}?` +
        SECRET_NAME + '")',
      flags: 'i',
      secretGroup: [1, 2],
      useAllowlist: false,
      keywords: ['<add'],
    },
    {
      id: 'xml-secret-element',
      description: 'Text of an XML element with a secret-looking name (ClientSecret, Password, ApiKey, ...)',
      pattern: String.raw`<((?=[A-Za-z_])[\w.:-]{0,60}?` + SECRET_NAME + String.raw`)(?:\s[^>]*)?>` + NOT_PLACEHOLDER + String.raw`([^<]{1,4096})</\1>`,
      flags: 'i',
      secretGroup: 2,
      useAllowlist: false,
      keywords: ['</'],
    },
    {
      id: 'xml-secret-attribute',
      description: 'XML/HTML attribute with a secret-looking name, e.g. userPWD="..." in Azure publish profiles',
      pattern:
        String.raw`(?<=[\s<])(?=[A-Za-z_])[\w.:-]{0,60}?(?:` + SECRET_NAME + String.raw`|pwd\d*)="(?![/~])` +
        NOT_PLACEHOLDER + String.raw`([^"]{4,})"`,
      flags: 'i',
      secretGroup: 1,
      useAllowlist: false,
      keywords: ['="'],
    },
    {
      id: 'quoted-secret-assignment',
      description:
        'Quoted value assigned to a secret-looking name: "ClientSecret": "...", ClientSecret = "...", ' +
        "password: '...' (JSON/appsettings, C#, JS/TS, Python, YAML). No digit required; no whitespace in the value",
      pattern:
        String.raw`(?<![\w.$@-])["']?(?=[A-Za-z_$@])[\w.:$@-]{0,60}?` + SECRET_NAME +
        String.raw`["']?[ \t]*(?::=|[:=])[ \t]*(["'])` + NOT_PLACEHOLDER + String.raw`([^"'\s\\]{4,512})\1`,
      flags: 'i',
      secretGroup: 2,
      useAllowlist: false,
      keywords: ['secret', 'passw', 'passphrase', 'key', 'token', 'credential'],
    },
    {
      id: 'secret-assignment',
      description:
        'Value assigned to a secret-looking key (password: x, CLIENT_SECRET=x, "apiKey": "x"). ' +
        'Covers decrypted SOPS/YAML/dotenv/JSON. Requires 8+ chars including a digit; ' +
        'skips placeholders (${X}, <x>, %X%, {{x}}) and code (calls, dotted member access)',
      pattern:
        String.raw`\b[A-Za-z0-9_.-]{0,40}?(?:secret|password|passwd|passphrase|api[_-]?key|access[_-]?key|private[_-]?key|token)` +
        String.raw`["']?[ \t]*[:=][ \t]*["']?(?![\[$<{%])(?=[^\s"',;&\\]*\d)` +
        // Not a dotted identifier path (env.AUTH0_SECRET, this.config.token2): code, not a value.
        String.raw`(?![A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:$|[\s"',;&\\)}\]]))` +
        String.raw`([^\s"',;&\\()<>{}\[\]]{8,})(?=$|[\s"',;&\\)}\]])`,
      flags: 'i',
      secretGroup: 1,
      keywords: ['secret', 'passw', 'passphrase', 'key', 'token'],
    },
  ],
  allowlist: [
    {
      id: 'git-sha',
      description: 'Full or short git commit SHA',
      pattern: String.raw`\b[0-9a-f]{7,40}\b`,
    },
    {
      id: 'guid',
      description: 'GUID/UUID (Entra tenant, client and object IDs, subscription IDs)',
      pattern: String.raw`\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b`,
    },
  ],
  entropy: {
    enabled: false,
    minLength: 32,
    threshold: 4.5,
    requireKeyword: true,
    keywords: ['secret', 'key', 'token', 'password', 'passwd', 'credential', 'signature'],
    window: 40,
  },
  secretFields: {
    enabled: true,
    // Normalized key (lowercase letters/digits only, trailing digits dropped)
    // must end with one of these. Harness keys (signature, apiKeySource,
    // input_tokens, token_count) don't.
    keyPattern:
      'secret|password|passwd|userpwd|passphrase|apikey|accesskey|accountkey|privatekey|sharedkey|primarykey|' +
      'secondarykey|masterkey|signingkey|subscriptionkey|clientkey|encryptionkey|token|credentials?',
  },
};
