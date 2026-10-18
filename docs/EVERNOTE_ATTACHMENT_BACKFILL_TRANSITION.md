# Recall Evernote attachment-backfill transition

This release needs no database migration and does not rewrite the checkpoint of
the production full-sync run. The existing run
`sync-1792271256921-4s1bym` (job `sync-1792271256921-4s1bym`) remains the
attachment-backfill owner.

## Deploy and transition

1. Follow `docs/DEPLOY.md`: record the current SHA, create and restore-test a
   backup, and deploy the exact PR head SHA. No pending migration is expected
   for this change.
2. Keep the existing Evernote switches and 1–5 AM America/New_York window
   unchanged. In particular, leave `EVERNOTE_SYNC_ENABLED`,
   `EVERNOTE_INCREMENTAL_SYNC_ENABLED`, and
   `EVERNOTE_FULL_RECONCILE_ENABLED` enabled.
3. Reload the Recall API/worker with PM2 as described in `docs/DEPLOY.md`. Do
   not cancel, complete, clone, or edit the existing `sync_runs` row or job.
4. On startup:
   - a queued job resumes with its existing availability and checkpoint;
   - a job interrupted while `processing` is re-queued by stale-job recovery
     after its 15-minute lease expires;
   - the scheduler recognizes the full run's `attachments` phase as a
     completed note baseline and creates one separate incremental note run;
   - the original job only downloads/extracts pending attachments in the night
     window. Attachments discovered by incrementals are inserted or reset to
     `pending` in that same connector backlog.
5. Verify the transition with read-only queries:

   ```sql
   SELECT id, status, metadata->>'evernoteSyncMode' AS mode,
          metadata->>'evernotePhase' AS phase,
          metadata->'evernoteCheckpoint' AS checkpoint
   FROM sync_runs
   WHERE connector_id = '<production connector id>'
     AND status IN ('queued', 'running')
   ORDER BY started_at;

   SELECT id, status, attempts, available_at, locked_at, last_error
   FROM jobs
   WHERE id IN (
     'sync-1792271256921-4s1bym',
     (SELECT id FROM sync_runs
      WHERE connector_id = '<production connector id>'
        AND metadata->>'evernoteSyncMode' = 'incremental'
      ORDER BY started_at DESC LIMIT 1)
   );

   SELECT fetch_state, count(*)
   FROM evernote_attachments
   WHERE connector_id = '<production connector id>'
   GROUP BY fetch_state
   ORDER BY fetch_state;
   ```

   The first result should show the original full run in `attachments` plus at
   most one incremental run. The incremental should progress
   `notes` → `trash` → `complete`; it must never enter `attachments`.

6. Outside the night window, confirm the full job is queued with
   `last_error` containing `outside the night window`. During the window,
   confirm its attachment counts resume changing. Confirm new or edited notes
   advance `connectors.last_sync_at` on the normal incremental schedule.

## Rollback

For an application-only rollback, first set
`EVERNOTE_INCREMENTAL_SYNC_ENABLED=false` and reload Recall. Wait for any
already-running incremental row to reach `complete` or `partial_success`, then
deploy the recorded previous SHA using `docs/DEPLOY.md`. This leaves only the
original full attachment run active, which the previous release understands.
Do not restore the database: this change is schema-free and all writes use
existing idempotent rows.

If an emergency requires stopping immediately, disable the Evernote connector
before rolling back so no old worker can claim one of the two active jobs.
After the rollback, inspect the two run/job rows before re-enabling it.
