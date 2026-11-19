/** Legacy entrypoint intentionally delegates to the fail-closed, audited sync runner.
 * This script must never perform direct row-by-row overwrites.
 * Default is preview only; SYNC_MODE=live requires full preflight.
 */
await import('./sync-workbook-run.mjs');
