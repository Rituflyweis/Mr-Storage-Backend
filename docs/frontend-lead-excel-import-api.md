# Bulk lead import — quick reference

**Full frontend handoff (import + job polling, examples, checklist):**  
**[`docs/frontend-handoff/lead-bulk-import-api.md`](./frontend-handoff/lead-bulk-import-api.md)**

| Panel | POST | GET job status |
|--------|------|----------------|
| Admin | `/api/admin/leads/import` | `/api/admin/leads/import/jobs/:jobId` |
| Sales | `/api/sales/leads/import` | `/api/sales/leads/import/jobs/:jobId` |

- Excel **> 50 rows** → **202** + poll until `status: completed`  
- Admin: `data.created` · Sales: `data.imported`  
- Multipart field: `file` (or `csv` / `excel` / `document`)
