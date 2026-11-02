# Frontend handoff — Milestone % rounding & “Total Exceeds Contract Value”

Fixes the Milestone Payments modal showing **+$1 over contract** (e.g. **$129,856** scheduled vs **$129,855** contract) on **PEMB**, **Storage**, and any job type when rows are **30% / 40% / 30%** (or similar) and the UI sums **locally rounded dollar lines**.

**Backend:** no change required — `computeMilestones` already absorbs up to **$1** penny drift on the **last row**.  
**Frontend:** stop blocking save on client-only math; drive amounts from the milestone preview/save APIs.

**Related:** [`milestone-payments-quote-preview.md`](./milestone-payments-quote-preview.md)

---

## 1. Symptom (what users see)

- Header: **Total Contract Value** = `$129,855`
- Rows: Deposit **30%** → `$38,957`, First **40%** → `$51,942`, Final **30%** → `$38,957`
- UI sum: **$129,856** → red alert *“Scheduled payments exceed the total contract value by $1”*
- **Save & Create Schedule** disabled or treated as error
- Often reported on **PEMB** with **tax off**; after **tax on**, contract **grand** changes and the alert may disappear (different total → different rounding — not a separate PEMB bug)
- Same UI on **Storage COG** → **Edit payment modes** / lead **Payment Schedule** (e.g. **$265,399** contract vs **$265,400** scheduled at 30/30/40)

---

## Storage COG — Edit payment modes (lead payment schedule)

Same rounding issue as the **Milestone Payments** modal. Two save paths:

| Surface | API |
|--------|-----|
| Quote milestone modal | `PUT /api/sales/estimates/:estimateId/milestones` |
| **Edit payment modes** (invoice / lead) | **`PUT /api/payment-schedules/lead/:leadId`** |

**Prefill / refresh from quote:**

```http
GET /api/payment-schedules/lead/:leadId
GET /api/payment-schedules/lead/:leadId?refreshFromQuote=true
```

**Save (send contract grand so backend can fix $1 drift on last stage):**

```http
PUT /api/payment-schedules/lead/:leadId
```

```json
{
  "contractGrand": 265399,
  "totalAmount": 265399,
  "stages": [
    { "stageName": "Deposit", "amount": 79620, "amountType": "fixed" },
    { "stageName": "First", "amount": 79620, "amountType": "fixed" },
    { "stageName": "Final Completion", "amount": 106160, "amountType": "fixed" }
  ]
}
```

Backend adjusts the **last** fixed stage by up to **$1** when `contractGrand` / `totalAmount` is set (Final → **$106,159**). UI should still use **`milestones/preview`** for display and treat **`fullyScheduled`** / **|remaining| ≤ 1** as OK (see §4).

---

## 2. Root cause

1. Each **percent row** is rounded to whole dollars independently:  
   `amount = Math.round(grand * pct / 100)` per row.
2. Those rounded lines **do not always sum** to `grand` (classic off-by-$1…$N).
3. The modal validates **`sum(row amounts) === grand`** strictly in the browser.
4. The **API** recalculates and **adjusts the last milestone** by at most **$1** so `scheduled === grand`.

Example (matches production reports):

| grand | Rows | Naive sum | API after absorb |
|------:|------|----------:|-----------------:|
| 129,855 | 30 / 40 / 30 | 129,856 (+$1) | 129,855 (Final **$38,956**) |

---

## 3. Contract `grand` (must match quote total)

Use the **same** contract value as the quote **Total / grand total**, not `pricing.totSell` alone.

**Source of truth (in order):**

1. `POST …/milestones/preview` response field **`grand`**
2. Or estimate: `fullQuoteResult.grandTotal`, Storage `storagePricingResult.grandTotal`, or `totalSell` after load/recompute
3. Backend helper: estimate grand = building + add-ons + concrete + insulation + **sales tax when tax is included** on the quote

When the user toggles **Include tax**:

- Refresh **`grand`** from a fresh **compute** or **GET estimate** before opening or saving milestones.
- Do not keep a stale pre-tax grand in the modal while the quote header shows tax-included total (or the opposite).

**Admin panel:** same routes under `/api/admin/estimates/…` (alias of sales estimate routes).

---

## 4. Required FE behavior

### 4.1 Always preview before strict validation

On **open modal**, **grand change**, **tax toggle**, or **row % / $ edit** (debounce ~300ms):

```http
POST /api/sales/estimates/milestones/preview
Authorization: Bearer <token>
Content-Type: application/json
```

**Body (live editor — send current rows):**

```json
{
  "estimateId": "<optional but recommended>",
  "grand": 129855,
  "rows": [
    { "label": "Deposit", "type": "pct", "pct": 30 },
    { "label": "First", "type": "pct", "pct": 40 },
    { "label": "Final Completion", "type": "pct", "pct": 30 }
  ]
}
```

**History (only id):**

```http
POST /api/sales/estimates/:estimateId/milestones/preview
{ "estimateId": "<id>" }
```

**Use the response for UI:**

| Field | Use |
|--------|-----|
| `grand` | Header “Total Contract Value” |
| `rows[].amount` | **Display** dollar column (not re-round % locally only) |
| `scheduled` | Footer total scheduled |
| `remaining` | Should be **0** when valid |
| `fullyScheduled` | **true** → allow save; prefer this over raw sum |
| `milestoneSchedule` | Same as `rows` (alias in response) |

Example response shape:

```json
{
  "success": true,
  "data": {
    "grand": 129855,
    "rows": [
      { "label": "Deposit", "type": "pct", "pct": 30, "amount": 38957 },
      { "label": "First", "type": "pct", "pct": 40, "amount": 51942 },
      { "label": "Final Completion", "type": "pct", "pct": 30, "amount": 38956 }
    ],
    "scheduled": 129855,
    "remaining": 0,
    "pct": 100,
    "fullyScheduled": true
  }
}
```

### 4.2 Validation rules (replace strict client sum)

**Do not** block save when:

- `data.fullyScheduled === true`, or
- `Math.abs(data.remaining) <= 1` and `data.scheduled` is within **$1** of `data.grand`

**Do** block when:

- `Math.abs(data.remaining) > 1`, or
- Percent rows sum to **> 100%** of contract (product rule), or
- API returns error

Optional UX: if local sum differs from `scheduled` by ≤ $1, show info *“Adjusted on last milestone to match contract”* using **`rows` from API**.

### 4.3 Save

```http
PUT /api/sales/estimates/:estimateId/milestones
```

Send **labels + types + pct or amount**; backend runs `computeMilestones` again and persists corrected **`amount`** values.

```json
{
  "grand": 129855,
  "rows": [
    { "label": "Deposit", "type": "pct", "pct": 30 },
    { "label": "First", "type": "pct", "pct": 40 },
    { "label": "Final Completion", "type": "pct", "pct": 30 }
  ],
  "note": ""
}
```

If `grand` is omitted, backend uses saved estimate grand (`resolveEstimateGrandTotal`).

After save, update local state from **response** `rows` / `milestoneSchedule`, not from pre-save client math.

---

## 5. Optional client mirror (only if preview is skipped)

If you must compute offline, mirror backend (`depositMilestoneEngine.js`):

1. For each row: `amount = Math.round(grand * pct / 100)` for `type: "pct"`.
2. `remaining = Math.round(grand - sum(amounts))`.
3. If `remaining !== 0` and `Math.abs(remaining) <= 1`, add `remaining` to **last row** `amount` (floor at 0).

Prefer the **API** so PEMB/Storage/tax rules stay in one place.

---

## 6. QA checklist

- [ ] PEMB, tax **off**, grand **129855**, 30/40/30 → preview → **fullyScheduled: true**, Final **38956**, save enabled
- [ ] Toggle tax on → **grand** in modal matches quote header after recompute
- [ ] Storage COG quote — same preview/save paths (`/api/sales/estimates/…`)
- [ ] History: open modal with only `estimateId` → `milestones/preview` hydrates grand + rows
- [ ] No red “+$1” when `fullyScheduled === true`
- [ ] Invoice / payment schedule uses saved `milestoneSchedule` from PUT (backend already aligned)

---

## 7. One-line for PM

**The server already fixes $1 rounding on the last milestone; the modal must use milestone preview/save API amounts and `fullyScheduled`, not a strict sum of locally rounded percent lines.**
