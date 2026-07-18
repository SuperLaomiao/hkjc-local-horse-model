import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('public dashboard app integration', () => {
  it('renders the publication badge and isolates private research report loading', async () => {
    const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

    assert.match(appSource, /publicationBadge\(executionPolicy\)/);
    assert.match(appSource, /allowPrivateResearchReports/);
    assert.doesNotMatch(
      appSource,
      /dashboardExecutionPolicy\(uiState\.snapshot\)\.allowExecutableRecommendations/,
    );
    assert.match(styles, /\.publication-mode-badge\.is-functional/);
  });

  it('shows truthful Research Lab action progress, evidence, and remaining work', async () => {
    const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

    assert.match(appSource, /implementedActionCount/);
    assert.match(appSource, /partialActionCount/);
    assert.match(appSource, /queuedActionCount/);
    assert.match(appSource, /action\.evidence/);
    assert.match(appSource, /action\.remaining/);
    assert.match(appSource, /已完成/);
    assert.match(appSource, /部分完成/);
    assert.match(appSource, /待执行/);
    assert.match(appSource, /const program = buildResearchUpgradeProgram\(\);/);
    assert.doesNotMatch(appSource, /const program = snapshot\.research \?\?/);
  });
});
