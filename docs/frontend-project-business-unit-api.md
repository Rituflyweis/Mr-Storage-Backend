# Project business unit (Storage Material / Platform / Steel) — Frontend guide

**Date:** 2026-09-28  
**Audience:** Frontend (Admin, Sales, Plant, Construction, Accounts)  
**Auth:** `Authorization: Bearer <accessToken>` (same as today)

Every project (lead) can now be tagged with the business it belongs to. Quotations, invoices, PDFs and emails are **unchanged** — this is a project label + filter only.

---

## 1. Field

| Field | Type | Values |
|-------|------|--------|
| `businessUnit` | string \| `null` | `"storage_material"`, `"platform"`, `"steel"` |
| `businessUnitLabel` | string (response only) | `"Storage Material"`, `"Platform"`, `"Steel"`, or `""` when not set |

- Existing projects return `businessUnit: null`, `businessUnitLabel: ""` → show **"Not set"**.
- Values are case-insensitive on input (`"Steel"` is stored as `"steel"`).
- Any other value → `400` with `businessUnit must be one of: storage_material, platform, steel`.

**Dropdown options (hardcode or read from `GET /api/construction/dashboard/filters` → `businessUnits`):**

```json
[
  { "value": "storage_material", "label": "Storage Material" },
  { "value": "platform", "label": "Platform" },
  { "value": "steel", "label": "Steel" }
]
```

---

## 2. Create — send `businessUnit` in the body

Currently **optional** (so existing forms keep working). The UI should make it a required select; the backend may enforce it later.

| Action | Method | Path |
|--------|--------|------|
| Admin — add lead | POST | `/api/admin/leads` |
| Admin — add customer + first project | POST | `/api/admin/customers` |
| Admin — add project for customer | POST | `/api/admin/customers/:customerId/leads` |
| Sales — add lead | POST | `/api/sales/leads` |
| Sales — add project for customer | POST | `/api/sales/customers/:customerId/projects` |

```json
{
  "customerId": "…",
  "projectName": "Warehouse A",
  "buildingType": "Storage",
  "businessUnit": "storage_material"
}
```

The created `lead` in the response includes `businessUnit` and `businessUnitLabel`.

**CSV import** (`POST /api/admin/leads/import`, `POST /api/sales/leads/import`): optional `businessUnit` column. Missing/invalid → left as `null` (row still imports).

---

## 3. Edit

| Action | Method | Path |
|--------|--------|------|
| Admin — edit lead | PUT | `/api/admin/leads/:leadId` |
| Sales — edit lead | PUT | `/api/sales/leads/:leadId` |

```json
{ "businessUnit": "steel" }
```

- Send one of the three values to change it.
- Send `null` (or `""`) to clear it.
- Omit the key to leave it unchanged.
- The change is recorded in the lead audit log (`previousBusinessUnit` → `businessUnit`).

---

## 4. Where it is returned

Every endpoint below returns `businessUnit` + `businessUnitLabel` on each project/lead row (or on `lead` / `project` in detail responses).

| Panel | Endpoint |
|-------|----------|
| Admin | `GET /api/admin/leads`, `GET /api/admin/leads/:leadId/detail`, `GET /api/admin/leads/by-score`, `/ai-handled`, `/signed-contracts`, `/terminated`, escalations |
| Admin | `GET /api/admin/customers/:customerId/projects`, `GET /api/admin/customers/:customerId/projects/:leadId` |
| Sales | `GET /api/sales/leads`, `GET /api/sales/leads/:leadId/detail`, `/by-score`, `/scored`, `/escalated`, `/with-po` |
| Sales | `GET /api/sales/customers/:customerId/projects` |
| Plant / Admin plant | `GET /api/plant/projects`, `GET /api/plant/projects/:leadId/detail` (also `/api/admin/plant/projects…`), plus plant list rows that show project name (BOM, shipper files, bundle plans, packing lists) |
| Construction | `GET /api/construction/projects`, `GET /api/construction/projects/:leadId`, calendar entries, dashboard `activeSites`, `dashboard/filters` projects |
| Accounts | `GET /api/account/projects` |
| Lookups | `GET /api/leads` (project dropdowns) |
| Live updates | admin/sales lead-list socket rows |
| Customer portal | `GET /api/customer/projects`, project detail |

**Exports:** admin/sales Excel export has a **Business Unit** column; sales CSV export appends a `businessUnit` column at the end.

---

## 5. Filter lists by business unit

Add `?businessUnit=` to list requests:

| Value | Returns |
|-------|---------|
| `storage_material` / `platform` / `steel` | Only that business |
| `none` | Projects with no business unit set |
| omitted | All (unchanged behaviour) |

Supported on:

- `GET /api/admin/leads`, `/by-score`, `/ai-handled`, `/signed-contracts`, `/terminated`, `/export/excel`
- `GET /api/sales/leads`, `/by-score`, `/scored`, `/with-po`, `/export`, `/export/excel`
- `GET /api/admin/customers/:customerId/projects`, `GET /api/sales/customers/:customerId/projects`
- `GET /api/plant/projects`, `GET /api/plant/projects/stats` (and admin plant equivalents)
- `GET /api/construction/projects`, `/projects/calendar`, `/dashboard`
- `GET /api/account/projects`
- `GET /api/leads`

Example:

```http
GET /api/admin/leads?businessUnit=steel&page=1&limit=20
```

---

## 6. Frontend checklist

- [ ] Add a **Business Unit** select (3 options) to Add Lead, Add Project, Add Customer + Project, and Edit Lead forms.
- [ ] Show `businessUnitLabel` (or "Not set") on lead/project lists and detail headers.
- [ ] Add a Business Unit filter to lead/project list screens → pass `?businessUnit=`.
- [ ] Construction dashboard: optional Business Unit filter using `dashboard/filters` → `businessUnits`.

---

## 7. Not changed

- Quotation / invoice / SOW / contract PDFs and emails.
- Quotations, invoices, POs do not store their own copy — read the unit from the project.
