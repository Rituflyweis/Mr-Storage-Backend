# Import — duplicate skip shows the project name

**Date:** 20 Nov 2026  
**Panels:** Admin, Sales  
**Endpoints:** `POST /api/admin/leads/import`, `POST /api/sales/leads/import` (and the job status poll)

A row that matches a project already in the database is skipped. The skip line used to append the lead’s Mongo id:

`duplicate project (6b001fc0685e3531cdafa06f)`

The API now returns the project name and does **not** return `leadId` on that error.

## Error item

```json
{
  "row": 1,
  "reason": "duplicate project: Bob Grazulis - 80x100 PEMB",
  "projectName": "Bob Grazulis - 80x100 PEMB"
}
```

`row` is the data-row number in the parsed sheet (1-based within the rows that were imported, not the Excel row number).

## What to render

Show `projectName`, or show `reason` as-is.

```text
#1  duplicate project: Bob Grazulis - 80x100 PEMB
```

Do not append `leadId`. Do not look up the id. If an older response still has `leadId` and no `projectName`, keep the old fallback only for that case.

## When this happens

The same project name plus the same city, state, and ZIP is already a lead. Re-uploading a file that was already imported skips every row with this reason. That is not a missing-field failure.

A second copy of the same project inside one file uses the same reason and `projectName` from the sheet.
