# Change Orders + Request Deposit → Contract / Preview (FE handoff)

Backend fixes for manager feedback:

1. Change order was not updating the earlier contract price.
2. Request Deposit alone was not showing on quote preview / payment milestones.

---

## Product rules (confirmed)

| Topic | Rule |
|--------|------|
| **When to use Change Order** | Only after the estimate is **`final`** (contract issued / client done). While **`draft`**, edit the quote price directly — do not create a CO. |
| **What CO updates** | Creates a CO document **and** updates the parent estimate’s **revised contract total** (shown on quote/contract preview). |
| **Request Deposit** | Saves deposit terms **and** syncs a Deposit (+ Remaining Balance) into `milestoneSchedule`, so quote preview shows the payment schedule. |

---

## 1. Change orders

### Markup % formula (match client quoting tool)

The **Markup %** field on Change Order is a **target margin on sell**, same as the client URL tool (`coCalcFromMarkup`):

```text
CO Sell Amount = round( CO Cost / (1 - Markup% / 100) )
```

| Cost | Markup % | Correct sell | Profit | Margin |
|------|----------|--------------|--------|--------|
| 50,000 | 10 | **55,556** | 5,556 | **10.0%** |
| 50,000 | 10 | ~~55,000~~ (wrong) | 5,000 | 9.1% |

**Do not use** `sell = cost * (1 + markup/100)` on Change Orders — that is markup-on-cost and produces the 9.1% mismatch.

**FE live calc (when Markup % or Cost changes):**

```js
const sell = Math.round(cost / (1 - markup / 100))  // markup < 100
// then profit = sell - cost, margin = (profit / |sell|) * 100
```

**When Sell Amount is typed manually:** keep sell; set Markup % display to the computed margin (client `coCalcAll`).

**Preview API:** `POST /change-orders/preview`

```json
{ "origVal": 78155, "cost": 50000, "markup": 10 }
```

→ `{ "amount": 55556, "profit": 5556, "margin": 10.0, "markup": 10.0, "newTotal": 133711, … }`

If FE accidentally sends the wrong sell (`amount: 55000` with `markup: 10` + `cost: 50000`), backend corrects amount to **55556**.

To force markup-driven sell even when amount is present: `{ "fromMarkup": true }`.

### Gate

`POST /api/sales/change-orders` and `PUT /api/sales/change-orders/:coId` require the linked estimate to be **`status: "final"`**.

If still draft:

```json
{
  "success": false,
  "message": "Change orders are only allowed after the estimate is final (client contract issued). Edit the draft quote to change price instead."
}
```

**FE action**

- Hide / disable Change Order until `estimate.status === 'final'`.
- When marking the contract issued / client accepted, set the estimate to final:

```http
PUT /api/sales/estimates/:estimateId
{ "status": "final" }
```

(Only draft estimates are otherwise editable; setting `status: "final"` is the intended lock.)

### Create / update / delete response — new `estimate` block

After a successful CO create/update/delete linked to an `estimateId`, response `data` includes:

```json
{
  "_id": "…",
  "coNum": 1,
  "origVal": 2493316,
  "amount": 55000,
  "newTotal": 2548316,
  "estimate": {
    "_id": "…",
    "status": "final",
    "originalContractValue": 2493316,
    "revisedContractTotal": 2548316,
    "totalSell": 2548316,
    "grandTotal": 2548316,
    "depositTerms": { "… optional …" },
    "milestoneSchedule": [ "… rescaled if deposit/milestones existed …" ]
  }
}
```

**FE action**

- After save CO, refresh estimate / preview from `data.estimate` (or refetch estimate + documents preview).
- Show **Revised Total** = `estimate.revisedContractTotal` (or `newTotal` on the CO).
- Keep **Original Contract** = `estimate.originalContractValue` (locked on first CO).

### Quote / contract preview

```http
POST /api/sales/estimates/documents/preview
{ "estimateId": "<id>" }
```

Response now includes:

- `grandTotal` → revised total when COs exist  
- `originalContractValue`  
- `revisedContractTotal`  
- `quoteHtml` / `contractHtml` use the revised total for Total Contract Value  

Deleting all COs restores the original contract value.

### `parentQuoteRef` only (no `estimateId`)

Still allowed for the local quote library. **No** parent estimate price sync (nothing to update). Prefer `estimateId` for saved estimates.

---

## 2. Request Deposit

### Save (behavior change)

```http
PUT /api/sales/estimates/:estimateId/deposit
{
  "pct": 40,
  "note": "optional"
}
```

or flat:

```json
{ "flat": 50000, "note": "optional" }
```

**Previously:** only `depositTerms` saved → preview stayed empty.

**Now:** response includes milestones synced from the deposit:

```json
{
  "grand": 2493316,
  "pct": 40,
  "deposit": 997326,
  "balance": 1495990,
  "flat": null,
  "note": "",
  "depositTerms": { "grand": 2493316, "pct": 40, "deposit": 997326, "balance": 1495990, "note": "" },
  "milestoneSchedule": [
    { "label": "Deposit", "type": "pct", "pct": 40, "amount": 997326 },
    { "label": "Remaining Balance Due", "type": "fixed", "amount": 1495990, "pct": 60 }
  ],
  "milestones": [ "… same as milestoneSchedule …" ],
  "scheduled": 2493316,
  "remaining": 0,
  "fullyScheduled": true
}
```

> Legacy fields (`pct`, `deposit`, `balance`, `grand`) stay at the top level so existing FE does not break.

If a custom milestone schedule already exists (non-deposit rows), Deposit is upserted as the **first** row; other milestones are kept.

**FE action**

1. After **Save Deposit Terms**, update local `depositTerms` **and** `milestoneSchedule` from the response (do not ignore milestones).
2. Re-open / refresh quote preview — Milestone Payment Schedule should show Deposit + Remaining Balance.
3. Payment Milestones modal should show the same rows without a separate save.
4. Deposit receipt PDF with only `{ estimateId }` now uses saved `depositTerms` (pct/flat/note).

### Preview

Same as before:

```http
POST /api/sales/estimates/documents/preview
{ "estimateId": "<id>" }
```

`quoteHtml` includes **Milestone Payment Schedule** when deposit was saved (or milestones were saved).  
Contract `[DEPOSIT%]` uses saved deposit % / flat when `contract.deposit` is not overridden.

---

## 3. Suggested UI checklist

- [ ] Change Order button only when `estimate.status === 'final'`
- [ ] Draft: tooltip / message — “Finalize contract before change orders; edit quote to change price”
- [ ] After CO save: refresh header contract value from `estimate.revisedContractTotal`
- [ ] After Request Deposit save: bind `milestoneSchedule` from response and refresh preview iframe
- [ ] History → Request Deposit → Save → open Quote Preview → schedule visible without opening Milestones

---

## 4. Quick API map

| Action | Method / path |
|--------|----------------|
| Finalize estimate | `PUT /estimates/:id` `{ "status": "final" }` |
| Create CO | `POST /change-orders` `{ estimateId, amount, description, … }` |
| Save deposit | `PUT /estimates/:id/deposit` `{ pct }` or `{ flat }` |
| Quote preview | `POST /estimates/documents/preview` `{ estimateId }` |
| Deposit receipt | `POST /estimates/documents/deposit-receipt/pdf` `{ estimateId }` |

Base path: `/api/sales` (or `/api/admin` where the same routers are mounted).
