# Privacy-safe publishing boundary

## Public artifact

GitHub Pages must deploy only the generated `.public-site/` directory. The builder copies an explicit static-file allowlist and creates a sanitized `data/dashboard.json`.

The public dashboard keeps race context, model predictions, aggregate performance, and the Research Lab summary. It excludes:

- executable or personalized recommendations;
- suggested stakes, bankroll rules, tickets, and recommendation audits;
- row-level betting ledgers and complete history payloads;
- SQLite names/paths, raw market snapshots, model artifacts, and local filesystem paths.

Run the same checks locally:

```bash
npm run hkjc:build-public-site
npm run hkjc:privacy-scan
```

The scan fails closed for files outside the allowlist, symlinks, local absolute paths, common secret patterns, forbidden dashboard fields, non-empty row-level ledgers, or a missing `PUBLIC_SANITIZED` marker.

## Private/local data

The following outputs are ignored and retained locally:

- `hkjc-horse-model/data/*.sqlite*`
- `hkjc-horse-model/data/private/`
- `hkjc-horse-model/data/processed/`
- `data/dashboard-history.json`
- `data/latest-recommendation-audit.json`

`dashboard-db` writes the public dashboard to its requested output and writes complete history only to `--privateHistoryOutput` (default: `hkjc-horse-model/data/private/dashboard-history.json`). `auto-run` writes recommendation audits to the private directory unless an explicit local path is supplied.

## GitHub activation boundary

The workflow no longer commits refreshed raw files, processed reports, or audits. It refreshes in an ephemeral runner, builds the allowlisted artifact, scans it, and passes only `.public-site/` to GitHub Pages.

Two external settings remain deliberate operator decisions:

1. Switch Pages from legacy `main /` publishing to GitHub Actions workflow publishing after the workflow is merged.
2. Decide whether the source repository becomes private. A private-source/public-Pages setup may require an eligible GitHub plan; otherwise use a separate public Pages repository containing only the generated artifact.

Existing raw files and prior commits remain accessible while the source repository is public. Removing them from Git history requires a coordinated history rewrite and is not performed automatically.
