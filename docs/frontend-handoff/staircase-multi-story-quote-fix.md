# Frontend handoff — Staircase / Multi-Story on Quote (fix)

Staircases were missing from the **Pricing Summary** even when Multi-Story was enabled. This doc explains the bug, the fix (deployed), and how the React app should send multi-story / staircase fields so they appear on quote HTML/PDF.

**Deployed:** commit `51e3975` on `shubham-changes-13-aug`  
**Live:** `https://mr-storage-backend-025k.onrender.com`

**Reference UI**

| File | What to mirror |
|------|----------------|
| [`SM-QuotingTool-API.html`](../../SM-QuotingTool-API.html) | Multi-Story toggle + staircase inputs (~L1170–1218) |
| Same · `updateStaircaseCost()` / `renderQuote()` / `pembGrandTotal()` | Live Pricing Summary line |
| Backend | `src/services/quoting/staircase.js`, `quotePricingOrchestrator.js`, `quoteDocumentGenerator.js` |

**Related:** [`API_INTEGRATION.md`](../API_INTEGRATION.md) §3 compute + §7 multi-story · [`pemb-quoting-extraction-api.md`](./pemb-quoting-extraction-api.md)

---

## 1. Product rule (HTML tool)

| Control | HTML id | Behavior |
|---------|---------|----------|
| **Multi-Story / Decking Project** | `#multistory-toggle` | Turns on multi-story SOW language; shows staircase row |
| **Number of staircases** | `#staircase-count` | Must be **> 0** or no staircase $ line |
| **$/staircase** | `#staircase-unit-cost` | Default **35000** |

**Important:** Checking Multi-Story alone does **not** add money. You must set staircase count ≥ 1. Then Pricing Summary shows:

`Staircases (N × $unitCost)` → included in **Total**.

Install-only scope: staircase sell is **$0** (same as add-ons / concrete).

---

## 2. What was broken

1. **Quote document HTML** (`quoteDocumentGenerator`) never rendered a staircase row and did not add staircase $ to grand total — so React preview/PDF looked like material + install + tax only.
2. FE often sent **`multiStory.staircaseCount` / `staircaseUnitCost`**, while the engine only read **`count` / `unitCost`** → `include: false`, sell = 0.
3. Empty / missing staircase on `fullQuote` could leave live preview without stairs until a later save recomputed totals.

---

## 3. What we fixed (backend + HTML)

- Accept both field shapes: `count` **or** `staircaseCount`, `unitCost` **or** `staircaseUnitCost`.
- Quote Pricing Summary now includes **Staircases (N × $…)** when sell > 0.
- Grand total folds staircase in when the client omitted it from `grandTotal` (same pattern as add-ons fix).
- HTML tool: multi-story toggle / count change calls `updateStaircaseCost()` → refreshes quote immediately.

---

## 4. Math

```
staircaseSell = count × unitCost     // default unitCost = 35000
include       = count > 0 && staircaseSell > 0
```

On full PEMB quote (non–install-only):

```
grandTotal = buildingSubtotal
           + drawings
           + concrete
           + insulation
           + pembAddOns
           + salesTax
           + staircaseSell
```

---

## 5. API payloads (use these)

Base: `${BASE}/api/sales` (admin: `/api/admin`)  
Auth: `Authorization: Bearer <accessToken>`

### 5.1 Preview only (no save)

`POST /estimates/staircase/preview`

**Request** (either shape works)

```json
{ "count": 2, "unitCost": 35000, "stories": 2 }
```

```json
{ "staircaseCount": 2, "staircaseUnitCost": 35000, "stories": 2 }
```

**Response `200`**

```json
{
  "success": true,
  "message": "…",
  "data": {
    "count": 2,
    "unitCost": 35000,
    "staircaseSell": 70000,
    "stories": 2,
    "include": true
  }
}
```

---

### 5.2 Include on compute (live Pricing Summary)

`POST /estimates/compute`

Send staircase on the compute body (recommended):

```json
{
  "parsedCategories": { },
  "jobType": "PEMB",
  "scope": "both",
  "roof": "screw-down",
  "install": "medium",
  "sf": 2000,
  "blendPct": 50,
  "salesTax": { "rate": 7, "include": true },
  "staircase": { "count": 2, "unitCost": 35000, "stories": 2 }
}
```

Or via multi-story alias:

```json
{
  "parsedCategories": { },
  "scope": "both",
  "sf": 2000,
  "salesTax": { "rate": 7, "include": true },
  "multiStory": {
    "stories": 2,
    "staircaseCount": 2,
    "staircaseUnitCost": 35000
  }
}
```

**Response (relevant `data.fullQuote` fields)**

```json
{
  "success": true,
  "data": {
    "pricing": { "totSell": 56742, "matSell": 38400, "instSell": 18342, "scope": "both", "sf": 2000 },
    "fullQuote": {
      "pricing": { "totSell": 56742 },
      "salesTax": { "rate": 7, "amount": 2688, "include": true },
      "grandTotal": 129430,
      "staircase": {
        "count": 2,
        "unitCost": 35000,
        "staircaseSell": 70000,
        "stories": 2,
        "include": true
      }
    }
  }
}
```

> Example: building `56742` + tax `2688` + stairs `70000` = **`129430`**.

Always prefer **`data.fullQuote.grandTotal`** and **`data.fullQuote.staircase`** for UI totals — not `pricing.totSell` alone (that is building only).

---

### 5.3 Document preview / PDF (must show staircase line)

`POST /estimates/documents/preview`  
`POST /estimates/documents/pdf`

**Request — send staircase even if `fullQuote.grandTotal` is stale**

```json
{
  "sections": ["quote", "sow"],
  "pricingResult": {
    "matSell": 38400,
    "instSell": 18342,
    "totSell": 56742,
    "pembDrawings": 0,
    "sf": 2000,
    "jobType": "PEMB",
    "scope": "both",
    "trucks": 1,
    "totWt": 10000,
    "isSS": false
  },
  "fullQuote": {
    "pricing": {
      "matSell": 38400,
      "instSell": 18342,
      "totSell": 56742,
      "pembDrawings": 0,
      "sf": 2000,
      "jobType": "PEMB",
      "scope": "both",
      "trucks": 1,
      "totWt": 10000,
      "isSS": false
    },
    "salesTax": { "rate": 7, "amount": 2688, "include": true },
    "grandTotal": 59430
  },
  "multiStory": {
    "stories": 2,
    "staircaseCount": 2,
    "staircaseUnitCost": 35000
  },
  "salesTax": { "rate": 7, "amount": 2688, "include": true }
}
```

Backend will render **Staircases (2 × $35,000)** and bump Total to **$129,430** even though the nested `grandTotal` was still `59430`.

**Also valid**

```json
{
  "estimateId": "<savedEstimateId>",
  "sections": ["quote", "sow", "contract"]
}
```

(uses saved `multiStory` / `fullQuote.staircase` on the estimate)

---

### 5.4 Persist on estimate

**On create / update** — include either:

```json
{
  "staircase": { "count": 2, "unitCost": 35000, "stories": 2 }
}
```

or

```json
{
  "multiStory": {
    "stories": 2,
    "staircaseCount": 2,
    "staircaseUnitCost": 35000
  }
}
```

**Dedicated update**

`PUT /estimates/:estimateId/multi-story`

```json
{ "count": 2, "unitCost": 35000, "stories": 2 }
```

Aliases `staircaseCount` / `staircaseUnitCost` are accepted by the staircase engine as well.

Saved shape on `EstimateQuote.multiStory`:

```json
{
  "stories": 2,
  "staircaseCount": 2,
  "staircaseUnitCost": 35000,
  "staircaseSell": 70000
}
```

---

## 6. Recommended FE flow

```
1. User toggles Multi-Story ON
2. User sets staircase count (+ optional $/unit)
3. POST /estimates/staircase/preview     → show = $ sell in panel
4. POST /estimates/compute               → body includes staircase | multiStory
5. Render UI from fullQuote.grandTotal + fullQuote.staircase
6. POST /estimates/documents/preview     → same staircase | multiStory on body
7. POST /estimates (or PUT)              → persist multiStory / staircase
```

Do **not** build Pricing Summary only from `matSell` + `instSell` + tax — you will drop stairs (and add-ons).

---

## 7. FE checklist

- [ ] Multi-story toggle shows staircase count / unit inputs  
- [ ] Count defaults or user entry must be **≥ 1** before expecting a quote line  
- [ ] Send `staircase: { count, unitCost, stories? }` **or** `multiStory: { staircaseCount, staircaseUnitCost, stories? }` on **compute**, **documents/preview**, and **save**  
- [ ] Display `fullQuote.staircase.staircaseSell` and use `fullQuote.grandTotal`  
- [ ] Quote HTML/PDF Pricing Summary shows `Staircases (N × $…)`  
- [ ] Install-only scope → staircase sell = 0  
- [ ] Compare against `SM-QuotingTool-API.html` for same count × unit  

---

## 8. Quick curl smoke (Render)

```bash
BASE=https://mr-storage-backend-025k.onrender.com
TOKEN=$(curl -sS -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"YOUR_SALES_EMAIL","password":"YOUR_PASSWORD"}' \
  | jq -r '.data.accessToken')

curl -sS -X POST "$BASE/api/sales/estimates/documents/preview" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "sections":["quote"],
    "pricingResult":{"matSell":38400,"instSell":18342,"totSell":56742,"pembDrawings":0,"sf":2000,"jobType":"PEMB","scope":"both","trucks":1,"totWt":10000,"isSS":false},
    "fullQuote":{"pricing":{"matSell":38400,"instSell":18342,"totSell":56742,"pembDrawings":0,"sf":2000,"jobType":"PEMB","scope":"both","trucks":1,"totWt":10000,"isSS":false},"salesTax":{"rate":7,"amount":2688,"include":true},"grandTotal":59430},
    "multiStory":{"staircaseCount":2,"staircaseUnitCost":35000,"stories":2},
    "salesTax":{"rate":7,"amount":2688,"include":true}
  }' | jq -r '.data.quoteHtml' | grep -E 'Staircases|q-total-row'
```

Expect: staircase row + Total **$129,430**.

---

*Last updated: October 2026 — fix `51e3975`.*
