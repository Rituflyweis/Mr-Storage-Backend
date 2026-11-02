# Change Order PDF / Print — use backend document (not local template)

## Problem

The sales panel was opening a **minimal** change-order print view (few fields, no SM header, no blue total banner, no terms/signatures).

The **client sample** (SM-QuotingTool `printCO`) is already implemented on the backend in `changeOrderDocument.js`.

## What FE should do

After create/save a change order, **do not** build print HTML in React. Call:

### Preview HTML (iframe / new tab)

```http
GET /api/sales/change-orders/:coId/document
Authorization: Bearer <token>
```

Response `data.html` is a full HTML page (logo, customer grid, **Revised Contract Total** banner, description, price adjustment table, terms, signatures).

Open with:

```js
const w = window.open('', '_blank')
w.document.write(data.html)
w.document.close()
```

Or iframe `srcDoc={data.html}`.

### PDF download

```http
GET /api/sales/change-orders/:coId/document?format=pdf
```

or

```http
POST /api/sales/change-orders/:coId/pdf
{ "format": "html" }   // optional — returns html only
```

POST without `format` returns `fileBase64` PDF + `html`.

## Document includes (matches client tool)

- Company logo / wordmark + address, phone, email, website  
- CHANGE ORDER #N, reference, tax ID  
- Customer, change order date, original contract date, **Amendment To**  
- Blue **Revised Contract Total** box (original / CO adjustment / new total)  
- Description of change  
- Price adjustment ledger (all COs on this estimate)  
- Payment note, legal terms, dual signatures  

Optional **Change Order Economics** block when cost/profit/margin are set on the CO.

## Field mapping

API stores `description` and `coDate`; the document normalizer maps them for print.
