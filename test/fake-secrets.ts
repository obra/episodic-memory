/**
 * Fake-secret builders for redaction tests.
 *
 * Nothing in this file is a real credential, and no string literal here matches
 * a redaction rule on its own: every secret is assembled at runtime from a
 * seeded PRNG plus split prefixes. That keeps GitHub push protection and other
 * scanners quiet while still producing values in the exact real-world shape.
 */

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const ALNUM = UPPER + LOWER + DIGITS;
const B64 = ALNUM + '+/';
const B64URL = ALNUM + '-_';
const BASE32 = UPPER + '234567';

/** Deterministic PRNG (mulberry32) so failures reproduce. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class FakeSecrets {
  private rng: () => number;

  constructor(seed = 1337) {
    this.rng = makeRng(seed);
  }

  chars(charset: string, n: number): string {
    let out = '';
    for (let i = 0; i < n; i++) out += charset[Math.floor(this.rng() * charset.length)];
    return out;
  }

  /** Always contains at least one digit and one letter. */
  private mixed(charset: string, n: number): string {
    return this.chars(charset, n - 2) + this.chars(DIGITS, 1) + this.chars(LOWER, 1);
  }

  azureClientSecret(): string {
    // <3 chars><digit>Q~<34 chars> — Entra ID client secret shape.
    return this.chars(ALNUM, 3) + this.chars(DIGITS, 1) + 'Q' + '~' + this.chars(ALNUM + '_~.-', 33) + 'x';
  }

  azureStorageKey(): string {
    // 64 random bytes, base64: 86 chars + '=='.
    return this.chars(ALNUM, 1) + this.chars(B64, 84) + this.chars(ALNUM, 1) + '=' + '=';
  }

  sasSignature(): string {
    return this.chars(ALNUM, 40) + '%2B' + this.chars(ALNUM, 3) + '%3D';
  }

  privateKeyBlock(kind = 'RSA'): string {
    const body: string[] = [];
    for (let i = 0; i < 6; i++) body.push(this.chars(B64, 64));
    const dashes = '-'.repeat(5);
    return `${dashes}BEGIN ${kind} PRIVATE` + ` KEY${dashes}\n${body.join('\n')}\n${dashes}END ${kind} PRIVATE` + ` KEY${dashes}`;
  }

  jwt(): string {
    const head = 'ey' + 'J' + this.chars(B64URL, 30);
    const payload = 'ey' + 'J' + this.chars(B64URL, 60);
    return `${head}.${payload}.${this.chars(B64URL, 43)}`;
  }

  anthropicKey(): string {
    return 'sk-' + 'ant-' + 'api03-' + this.chars(B64URL, 93) + 'AA';
  }

  openAiKey(): string {
    return 'sk-' + 'proj-' + this.chars(ALNUM, 20) + 'T3Blbk' + 'FJ' + this.chars(ALNUM, 20);
  }

  githubToken(): string {
    return 'gh' + 'p_' + this.chars(ALNUM, 36);
  }

  githubFineGrainedPat(): string {
    return 'github' + '_pat_' + this.chars(ALNUM, 22) + '_' + this.chars(ALNUM, 59);
  }

  awsAccessKeyId(): string {
    return 'AK' + 'IA' + this.chars(BASE32, 16);
  }

  awsSecretAccessKey(): string {
    return this.mixed(ALNUM + '/+', 40);
  }

  slackToken(): string {
    return 'xo' + 'xb-' + this.chars(DIGITS, 12) + '-' + this.chars(DIGITS, 12) + '-' + this.chars(ALNUM, 24);
  }

  googleApiKey(): string {
    return 'AI' + 'za' + this.chars(ALNUM + '_-', 35);
  }

  npmToken(): string {
    return 'np' + 'm_' + this.chars(ALNUM, 36);
  }

  /** Starts with a letter so it never looks like a `$VAR`/`%VAR%` placeholder. */
  password(): string {
    return this.chars(LOWER, 1) + this.mixed(ALNUM + '!#%^*', 15);
  }

  /** Letters only: a real password with no digit, which digit-gated rules miss. */
  passphrase(): string {
    return this.chars(UPPER, 1) + this.chars(LOWER, 7) + this.chars(UPPER, 1) + this.chars(LOWER, 9);
  }

    bearerOpaque(): string {
    return this.mixed(ALNUM, 40);
  }

  basicAuth(): string {
    return this.chars(ALNUM, 30) + '=' + '=';
  }

  /** High-entropy blob with no recognizable prefix. */
  opaqueHighEntropy(n = 48): string {
    return this.mixed(ALNUM + '+/', n);
  }

  gitSha(): string {
    return this.chars('0123456789abcdef', 40);
  }

  guid(): string {
    const h = (n: number) => this.chars('0123456789abcdef', n);
    return `${h(8)}-${h(4)}-${h(4)}-${h(4)}-${h(12)}`;
  }

  base64Blob(n: number): string {
    return this.chars(B64, n);
  }
}

/** Every `[REDACTED:...]` token in a string. */
export function redactionTokens(text: string): string[] {
  return text.match(/\[REDACTED:[a-z0-9-]+\]/g) ?? [];
}
