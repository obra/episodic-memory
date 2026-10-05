# Secret redaction

episodic-memory replaces secrets in your conversations with typed tokens
before it archives, indexes, embeds, or summarizes them:

```text
AccountKey=<88-char key>          →  AccountKey=[REDACTED:connection-string-secret]
"ClientSecret": "<any value>"     →  "ClientSecret": "[REDACTED:quoted-secret-assignment]"
<add key="SmtpPassword" value=…/> →  <add key="SmtpPassword" value="[REDACTED:xml-appsettings-secret]"/>
Authorization: Bearer <JWT>       →  Authorization: Bearer [REDACTED:jwt]
```

Only the value is replaced, so the rest of the conversation stays searchable,
and the token says what kind of value was there.
`episodic-memory search --text "[REDACTED:azure-storage-key]"` finds every
conversation where a storage key was pasted.

Redaction is on by default and fails closed: if the rules can't load, sync
doesn't run.

## Where it happens

Every harness's transcripts (Claude Code, Codex, Cursor, opencode, OMP) are
copied into the conversation archive before anything else reads them. That
copy is the one point they all pass through, so it is where redaction happens
([`copyIfNewer`](../src/sync.ts) → [`copyFileRedacted`](../src/redaction.ts)).
Everything downstream reads the archive:

| Where | Redacted? |
|---|---|
| Conversation archive (`~/.config/superpowers/conversation-archive`) | Yes, line by line as it's copied |
| SQLite index: message text and tool inputs/outputs | Yes, parsed from the archive ([indexer.ts](../src/indexer.ts) included) |
| Embeddings | Yes, built from redacted text |
| Summaries (sent to a model) | Yes. Summarizer resume and Codex fork are turned off, because both read the original transcript ([summarizer.ts](../src/summarizer.ts)) |
| opencode and legacy Cursor staging exports | Yes, when written ([opencode-sync.ts](../src/opencode-sync.ts), [cursor-legacy.ts](../src/cursor-legacy.ts)) |
| `show`, MCP `read` | Yes, they read the archive |
| Logs | Rule IDs and counts only |
| The harness's own files (`~/.claude/projects`, `~/.codex/sessions`, …) | **No.** They belong to the harness; use its retention settings |

With summarizer resume off, Codex-only setups summarize through the Claude
Agent SDK. Without Claude configured, set `EPISODIC_MEMORY_SKIP_SUMMARIES=1`.
Summaries are display-only, so search is unaffected.

## How a secret is recognized

The engine is [src/redaction.ts](../src/redaction.ts) and the default rules are
[src/redaction-rules.ts](../src/redaction-rules.ts). Each archive line is parsed
as JSON and passes through three layers:

1. **Shape.** Values whose format gives them away: private keys, JWTs,
   provider-prefixed keys, Entra client secrets (`…Q~…`), 88-character Azure
   storage keys, SAS `sig=` values.
2. **Key context.** Values with no recognizable format, caught by the name
   they're assigned to: `Password=` in a connection string, `"ClientSecret": "…"`,
   `<add key="SmtpPassword" value="…"/>`, `{"name": "DB_PASSWORD", "value": "…"}`,
   `password: …`.
3. **Field name.** In parsed JSON, any string whose field name is
   secret-looking is replaced whole, including tool inputs and MCP results.

A **secret-looking name** *ends* in `secret`, `password`, `passwd`,
`passphrase`, `apikey`, `accesskey`, `accountkey`, `privatekey`, `token`,
`credential(s)` or a similar key word, in any case and with any separators
(`AzureAd:ClientSecret`, `DB_PASSWORD2`). `TokenEndpoint` and `passwordPolicy`
don't count. Placeholders (`${X}`, `$(X)`, `#{X}#`, `{{x}}`, `<x>`, `%X%`,
`"string"`, `"*****"`) are left alone.

Git SHAs and GUIDs are allowlisted for the shape rules, so commit hashes and
tenant, client and object IDs stay searchable. Key-context rules ignore the
allowlist: a GUID in a `password` slot is a secret. An entropy fallback exists
but is off by default.

| Rules | Catch |
|---|---|
| `private-key-block`, `jwt`, `anthropic-api-key`, `openai-api-key`, `github-token`, `aws-access-key-id`, `aws-secret-access-key`, `slack-token`, `google-api-key`, `npm-token`, `azure-client-secret`, `azure-storage-key`, `azure-sas-token` | Shape |
| `connection-string-secret` | `AccountKey=`, `SharedAccessKey=`, `Password=`, `Pwd=` and similar in connection strings, any case |
| `url-credentials`, `bearer-token`, `basic-auth` | `scheme://user:password@host`, `Authorization` headers |
| `azure-keyvault-secret`, `name-value-secret` | Key Vault bundles; `{name, value}` pairs (`az … appsettings list`, Kubernetes `env`, ARM parameters) |
| `xml-appsettings-secret`, `xml-secret-element`, `xml-secret-attribute` | `web.config`, `<Password>…</Password>`, publish-profile `userPWD="…"` |
| `quoted-secret-assignment` | `"ClientSecret": "…"`, `ClientSecret = "…"`, `apiKey: '…'`; no spaces in the value |
| `secret-assignment` | `password: …`, `CLIENT_SECRET=…` (YAML, dotenv, decrypted SOPS); 8+ characters with a digit, code like `env.X` skipped |
| `secret-field` | Layer 3: a secret-named JSON field, replaced whole |

`episodic-memory redact --print-default-rules` prints the full definitions.

## Guarantees

- **Fails closed.** In strict mode (the default), sync, index, `index repair`
  and import stop if the rules can't load.
- **Idempotent.** Tokens never match again. When a match runs into an existing
  token, only the text outside it is redacted, so re-running after adding a
  rule is safe.
- **Structure-preserving.** One output line per input line, valid JSON stays
  valid, and lines with no secrets stay byte-for-byte identical. Index line
  ranges and MCP `read` ranges stay correct. Archive copies keep the source
  file's permissions.
- **Values are never printed.** Logs and reports name rules and counts; the
  review report adds the value's shape, never the value.

## Cleaning up existing data

New syncs redact what they copy. To redact what was archived and indexed
before, or after you add a rule:

```bash
episodic-memory redact --rewrite --dry-run            # what would change; writes nothing
episodic-memory redact --rewrite --dry-run --report   # each hit, to check for false positives
episodic-memory redact --rewrite                      # apply
```

`--rewrite` ([src/redact-rewrite.ts](../src/redact-rewrite.ts)) redacts the
archive, the staging exports and the index in place, re-embeds only the rows
that changed, and deletes summaries built from unredacted text so the next
sync regenerates them. It takes the sync lock. A dry run opens the index
read-only.

`--report` prints one hit per value:

```text
  -work-contoso/4f1c….jsonl:212  quoted-secret-assignment  len=40 aA9- H=4.9
      …"AzureAd": { "ClientId": "…", "ClientSecret": "[REDACTED:quoted-secret-assignment]", "TenantId…
```

The shape is the length, the character classes (`a` lower, `A` upper, `9`
digits, `-` symbols, `_` spaces) and the entropy in bits per character. A
random key is long with entropy around 4.5 or more; a word or placeholder is
short or low.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `EPISODIC_MEMORY_REDACTION` | `on` | `off` turns redaction off: byte-for-byte archive copies, summarizer resume allowed |
| `EPISODIC_MEMORY_REDACTION_RULES` | `<config dir>/redaction-rules.json` if present | Custom rules file; a missing file you named is an error |
| `EPISODIC_MEMORY_REDACTION_STRICT` | `1` | `0` continues **unredacted**, with a warning, when the rules fail to load |

Custom rules extend the defaults:

```jsonc
{
  "rules": [                                 // a rule with a default's id replaces it
    { "id": "contoso-api-key", "pattern": "\\bctso_[A-Za-z0-9]{32}\\b", "keywords": ["ctso_"] }
  ],
  "disableRules": ["basic-auth"],
  "allowlist": [{ "id": "build-ids", "pattern": "build-[0-9]{8}" }],
  "entropy": { "enabled": true },
  "secretFields": { "keyPattern": "secret|password|token|credentials?|connectionstring" },
  "includeDefaults": true
}
```

A rule can also set `flags` (`imsu`), `secretGroup` (redact only that capture
group) and `useAllowlist: false`. Every rule is validated on load; an invalid
one is a load failure, which strict mode treats as fatal. Try rules with
`echo 'password: hunter2hunter2' | episodic-memory redact --stdin`.

## Limits

This is pattern and context matching, not named-entity recognition: a value
is caught by its format, by the name it's assigned to, or by the field it's
in. That covers how secrets reach transcripts in practice (pasted config, CLI
output, connection strings, tool results), and it is deterministic, cheap
enough for every line of every sync, and each token names the rule that fired.
What it misses:

- A secret in prose with no name or shape: "the password is hunter2".
- An unquoted letters-only value (`password: hunter`): `secret-assignment`
  needs a digit so ordinary English doesn't trigger it.
- Code-like values (`config.password`, `getPassword()`), skipped on purpose.
- Quoted values with spaces, so UI strings like `"Invalid password"` survive.
- Settings with a shapeless value and a name that isn't secret-looking
  (`Stripe`, `ConnectionStrings__Default`). Add the name to
  `secretFields.keyPattern` or write a rule.

The entropy fallback narrows some of these gaps, at the cost of false
positives.
