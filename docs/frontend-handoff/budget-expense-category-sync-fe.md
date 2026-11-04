# Project budget ↔ expense categories ↔ Budget vs Actual

**Audience:** Admin panel (Budget Planning, Expenses, Margin / Budget vs Actual) · Account panel (project budget vs actual where already wired)  
**UAT base:** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <access_token>`

---

## Summary for frontend

**No required API or payload changes.** Existing screens keep the same routes and request bodies.

Backend now:

1. Keeps **expense category names** aligned with **budget preset cards** and **custom budget line labels**.
2. Maps logged **expenses** into **budget vs actual cost heads** (including custom lines).
3. Exposes **`expenseCategories`** on budget **`planningCards`** (read-only hint for which `Expense.category` values roll into each card).

Use **`GET .../budget`** after saves if you need fresh **`planningCards`** (some write responses return the raw `ProjectBudget` document without `planningCards`).

---

## Preset budget card → expense category (canonical names)

| Budget preset (`categoryKey` / card `key`) | Stored budget field | Expense category name (use in expense forms) | Cost head in budget vs actual |
|--------------------------------------------|---------------------|-----------------------------------------------|-------------------------------|
| `material` | `materialBudget` | **Material** | Material Cost |
| `logistic` | `logisticBudget` | **Logistics** | Carrier/Freight Cost |
| `production` | `productionBudget` | **Manpower** | Manpower/Labor Cost |
| `shipper` | `shipperBudget` | **Subcontractor** | Subcontractor Cost |
| `other` | `otherCost` | **Miscellaneous** | Miscellaneous Cost |

Legacy expense labels still work (e.g. `Vendor/Freight` rolls into **Material Cost**; `Freight`, `Transport` into **Carrier/Freight Cost**). Prefer the canonical names above for new data.

---

## Admin — Budget Planning (per lead)

**Prefix:** `/api/admin/leads/:leadId`

| Method | Path | Notes |
|--------|------|--------|
| GET | `/budget` | Returns enriched `data.budget` (see below). |
| PUT | `/budget` | Body: preset amounts + optional `customLines[]`. |
| PUT | `/budget/categories/:categoryKey` | Body: `{ "amount": number }`. `categoryKey`: `material` \| `logistic` \| `production` \| `shipper` \| `other`. |
| POST | `/budget/custom-lines` | Body: `{ "label": string, "amount": number, "expenseCategories"?: string[] }`. **201** on create. |
| PUT | `/budget/custom-lines/:lineKey` | Update label, amount, optional `expenseCategories`. |
| DELETE | `/budget/custom-lines/:lineKey` | Remove custom card only (presets cannot be deleted). |

### GET `/budget` — response shape (relevant fields)

```json
{
  "success": true,
  "data": {
    "budget": {
      "_id": "...",
      "leadId": "...",
      "materialBudget": 100000,
      "logisticBudget": 25000,
      "productionBudget": 40000,
      "shipperBudget": 15000,
      "otherCost": 5000,
      "customLines": [
        {
          "key": "custom_a1b2c3d4",
          "label": "Permits",
          "amount": 8000,
          "expenseCategories": ["Permits"]
        }
      ],
      "totalBudget": 193000,
      "expectedProfit": 0,
      "planningCards": [
        {
          "key": "material",
          "label": "Material Budget",
          "description": "...",
          "amount": 100000,
          "isPreset": true,
          "canDelete": false,
          "expenseCategories": ["Material"]
        },
        {
          "key": "custom_a1b2c3d4",
          "label": "Permits",
          "amount": 8000,
          "isPreset": false,
          "canDelete": true,
          "expenseCategories": ["Permits"]
        }
      ]
    }
  }
}
```

**Custom lines:** If the client omits `expenseCategories`, the server defaults to `[label]` and creates/links an **ExpenseCategory** with that name.

**Optional FE improvement (not required):** Populate expense category dropdowns from `planningCards[].expenseCategories` or from `GET /api/admin/financials/expenses/categories` so users pick names that match budget rows.

---

## Admin — Log expense

**POST** `/api/admin/financials/expenses`

| Field | Required | Notes |
|-------|----------|--------|
| `category` | Yes | Trimmed; server ensures matching **ExpenseCategory** exists. |
| `amount` | Yes | Number. |
| `leadId` | Strongly recommended | **Required for project budget vs actual.** Expenses without `leadId` do not appear in `GET .../budget-vs-actual?leadId=...`. |
| `date`, `description`, `status`, … | As today | Unchanged. |

Response: `{ "success": true, "data": { "expense": { ... } } }` with resolved `category` string (canonical casing from DB).

---

## Admin — Budget vs Actual

**GET** `/api/admin/financials/budget-vs-actual?leadId=<ObjectId>`

Optional query: `startDate`, `endDate`, `department`, `costCategory`, `groupBy=department`.

Without `leadId`, returns `{ "projects": [...] }` for project picker (unchanged).

### With `leadId`

```json
{
  "success": true,
  "data": {
    "project": { "_id", "projectCode", "projectName", "clientName", "projectManager" },
    "budgetSummary": {
      "totalBudget": 193000,
      "totalActual": 40200,
      "totalActualExpenses": 40200,
      "totalInvoiced": 0,
      "totalVariance": -152800,
      "budgetUsedPct": 21,
      "status": "Under Budget"
    },
    "costHeads": [
      {
        "head": "Material Cost",
        "isCustom": false,
        "budget": 100000,
        "actual": 32900,
        "variance": -67100,
        "variancePct": -67.1,
        "status": "Under Budget"
      },
      {
        "head": "Permits",
        "key": "custom_a1b2c3d4",
        "isCustom": true,
        "budget": 8000,
        "actual": 2200,
        "variance": -5800,
        "variancePct": -72.5,
        "status": "Under Budget",
        "expenseCategories": ["Permits"]
      }
    ],
    "customBudgetLines": [ "...same as ProjectBudget.customLines..." ],
    "note": "..."
  }
}
```

**How to bind UI**

| UI section | Field |
|------------|--------|
| Total budget / actual / variance / % used | `data.budgetSummary` |
| Table or chart by cost head | `data.costHeads` — append preset rows + `isCustom: true` rows |
| Custom budget definitions | `data.customBudgetLines` or lead GET `customLines` |

**Rules**

- **Totals:** `totalActual` = sum of **active** expenses for that `leadId` (respects date filters when provided).
- **Custom lines:** Actual = sum of expenses whose `category` matches that line’s `expenseCategories` (case-insensitive). Those categories are **excluded** from preset/miscellaneous double-counting.
- **Invoices:** `totalInvoiced` is informational; variance is **expense vs budget**, not invoice-based.

---

## Account panel

**GET** `/api/account/financial/budget-vs-actual?leadId=...` delegates to the same logic as admin (shared handler). Same `budgetSummary` and `costHeads` shape.

---

## Expense category list API

Unchanged; after deploy, seed ensures presets exist:

- **Material**, **Logistics**, **Manpower**, **Subcontractor**, **Miscellaneous**
- Plus any names created from custom budget labels or new expenses.

Use existing category list endpoints your expense UI already calls (e.g. `GET /api/admin/financials/expenses/categories` if wired).

---

## QA checklist (frontend)

1. Set preset budgets on a lead → log expenses with categories **Material**, **Logistics**, etc., with **`leadId`** set.
2. Add custom budget line **Permits** → log expense `category: "Permits"` → **Budget vs Actual** shows a **Permits** row with correct actual; **Miscellaneous** does not include that amount twice.
3. **GET** lead budget → each **planningCard** includes **`expenseCategories`**.
4. Legacy expense `Vendor/Freight` still increases **Material Cost** actual.

---

## Backend deploy notes (ops / not FE)

After deploy to an environment, run once against that environment’s MongoDB (with `MONGO_URI` set):

```bash
node scripts/seed-default-expense-categories.js
node scripts/backfill-budget-expense-links.js
```

Integration test (local or CI with DB):

```bash
node scripts/test-budget-expense-category-sync.js
```

Optional HTTP section: server on `BASE_URL` (default `http://127.0.0.1:5001`) and valid admin login (`ADMIN_LOGIN_PASSWORD`).
