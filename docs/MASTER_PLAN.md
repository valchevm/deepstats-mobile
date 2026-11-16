# DeepStats — Master System Plan
Last reviewed: 2026-11-16
Repository: https://github.com/valchevm/deepstats-mobile
Status convention: [x] Code found in repository; [ ] Not yet verified or incomplete. **Code present does not mean production validated.**

## Purpose and data ownership
Build a reliable mobile PWA showing current football picks, strategy selections, Best of the Day, recorded builders, odds, historical archive and accurate Win Rate / Yield / Profit & Loss. Use **Oracle Autonomous Database** for historical truth, **Google Sheets** for today's operational records and configurations, and **Vercel API** as the controlled merge layer. Timezone: Europe/Sofia. Do not delete source Sheets until reconciliation, export and restore tests complete.

### Existing landscape — inspected from default branch 2026-11-15
- [x] `public/app.js` contains mobile frontend, source switch between Oracle and Sheets for statistics, and history UI.
- [x] `api/data.js` serves current Sheet-backed dashboard, matches, strategies, builders, and statistics; historical Sheets archive still used.
- [x] `api/history.js` reads Oracle history (matches, selections, best, strategies, builders, builder legs, odds).
- [x] `api/oracle-stats.js` calculates historical Oracle performance, strategy membership and builder results.
- [x] `api/oracle-archive.js` exposes admin-protected Oracle summary and paged reads.
- [x] `api/oracle-import-selections.js`, `api/oracle-import-strategies.js`, `api/oracle-import-builders.js`, `api/oracle-import-best.js`, `api/oracle-import-odds-legacy.js` implement Sheets-to-Oracle imports.
- [x] `scripts/daily-oracle-archive.mjs` runs imports and count/stat audits.
- [x] `.github/workflows/daily-oracle-archive.yml` schedules UTC 09:00 and 10:00 with a Sofia-hour guard, targeting noon local.
- [x] Oracle driver `oracledb` is declared in `package.json`.
- [ ] Production Oracle connection, populated record counts, Vercel deployment, last GitHub Action result, credentials and permissions are **not verified** by repository inspection.
- [ ] Full unification of Oracle historical + Sheets current across **all** frontend views is incomplete: `api/data.js` still reads historical Google Sheets and frontend requests separate Oracle statistics.
- [ ] `README.md` contains old "read-only/no write route" and environment guidance; should be refreshed against newer endpoints and secure configuration.

## Authoritative record model
Oracle tables seen referenced in code: `ADMIN.DS_MATCHES`, `ADMIN.DS_SELECTIONS`, `ADMIN.DS_SELECTION_STRATEGIES`, `ADMIN.DS_STRATEGIES`, `ADMIN.DS_BUILDERS`, `ADMIN.DS_BUILDER_LEGS`, `ADMIN.DS_ODDS_DAILY_LEGACY`.
Actual DDL, indexes, uniqueness constraints, database grants and migration history **must be inspected** before changes. Never assume table existence from SQL references alone.

Google Sheets tabs referenced: `СЕЛЕКЦИИ` (today / existing full rows), `СТРАТЕГИИ_ДАННИ`, `ДАННИ` (selections and builders), `АРХИВ BEST`, `ИСТОРИЯ КОЕФ.`, `СТАТИСТИКА`, `ДНЕВЕН ЦЕНТЪР`. Separate historical Sheets archive may still be used by `api/data.js`.

## Remaining phases (execute in order)
### P0 — Verify running system and protect data
- [ ] Confirm Oracle resource is **Always Free**, instance availability and correct ADMIN/schema user; never publish wallet, keys or tokens.
- [ ] Review Vercel environment: `ORACLE_USER`, `ORACLE_PASSWORD`, `ORACLE_CONNECT_STRING`, `ORACLE_WALLET_PEM`, `ORACLE_WALLET_PASSWORD`, `ADMIN_ACCESS_TOKEN`, and Google service account credentials; verify presence without logging values.
- [ ] Inspect real Oracle DDL / row counts, source Sheets tabs / row counts, last deployment and GitHub Actions runs. Capture an explicit baseline.
- [ ] Export/backup original data and document a restore procedure before destructive steps.
- [ ] Run `npm install && npm run check`; integration smoke tests must use deployed endpoints with protected credentials.
### P1 — Historical migration correctness
- [ ] Verify dry-run counts for full selections, strategies, Best singles, Best proposals, recorded builders and historical odds; resolve unmatched rows.
- [ ] Verify imports idempotent on re-run; ensure stable IDs do not depend on mutable Sheets row positions when practical.
- [ ] Reconcile source and Oracle by date, market, result, strategy, builder legs, P/L, not only total count; record audit report.
- [ ] Decide canonical natural keys: match date + stable match identity + market + selection + source identifier. Flag ambiguity, never merge different legitimate bets.
- [ ] Ensure void legs become odds 1 in builder settlement; pending builder status stays pending; Best proposal is model performance, not a placed bet.
### P2 — One hybrid read API
- [ ] Implement backend aggregator for Oracle history (before today Sofia) and current Sheets (today) for dashboard, matches, strategies, builders, statistics and date-range views.
- [ ] Stable cross-source dedupe and explicit source priority, pagination, consistent ISO date handling, no gaps at Sofia midnight.
- [ ] Preserve user filters and views; safely degrade with visibly labeled partial data if one source unavailable; **never silently report partial as complete**.
- [ ] Ensure frontend switches to aggregated endpoint instead of independently mixing sources or relying on old Sheets archive.
### P3 — Correct performance analytics
- [ ] Calculate P/L at 1u or actual stake consistently; Yield = total P/L / total settled stake * 100; WR = wins / (wins + losses) * 100; void stake inclusion explicitly documented.
- [ ] Treat strategy overlap and Best membership as tags on a logical single, not duplicate unique selections. Keep recorded builders and modeled Best builders distinct.
- [ ] Validate daily/time-range cumulative P/L, most recent games, settled/pending counts, category/source selection and zero-data periods.
- [ ] Compare Oracle-only, Sheets-only and merged reports with a fixed independent dataset.
### P4 — Reliable operations
- [ ] Verify noon Sofia job actually succeeds after winter/summer DST and is rerunnable.
- [ ] Implement structured audit logs, failure alerts, retries, dedupe, transaction safety, backup and clear rollback.
- [ ] Archive only eligible records with known status; choose explicit retention for unresolved matches. No automatic Sheet deletion until all audits pass.
- [ ] Add monitoring for database capacity/connections/timeouts, stale Sheets reads, and last successful archive.
### P5 — Frontend quality and release
- [ ] Test Android/PWA, caching/version rollover, unauthenticated access, all tabs, exact-score representation, crests/flags, date/market filters.
- [ ] Verify old historic Sheet fallback can be removed only after Oracle parity.
- [ ] Update `README.md`, technical CSV handoff, and release notes after every meaningful change.

### V19 interface release — 2026-11-16
- [x] Source implemented: five bottom tabs **Днес / Мачове / Статистика / Стратегии / Профил**; Билдъри and Архив are accessible through **Профил**, and direct in-app shortcuts still work.
- [x] Source implemented: three selectable home layouts — A Premium Sports, B Data Analytics, C Minimal Pro — stored as `ds-design`. Selection in Profile persists per browser/device.
- [x] Source implemented: dark default with persistent light/dark toggle (`ds-theme`); styling targets both modes and major legacy components.
- [x] Source implemented: home A/B statistics uses all available Oracle history for strategy keys `A,B,C,D1,D2,D3,E,F` by `/api/oracle-stats?sources=...` without a date filter; C shows a compact summary and expandable full breakdown. Labeled Sheets fallback if Oracle read fails.
- [x] Source implemented: real today Best selections, dates, league, fixture cards and odds still originate from Google Sheets; no UI hardcoded counts.
- [x] Source implemented: PWA cache version v28 and asset query versions v191 updated together.
- [x] Static JS syntax compiled in isolated V8 and source-level consistency checks passed for app/service worker and nav/asset references.
- [x] Regression contract test source added at `tests/ui-contract.test.mjs`, invoked by `npm run check`.
- [ ] `npm run check` execution in Node, external/browser functional tests, Vercel build/deployment, actual Oracle authenticated responses, Android light-theme screenshots and end-to-end reconciliation **not yet independently verified**.
- [ ] Legacy strategies detail still consumes `api/data.js` (Sheets). The home A-F historical summary consumes Oracle; do not equate those reports without parity checks.
- [ ] Existing `api/data.js` mixes current and historical Sheets; unified API migration remains open (P2-01).

#### Interface acceptance checklist
- [ ] On Android browser and installed PWA, confirm navigation is exactly five tabs; profile routes open both builders and Oracle archive; returning via five tabs works.
- [ ] Dark is default on a fresh device; toggling light survives reload/reopen. Validate text contrast on every legacy page.
- [ ] Switching A/B/C in Profile updates home without changing data; selection survives reload.
- [ ] Check live today's Best against `СЕЛЕКЦИИ!A3:O8`; today's match selections against `СЕЛЕКЦИИ!A11:O`.
- [ ] Compare A–F home Oracle count, WR, Yield, P/L and daily chart to protected `/api/oracle-stats` and independent archive for the **entire imported time range**.
- [ ] If Oracle is unreachable, show clearly labeled Sheets fallback; do not imply whole-database completeness.
- [ ] Validate no layout clipping on 320–430px screens, keyboard navigation, missing crest fallback, theme on strategies/builders/archive and PWA refresh.

## Known technical risks to review
1. `api/data.js` uses JSON/label-based dedupe for Sheet rows; it can retain duplicates or accidentally merge legitimate selections. Audit against Oracle identity rules.
2. `api/oracle-stats.js` returns historical-only stats; dashboard has Oracle-to-Sheets fallback. Fallback ≠ merged totals.
3. `api/oracle-stats.js` has a `maxRows:25000` ceiling for several result sets; historical growth needs SQL aggregates or pagination.
4. `api/history.js` uses offset pagination; confirm deterministic ordering and correct date filters for all categories.
5. Legacy odds importer has date-only observation precision; do not claim exact scrape timestamp.
6. Source row IDs derived partly from row indices can become unstable if Sheets rows are inserted/reordered.
7. Audit scripts compare counts and selected metrics, but successful operation must be proven from workflow logs and live data.
8. No automatically enforced guarantee that other AI agents update this document; every contributor must follow the contract below, or add a CI check.

## Mandatory change protocol — FOR EVERY FUTURE GITHUB CHANGE
Before modifying code, read this file and `docs/AI_HANDOFF.csv`.
For each logical GitHub change:
1. Identify affected subsystem and linked task IDs; preserve source-of-truth rules.
2. Modify code with tests. Do **not** claim tested if not run.
3. **In the same PR / commit as the code change**, update this plan: check completed items only if verified, add discoveries/open issues, change `Last reviewed`, add a change-log row below.
4. Update `docs/AI_HANDOFF.csv` task status, evidence, next action and last-reviewed date in the same change set.
5. Validate compilation, API output, metrics, source counts and production status when available.
6. Do not store secrets, wallets, raw personal account IDs or privileged endpoint tokens.
7. If deployment or a migration fails, mark blocked with evidence; do not erase history or claim success.
8. Prefer commits/PRs including both documentation files and code, so progress cannot silently drift.

## Change log
| Date | Change | Verification | Next |
|---|---|---|---|
| 2026-11-15 | Initial audited master plan + CSV handoff created from GitHub source inspection | Source code inspection only; no production runtime validation | P0 baseline and full integration audit |
| 2026-11-16 | V19: selectable A/B/C layouts, dark/light themes, five-tab nav, Profile relocation, historical A–F Oracle home KPIs, UI regression tests | App/SW JS syntax and source consistency inspected; live Node/Oracle/Vercel/Android tests pending | Verify CI and real authenticated user journeys, then P2 unified hybrid API |

## Definition of done
- The production app shows correct live-day data combined with historical Oracle records for all views.
- Verified count/date/result/strategy/odds/aggregate parity with independent source baselines.
- Daily automated import and a manually re-runnable job complete with visible audit evidence.
- No historical rows lost, duplicate bets incorrectly counted, unreported partial data, or secrets exposed.
- Backup, restore, alerting, documentation and mobile smoke tests completed.
