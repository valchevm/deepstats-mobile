# DeepStats: Oracle + daily Google Sheets migration

## Security boundary
Browser -> Vercel /api/data (authenticated) -> Oracle / Google Sheets (server credentials only).
Never put Oracle passwords, wallet, ORDS credentials, Google service-account keys, or spreadsheet IDs in browser bundles. Sheet IDs are identifiers, not security controls; revoke public/link sharing and share only with the service account and necessary editors. Keep Oracle in private access where possible; restrict database privileges and use a dedicated least-privilege application user.

## Migration stages
1. Back up both Sheets and Oracle. Review actual source columns and formulas; no deletion yet.
2. Run sql/oracle-schema.sql in the designated Oracle schema; verify created objects.
3. Configure Vercel server-side Oracle connection (details depend on Autonomous Database connection type; do not commit secrets).
4. Import existing archive tabs and historical daily rows into Oracle using stable per-record IDs, MERGE, and reconciliation.
5. Switch /api/data historical reads to Oracle; merge only Sofia-local today rows from Sheets. Preserve API response shapes and deduplicate.
6. Replace historical stats formulas with scheduled server-side aggregated snapshots (Oracle history + today's Sheet rows).
7. Enable scheduled archive after midnight Europe/Sofia. Verify inserted rows, statuses, counts and checksums before deleting yesterday's Sheet rows. Retry idempotently. Pending outcomes stay in Oracle and are updated when results arrive.
8. Remove historical tabs only after a successful backfill, reconciliation, and backup. Do not remove summary/statistics tabs.

## Constraints
- Vercel API currently reads Sheets using readonly Google scope; scheduled cleanup needs a separately authorized writer.
- Current app uses a single APP_ACCESS_TOKEN. This hides sources from anonymous visitors but a shared token is not individual user authentication; add per-user sessions and rate limiting before broad public access.
- Avoid exposing raw upstream errors or direct source URLs to clients.
- Today's date is calculated in Europe/Sofia, not UTC.
- The live migration is NOT enabled by adding this schema or guide alone.
