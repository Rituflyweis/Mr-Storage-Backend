# Admin expenses — edit, pending list, and approval

**Date:** 23 Nov 2026  
**Panel:** Admin → Financials → Expenses  
**Auth:** `Authorization: Bearer <admin access token>`  
**Base path:** `/api/admin/financials`

There is **no separate approve/reject route**. Pending expenses are listed with a query flag; **approve**, **reject**, **mark paid**, and **edit fields** all use **`PUT /expenses/:expenseId`**.  
`:expenseId` is the expense document **`_id`** (Mongo ObjectId), not the human-readable `expenseId` string (e.g. `EXP-2026-00042`).

Related: category list/create and budget link → `../expense-category-apis-fe.md` (parent folder) and `../budget-expense-category-sync-fe.md`.

---

## Status enum

| `status` | UI label (suggested) | Notes |
|----------|----------------------|--------|
| `pending` | Pending approval | Default on new expenses |
| `approved` | Approved | Counts as approved spend in account analytics rollups |
| `paid` | Paid | Treated like approved in analytics |
| `rejected` | Rejected | Stays on list unless filtered out |

**Payment methods:** `cash`, `bank_transfer`, `credit_card`, `upi`, `cheque`, `other`  
**Departments:** `Sales`, `Plant`, `Construction`, `Support`

---

## List expenses (including pending queue)

### `GET /api/admin/financials/expenses`

| Query | Description |
|-------|-------------|
| `status` | e.g. `pending` for approval queue |
| `category` | Category name; ignore or omit for “All” |
| `projectId` | Lead `_id` (project) |
| `buildingLabel` | Building filter |
| `startDate`, `endDate` | Filter on expense `date` |
| `search` | Substring match on `description` |
| `page`, `limit` | Pagination (default `page=1`, `limit=20`) |

**Pending tab example**

```
GET /api/admin/financials/expenses?status=pending&page=1&limit=20
```

**200** — `data`:

```json
{
  "success": true,
  "data": {
    "stats": {
      "totalExpense": 125000,
      "byCategory": [{ "category": "Material", "total": 80000 }]
    },
    "expenses": [
      {
        "_id": "674a1b2c3d4e5f6789012345",
        "expenseId": "EXP-2026-00123",
        "category": "Material",
        "subcategory": "",
        "date": "2026-11-20T00:00:00.000Z",
        "amount": 4500,
        "description": "Steel delivery",
        "leadId": { "_id": "...", "projectName": "Twin Creek", "jobId": "JOB-9081" },
        "buildingLabel": "Building A",
        "department": "Plant",
        "paymentMethod": "bank_transfer",
        "status": "pending",
        "receiptFile": "https://...",
        "isActive": true,
        "createdBy": { "_id": "...", "name": "Admin User" },
        "createdAt": "...",
        "updatedAt": "..."
      }
    ],
    "total": 42,
    "page": 1,
    "limit": 20
  }
}
```

Only **active** rows (`isActive: true`) are returned.

---

## Filter metadata (dropdowns)

### `GET /api/admin/financials/expenses/filters`

**200** — `data.statuses`, `data.paymentMethods`, `data.departments`, `data.categories`, `data.buildingLabels`, `data.projects` (`leadId`, `projectName`, `jobId`).

Use for filter bar and edit form selects.

---

## Create expense

### `POST /api/admin/financials/expenses`

| Field | Required | Notes |
|-------|----------|--------|
| `category` | Yes | Name string; server creates category if new |
| `amount` | Yes | Number |
| `date` | Recommended | Expense date |
| `leadId` | No | Required for project budget vs actual |
| `subcategory`, `description`, `buildingLabel`, `department`, `paymentMethod`, `receiptFile` | No | |
| `status` | No | Defaults to **`pending`** if omitted |

```json
{
  "category": "Permits",
  "amount": 1200,
  "date": "2026-11-22T00:00:00.000Z",
  "leadId": "674a1b2c3d4e5f6789012346",
  "description": "City permit fee",
  "paymentMethod": "cheque",
  "status": "pending"
}
```

**200** — `data.expense` (includes generated `expenseId` and `_id`).

---

## Edit expense (fields + approval)

### `PUT /api/admin/financials/expenses/:expenseId`

Send **only fields that change**. Same field names as create.

**Edit metadata while pending**

```json
{
  "amount": 1300,
  "description": "Updated permit fee",
  "category": "Permits",
  "paymentMethod": "bank_transfer"
}
```

**Approve**

```json
{ "status": "approved" }
```

**Reject**

```json
{ "status": "rejected" }
```

**Mark paid** (after approval, if your UI has a paid step)

```json
{ "status": "paid" }
```

**200** — `data.expense` (full updated document).

**404** — unknown `:expenseId`.

There is **no** dedicated `POST .../approve` or `.../reject`; do not wait for those routes.

---

## Delete (soft)

### `DELETE /api/admin/financials/expenses/:expenseId`

Sets `isActive: false`. Row disappears from default list. Does not hard-delete.

**200** — `{ "success": true, "message": "Expense deleted" }`.

---

## Export / import

| Action | Method | Path |
|--------|--------|------|
| Export Excel | GET | `/expenses/export` (same query params as list) |
| Import CSV | POST | `/expenses/import` body `{ "csv": "<raw csv>" }` |

Import columns: `category,subcategory,date,amount,description,projectId,buildingLabel,paymentMethod,status`. Default import `status` is `pending` when column empty.

---

## Recommended UI flows

### Expenses table

1. Tabs or filters: **All** | **Pending** | **Approved** | **Paid** | **Rejected** → `status` query on list GET.
2. Row actions: **Edit** → modal → `PUT` with changed fields.
3. Pending row: **Approve** → `PUT { "status": "approved" }`; **Reject** → `PUT { "status": "rejected" }`.
4. Optional **Mark paid** → `PUT { "status": "paid" }`.
5. **Delete** → `DELETE` (confirm dialog).

Use `_id` from list response as `:expenseId` in PUT/DELETE URLs.

### After approve/reject

- Refresh list or patch row from `data.expense`.
- Budget vs actual (`GET /budget-vs-actual?leadId=`) sums **all active** expenses for that project (any status). Account **analytics** treats only `approved` / `paid` as approved spend — see account docs if you mirror that split on admin KPIs.

---

## Not built (do not call)

| Feature | Status |
|---------|--------|
| `PUT` / `DELETE` **expense category** by id | Not implemented — only list + create category |
| Separate approve/reject endpoints | Use `PUT` + `status` |
| Account panel full expense edit | Account has create + `PUT .../deactivate` only (`/api/account/expenses`) |

---

## Quick test (curl)

```bash
TOKEN="<admin jwt>"
BASE="https://mr-storage-backend-025k.onrender.com/api/admin/financials"

# Pending queue
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/expenses?status=pending&limit=5"

# Approve one row
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"approved"}' \
  "$BASE/expenses/<mongo _id>"
```

---

## Checklist for FE

- [ ] Pending list uses `GET .../expenses?status=pending`
- [ ] Edit + approve/reject/paid use same `PUT .../expenses/:_id`
- [ ] URL id is Mongo `_id`, not `expenseId` string
- [ ] New expenses default to pending when `status` omitted
- [ ] Category dropdown from `GET .../expenses/categories` or budget `planningCards`
- [ ] Soft delete via `DELETE`, not another PUT flag