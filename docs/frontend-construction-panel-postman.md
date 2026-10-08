# Construction panel — Postman collection

**File:** [`construction-panel.postman_collection.json`](../construction-panel.postman_collection.json) (repo root)

**Live base URL (default in collection):**  
`https://mr-storage-backend-025k.onrender.com/api`

**Local:** set collection variable `baseUrl` to `http://localhost:3000/api`

---

## Import

1. Postman → **Import** → select `construction-panel.postman_collection.json`
2. Run **Auth → Login (construction user)** with a `construction` or `admin` account
3. The test script saves `data.accessToken` into `{{token}}`

---

## Collection variables

| Variable | Use |
|----------|-----|
| `token` | Bearer JWT (auto-set on login) |
| `leadId` | Project / lead Mongo `_id` |
| `taskId`, `deliveryId`, `requestId`, `itemId` | Resource IDs from list/detail responses |
| `bundleId`, `packingListId`, `loadId` | Logistics screens |
| `jobId`, `docId`, `stepKey`, `channelKey`, `userId`, `notificationId` | As labeled in requests |

---

## What’s included (104 requests, 18 folders)

| Folder | Coverage |
|--------|----------|
| Auth | Staff login |
| Dashboard | KPIs + filters |
| Projects & Calendar | List, detail, progress, milestones |
| Project Manufacturing | BOM, plant deliveries, bundles, packing (read-only) |
| Drawings & Attachments | Site documents + review |
| Photos & Videos | `construction/media` |
| Tasks | CRUD + stats |
| Project Steps | Customer tracking steps |
| Work Logs | List + create |
| Material Requests | List/filters/export, detail, create, **cancel**, quotations, item deliver |
| Delivery Tracking | Filters, list/export, **create delivery**, receive, site contact, PDFs, scan |
| Label Printing | List, export, print |
| Bundle Scan | History, export, scan, bundle actions |
| Packing Lists | List, export, PDF, status transitions |
| Dispatch Verification | List, export, verify load, confirm dispatch |
| Upload | Presigned URL for attachments |
| Notifications | Staff notifications (`/api/notifications`) |
| Chat | Direct + department (`/api/construction/chat/*`) |

Each request documents **query parameters** (with descriptions) and **example JSON bodies** where applicable. Many requests include a saved **example response** (`200` / `201`) showing the standard `{ success, message, data }` shape.

**Binary responses:** export and PDF routes return Excel/PDF — use Postman **Send and Download**.

---

## Regenerate after route changes

```bash
node scripts/build-construction-postman.mjs
```

---

## Related FE docs

- Logistics filters/exports: [frontend-handoff-construction-logistics.md](./frontend-handoff-construction-logistics.md)
- Add delivery: [frontend-construction-add-delivery-api.md](./frontend-construction-add-delivery-api.md)
- Material requests (cancel): [frontend-construction-material-request-api.md](./frontend-construction-material-request-api.md)
- Tasks GET: [frontend-construction-tasks-get-api.md](./frontend-construction-tasks-get-api.md)
- Work logs GET: [frontend-construction-work-logs-get-api.md](./frontend-construction-work-logs-get-api.md)
