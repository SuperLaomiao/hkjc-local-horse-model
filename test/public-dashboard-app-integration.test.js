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
});
