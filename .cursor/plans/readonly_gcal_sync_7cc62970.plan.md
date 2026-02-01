---
name: readonly_gcal_sync
overview: Sync read-only schedules (combi, part-time, meals) to Google Calendar primary without adding them to Firebase events, while keeping them write-only from this app and ignoring GCal edits.
todos:
  - id: inspect-sync-flow
    content: Review Google sync + merge points in app.js/code.js
    status: pending
  - id: readonly-export
    content: Add readonly export payload from shifts/meals/combi
    status: pending
  - id: apps-script-tagging
    content: Tag readonly events in code.js and expose flag
    status: pending
  - id: import-skip
    content: Skip readonly-tagged GCal events in merge
    status: pending
  - id: verify
    content: Manual verification with auto sync + GCal edit
    status: pending
isProject: false
---

- Inspect existing Google sync flow in [/Users/user/Library/CloudStorage/Box-Box/Personal/dev/scdl_mgr/app.js](/Users/user/Library/CloudStorage/Box-Box/Personal/dev/scdl_mgr/app.js) and Apps Script in [/Users/user/Library/CloudStorage/Box-Box/Personal/dev/scdl_mgr/code.js](/Users/user/Library/CloudStorage/Box-Box/Personal/dev/scdl_mgr/code.js) to align payload shape and tag logic.
- Add a readonly export pipeline in `syncEventsToGoogleCalendar()` that builds a list from `shifts`, `mealEvents`, `combiTimetableEvents`, and `combiTaskEvents`, using stable IDs (existing `shift_`, `meal_`, `combi_` IDs) and a `readonly`/`source` flag in the payload.
- Update Apps Script `doPost`/`processMutations` helpers to accept readonly events (e.g., `payload.readonlyEvents` or `eventPayload.readonly === true`) and tag them with a distinct description marker (e.g., `schedule_mgr_ro_id:`) when creating/updating events in the primary calendar. This keeps them isolated from normal events.
- Extend `fetchCalendarEvents()` to return a `readonly` flag (based on the new tag) and, in `normalizeGoogleEvent`/`mergeGoogleEvents` in `app.js`, skip importing readonly-tagged events so they never enter the Firebase `events` array.
- Ensure Google edits are overwritten by app data by always upserting readonly events during scheduled sync (already done by `startAutomaticGoogleSync()`), while leaving CRUD→Google mutations unchanged for normal events.
- Add/adjust tests or manual verification steps: run auto sync, confirm readonly events appear in Google Calendar, remain absent from Firebase `events`, and local view remains read-only even after manual GCal edits.

