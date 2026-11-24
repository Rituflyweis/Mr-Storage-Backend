# Expense categories and the budget link

**Audience:** Admin panel (Expenses, Budget Planning, Budget vs Actual)  
**Auth:** `Authorization: Bearer <admin access token>`  
**Base path:** `/api/admin/financials`

Expense **categories** have list and create. Edit and delete for a category are not built. Edit and delete do exist for an **expense row**. The budget link is the category name: that string is how a logged expense rolls into a budget card.

**Pending queue + edit + approve/reject:** see [edit-expenses-pending-apis-fe.md](./2026-11-23/edit-expenses-pending-apis-fe.md) (full request/response for `PUT` and `status=pending` list).

---

## Expense categories

| Action | Method | Path | Status |
| --- | --- | --- | --- |
| List | GET | `/expenses/categories` | Built |
| Create | POST | `/expenses/categories` | Built |
| Edit | — | — | Not built |
| Delete | — | — | Not built |

### GET `/api/admin/financials/expenses/categories`

Returns active categories, sorted by name. The five presets are always there, plus any name created from a custom budget line or from logging an expense.

```json
{
  "success": true,
  "data": {
    "categories": [
      { "_id": "...", "name": "Material", "isActive": true }
    ]
  }
}
```

### POST `/api/admin/financials/expenses/categories`

```json
{ "name": "Permits" }
```

`name` is required. A duplicate name returns 400, `Category already exists`.

```json
{
  "success": true,
  "data": {
    "category": { "_id": "...", "name": "Permits", "isActive": true }
  }
}
```

---

## Expense rows

This is the expense list edit and delete. `:expenseId` is the Mongo `_id`. Delete sets `isActive: false`. It does not remove the document.

| Action | Method | Path |
| --- | --- | --- |
| Create | POST | `/api/admin/financials/expenses` |
| Edit | PUT | `/api/admin/financials/expenses/:expenseId` |
| Delete | DELETE | `/api/admin/financials/expenses/:expenseId` |

**POST** body:

| Field | Required | Notes |
| --- | --- | --- |
| `category` | Yes | Must match a category name. Server creates the category if the name is new. |
| `amount` | Yes | Number. |
| `leadId` | Required for project budget vs actual | Expenses without `leadId` do not appear on that project's budget vs actual. |
| `date`, `description`, `subcategory`, `buildingLabel`, `department`, `paymentMethod`, `status`, `receiptFile` | No | Send when the form has them. |

**PUT** sends only the fields to change. Same field names as create.

---

## How an expense is tied to a budget

The link is the **category name**, not a separate id.

| Budget card | Stored amount | Expense `category` that rolls into it |
| --- | --- | --- |
| `material` | `materialBudget` | `Material` |
| `logistic` | `logisticBudget` | `Logistics` |
| `production` | `productionBudget` | `Manpower` |
| `shipper` | `shipperBudget` | `Subcontractor` |
| `other` | `otherCost` | `Miscellaneous` |
| Custom line, for example Permits | `customLines[].amount` | That line's `expenseCategories`, defaulting to the label (`Permits`) |

`GET /api/admin/leads/:leadId/budget` puts those names on each card as `planningCards[].expenseCategories`.

Creating a custom budget line creates the matching expense category when `expenseCategories` is omitted.

`POST /api/admin/leads/:leadId/budget/custom-lines`

```json
{ "label": "Permits", "amount": 8000 }
```

Optional `expenseCategories` overrides the default. If omitted, the server stores `["Permits"]` and creates that expense category.

`GET /api/admin/financials/budget-vs-actual?leadId=` sums active expenses for that lead into `costHeads`. A category listed on a custom line is counted only on that line, not again under Miscellaneous.

Account panel uses the same shape: `GET /api/account/financial/budget-vs-actual?leadId=`.

---

## Dropdown

Fill the expense category dropdown from either:

- `GET /api/admin/financials/expenses/categories`, or
- `planningCards[].expenseCategories` on `GET /api/admin/leads/:leadId/budget`

Use those exact strings as `Expense.category` so the amount lands on the right budget card.
