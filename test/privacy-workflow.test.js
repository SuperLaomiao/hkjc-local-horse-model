import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');

describe('public Pages privacy workflow', () => {
  it('deploys only the scanned allowlist artifact and never commits private refresh data', async () => {
    const workflow = await readFile(
      path.join(projectRoot, '.github', 'workflows', 'refresh-hkjc-data.yml'),
      'utf8',
    );

    assert.match(workflow, /hkjc:build-public-site/);
    assert.match(workflow, /hkjc:privacy-scan/);
    assert.match(workflow, /actions\/upload-pages-artifact@v3/);
    assert.match(workflow, /actions\/deploy-pages@v4/);
    assert.doesNotMatch(workflow, /contents:\s*write/);
    assert.doesNotMatch(workflow, /git\s+add/);
    assert.doesNotMatch(workflow, /latest-recommendation-audit\.json/);
    assert.doesNotMatch(workflow, /hkjc-horse-model\/data\/(?:raw|upcoming|processed)/);
  });

  it('exposes build and scan package scripts and ignores private outputs', async () => {
    const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
    const gitignore = await readFile(path.join(projectRoot, '.gitignore'), 'utf8');

    assert.match(packageJson.scripts['hkjc:build-public-site'], /public-site-cli\.js build/);
    assert.match(packageJson.scripts['hkjc:privacy-scan'], /public-site-cli\.js scan/);
    assert.match(gitignore, /^\.public-site\/$/m);
    assert.match(gitignore, /^hkjc-horse-model\/data\/private\/$/m);
    assert.match(gitignore, /^data\/dashboard-history\.json$/m);
    assert.match(gitignore, /^data\/latest-recommendation-audit\.json$/m);
  });
});
