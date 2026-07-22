# Unattended Race Operations Design

## Goal

After this change, the user only needs to keep the Mac logged in, online, and allow the existing background items. The system must discover public HKJC local meetings and race cards before the live T-30/T-10/T-3 collector needs them, preserve all private evidence locally, and keep the public Research Lab aligned with the real operating state.

## Approved operating model

Two bounded jobs have separate responsibilities:

1. The daily Codex inspection runs at 10:00 HKT. Its first operational step refreshes the public HKJC fixture/race-card window and syncs valid upcoming cards into the existing private SQLite database. It then checks collector health, coverage deficits, settlement state, and continues the first safe research task that is not blocked on future data.
2. The installed macOS LaunchAgent runs the finite race-day cycle every ten minutes. It reads only `upcoming` races from SQLite, captures due T-30/T-10/T-3 WIN/PLA/QIN/QPL evidence, and exits. It never logs in, places a bet, or enables cash execution.

The implementation reuses the existing `refresh`, `sync-db`, and `race-day-cycle` commands. No second race-card crawler or account integration is introduced.

## Data flow and privacy boundary

Public HKJC fixture and race-card pages are fetched into the fixed worktree's ignored local data directories. The daily job may write only those ignored files, the explicitly approved private SQLite database, and private logs/reports. Raw races, snapshots, model artifacts, recommendation locks, tickets, and personal audit rows remain local and must never enter Git.

GitHub Pages publishes aggregate operational state only:

- the race-day cycle is implemented and locally enabled;
- the next required evidence is a fresh forward cohort;
- cash remains `NO_BET`;
- no local path, race-level lock, private database name, or credential is exposed.

## Failure handling

- A verified no-meeting or unpublished-card response is recorded as an operationally idle state, not as a collector failure.
- A network, parser, identity, or database error must not fabricate an upcoming meeting or erase settled authority.
- Missing future data must not end the two-hour daily inspection. The job records the exact deficit and advances to the next safe engineering or research slice.
- The live collector remains finite and fail-closed after post time. It may write only paper/shadow evidence; executable cash stake remains zero.

## Daily priority order

1. Refresh and sync future fixture/race-card inputs.
2. Verify LaunchAgent health, error logs, due windows, backup freshness, and prospective coverage.
3. Settle official results/dividends and update probability, ROI, CLV, drawdown, and promotion evidence when fresh locks exist.
4. If the forward cohort is still below its declared gate, continue timestamped SpeedPRO backfill, same-cohort ablations, external benchmark reproduction, or parser resilience work.
5. Build and privacy-scan public artifacts after any public-status change.

## Acceptance checks

- The daily automation remains active at 10:00 HKT, local-only, high reasoning, and approximately two hours.
- Its prompt explicitly performs the preflight before P5-P8/P9 research and allows only the approved private SQLite write.
- Research Lab no longer says the scheduler is disabled and exposes a distinct upcoming-racecard-preflight action.
- Node tests, public build, privacy scan, and browser checks pass.
- Git history contains no raw race data, SQLite files, local paths in public artifacts, credentials, or nonzero cash authorization.
