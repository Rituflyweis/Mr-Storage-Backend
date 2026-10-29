# Project ID year format (`2026001`) — FE handoff

> Related: Customers list hides bulk-import stubs — see `docs/frontend-account-customers-api.md` (same rules now on Admin/Sales Customers).


## Requirement

Project IDs must be consistent year format: **`202601` / `2026001` style** (`YYYY` + sequence), not `PRO-075` and not local `UNIQ-…` temp IDs.

Live examples: `2026236`, `2026237`, … `2026240`.

## Backend behaviour (fixed)

| Case | Behaviour |
|------|-----------|
| New lead/project | Always assigns `YYYY###` (e.g. `2026241`) |
| Create body sends `jobId: "PRO-…"` / `UNIQ-…` | **Ignored** — year ID still assigned |
| Patch `jobId` to non-year | **Rejected** |
| Existing `PRO-*` in DB | Still old until migration is run (see below) |

API fields (same value):

- `jobId`
- `projectId` (alias)

Optional after migration: `previousJobId` (old `PRO-075` etc.).

## FE checklist

- [ ] Lead list **LEAD INFO** shows `jobId` / `projectId` from the API under client + project name.
- [ ] Do **not** keep showing optimistic IDs like `UNIQ-1793…` after create — replace with response `jobId`.
- [ ] Search/filter by project id uses `jobId` / `projectId`.
- [ ] Do not assume `PRO-###` only.

## Migrate existing PRO / empty IDs (ops)

```bash
# Preview
node scripts/migrate-jobids-to-year-format.js

# Apply
node scripts/migrate-jobids-to-year-format.js --apply
```

After migrate, refresh lead list — every row should show `2026…` (or current year) IDs.
