import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getApiEnv, wouldBillMeteredApi } from '../src/summarizer.js';

// AWS/Bedrock vars getApiEnv() must preserve unchanged through its `...process.env`
// spread (#44). None of these are given explicit handling in getApiEnv() — the
// spread is the whole mechanism, so this test is a regression pin, not new plumbing.
const BEDROCK_ENV_VARS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AWS_BEARER_TOKEN_BEDROCK',
] as const;

describe('AWS Bedrock passthrough (#44)', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('preserves Bedrock/AWS env vars unchanged through getApiEnv()', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    process.env.AWS_REGION = 'us-west-2';
    process.env.AWS_DEFAULT_REGION = 'us-west-2';
    process.env.AWS_ACCESS_KEY_ID = 'AKIAEXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-example';
    process.env.AWS_SESSION_TOKEN = 'session-token-example';
    process.env.AWS_PROFILE = 'bedrock-profile';
    process.env.AWS_BEARER_TOKEN_BEDROCK = 'bedrock-api-key-example';

    const env = getApiEnv()!;

    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1');
    expect(env.AWS_REGION).toBe('us-west-2');
    expect(env.AWS_DEFAULT_REGION).toBe('us-west-2');
    expect(env.AWS_ACCESS_KEY_ID).toBe('AKIAEXAMPLE');
    expect(env.AWS_SECRET_ACCESS_KEY).toBe('secret-example');
    expect(env.AWS_SESSION_TOKEN).toBe('session-token-example');
    expect(env.AWS_PROFILE).toBe('bedrock-profile');
    expect(env.AWS_BEARER_TOKEN_BEDROCK).toBe('bedrock-api-key-example');

    // The #87 reentrancy guard must survive alongside the Bedrock passthrough.
    expect(env.EPISODIC_MEMORY_SUMMARIZER_GUARD).toBe('1');
  });

  it('does not trigger the metered-API warning for the documented Bedrock setup (#104)', () => {
    // Documented Bedrock auth: AWS creds + CLAUDE_CODE_USE_BEDROCK, no ANTHROPIC_API_KEY.
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.EPISODIC_MEMORY_API_BASE_URL;
    delete process.env.EPISODIC_MEMORY_API_TOKEN;

    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    process.env.AWS_REGION = 'us-west-2';
    process.env.AWS_ACCESS_KEY_ID = 'AKIAEXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-example';

    expect(wouldBillMeteredApi()).toBe(false);
  });
});
