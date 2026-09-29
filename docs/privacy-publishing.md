# Privacy-safe publishing boundary

## Public artifact

GitHub Pages must deploy only the generated `.public-site/` directory. The builder copies an explicit static-file allowlist and creates a sanitized `data/dashboard.json`.

The public dashboard keeps race context, model predictions, aggregate performance, the Research Lab summary, and the inputs needed for browser-side EV and staking tools. The public UI may compute user-facing recommendations, but it excludes:

- server-persisted personalized recommendations or bankroll records;
- tickets, personal paper-pick records, and recommendation audits;
- row-level betting ledgers and complete history payloads;
- SQLite names/paths, raw market snapshots, model artifacts, and local filesystem paths.

The browser recognizes only the exact `PUBLIC_FUNCTIONAL_SANITIZED` contract. This enables the prediction, EV, staking, pool-guide, adaptive-route, and post-race tools while keeping user bankroll preferences, paper picks, and forecast locks in browser-local storage. Missing, stale, unpromoted, or otherwise ineligible evidence still produces `WATCH`, `PAPER`, or `NO_BET`.

Run the same checks locally:

```bash
npm run hkjc:stage-public-release
npm run hkjc:privacy-scan
```

The scan fails closed for files outside the allowlist, symlinks, local absolute paths, common secret patterns, forbidden dashboard fields, non-empty row-level ledgers, or a publication contract that is not both functional and sanitized.

The builder also writes `data/publication-manifest.json` with the dashboard SHA-256, settled-race count/cutoff, and upcoming meeting/race/runner counts. Deployment validates the candidate against the previous public manifest, then checks the deployed URL and dashboard hash after Pages reports success. This prevents a successful workflow from silently publishing older or incomplete data.

## Private/local data

The following outputs are ignored and retained locally:

- `hkjc-horse-model/data/*.sqlite*`
- `hkjc-horse-model/data/private/`
- `hkjc-horse-model/data/processed/`
- `data/dashboard-history.json`
- `data/latest-recommendation-audit.json`

`dashboard-db` writes the public dashboard to its requested output and writes complete history only to `--privateHistoryOutput` (default: `hkjc-horse-model/data/private/dashboard-history.json`). `auto-run` writes recommendation audits to the private directory unless an explicit local path is supplied.

## GitHub Pages operating mode

The workflow no longer commits refreshed raw files, processed reports, or audits. It resumes from the newest tracked official result in an ephemeral runner, builds the allowlisted artifact, applies the release transition checks, scans it, and passes only `.public-site/` to GitHub Pages. Scheduled runs cover the daily baseline plus bounded pre-race and post-race refreshes on common local race days.

The repository and Pages site intentionally remain public so the product works on mobile using the free GitHub Pages tier. Authentication, private source hosting, cloud-synced personal records, and a separate public/private repository topology are deferred until the product is mature.

Existing raw files and prior commits remain accessible in historical public Git commits. The deployment allowlist prevents them from entering the current Pages artifact, but removing historical exposure requires a coordinated history rewrite and remains deferred.
