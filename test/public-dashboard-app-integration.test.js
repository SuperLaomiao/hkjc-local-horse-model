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

  it('shows uncertainty tripwire reasons and labels the legacy budget as paper-only', async () => {
    const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
    const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

    assert.match(appSource, /renderTripwireStatus\(resolvedPlan\.tripwire\)/);
    assert.match(appSource, /renderTripwireStatus\(portfolio\.tripwire\)/);
    assert.match(appSource, /纸上预算草案/);
    assert.match(appSource, /tripwire\.summaryZh/);
    assert.match(styles, /\.tripwire-status/);
  });

  it('renders the four-destination cockpit and keeps every legacy tool reachable', async () => {
    const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
    const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
    const publisher = await readFile(new URL('../hkjc-horse-model/src/public-site-publish.js', import.meta.url), 'utf8');

    assert.match(appSource, /dashboard-cockpit\.js/);
    assert.match(appSource, /selectedDestination/);
    assert.match(appSource, /window\.location\.hash/);
    assert.match(appSource, /renderTodayDestination/);
    assert.match(appSource, /renderReviewDestination/);
    assert.match(appSource, /renderResearchDestination/);
    assert.match(appSource, /renderMoreDestination/);
    assert.match(appSource, /renderNoMeetingCockpit/);
    assert.match(serviceWorker, /dashboard-cockpit\.js/);
    assert.match(publisher, /dashboard-cockpit\.js/);
  });
});
