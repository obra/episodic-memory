import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(import.meta.dirname, '..');

describe('package.json allowScripts (npm 12 install-script gating, #162)', () => {
  it('allows only the native install scripts indexing still needs', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));

    // Under npm 12 (and npm 11.16+ with blocking opted in), a dependency's
    // install/postinstall script is skipped unless the ROOT package's
    // allowScripts explicitly permits it. onnxruntime-node still needs that
    // permission; better-sqlite3 13.x bundles N-API binaries and must not fall
    // back to a runtime-specific source build.
    expect(pkg.allowScripts).toBeDefined();
    expect(pkg.allowScripts['better-sqlite3']).toBe(false);
    expect(pkg.allowScripts['onnxruntime-node']).toBe(true);

    // Bare package names, not pinned versions: a pinned key (e.g.
    // "better-sqlite3@12.11.1") stops matching the moment the dependency
    // bumps, silently reintroducing the bug on the next release.
    for (const key of Object.keys(pkg.allowScripts)) {
      expect(key).not.toMatch(/@\d/);
    }
  });

  it('uses the N-API better-sqlite3 line that works across Node ABIs', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
    const postinstall = readFileSync(join(REPO_ROOT, 'scripts', 'postinstall.js'), 'utf-8');

    expect(pkg.dependencies['better-sqlite3']).toBe('^13.0.3');
    expect(postinstall).not.toContain("npm(['rebuild', 'better-sqlite3']");
    expect(postinstall).not.toContain("npm(['run', 'build-release']");
    expect(postinstall).not.toContain('failure.stderr');
  });

  it('explicitly denies sharp\'s postinstall (#102)', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));

    // sharp's postinstall exits 1 on any host with libvips already
    // installed globally and corrupts node_modules on the way out (#102).
    // It must be present here (not merely absent from allowScripts) and
    // set to `false`, not just omitted: an omitted key blocks the script
    // today only incidentally, and `npm install-scripts approve --all`
    // would sweep it into the allowlist on the next run. An explicit
    // `false` is documented to survive `--all`, turning "we happened not
    // to allow it" into an enforced decision.
    expect(pkg.allowScripts).toHaveProperty('sharp');
    expect(pkg.allowScripts['sharp']).toBe(false);
  });
});
