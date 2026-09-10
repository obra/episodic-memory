import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(import.meta.dirname, '..');

describe('package.json allowScripts (npm 12 install-script gating, #162)', () => {
  it('approves the native-binding installs indexing depends on', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));

    // Under npm 12 (and npm 11.16+ with blocking opted in), a dependency's
    // install/postinstall script is skipped unless the ROOT package's
    // allowScripts explicitly permits it. Without this, `npm install`
    // exits 0 while better-sqlite3 and onnxruntime-node silently ship
    // with no native binding, and indexing/search fail forever with
    // nothing surfacing the problem to the user.
    expect(pkg.allowScripts).toBeDefined();
    expect(pkg.allowScripts['better-sqlite3']).toBe(true);
    expect(pkg.allowScripts['onnxruntime-node']).toBe(true);

    // Bare package names, not pinned versions: a pinned key (e.g.
    // "better-sqlite3@12.11.1") stops matching the moment the dependency
    // bumps, silently reintroducing the bug on the next release.
    for (const key of Object.keys(pkg.allowScripts)) {
      expect(key).not.toMatch(/@\d/);
    }
  });
});
