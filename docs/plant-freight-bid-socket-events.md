# Plant panel — freight bid Socket.io events

Real-time notifications when a **freight carrier** submits a bid via the public carrier link. Mirrors the shipper flow (`shipper_file_submitted` / `all_shipper_files_submitted`).

**Namespace:** `/admin` (same as other plant panel events)

**Auth:** Plant user JWT in Socket.io handshake (`auth: { token: accessToken }`)

---

## When events fire

Triggered by **`POST /api/public/freight-bids/:token/submit`** after a carrier saves their quote.

| Event | When |
|-------|------|
| `freight_bid_submitted` | Every successful carrier bid submission |
| `all_freight_bids_submitted` | After a submission, **no** bids for that delivery remain `sent` or `resubmit_requested` (all invited carriers have responded) |

**Recipients:** All plant users with an **approved PO** assigned to the project (`POOrder.assignedTo`, `status: 'approved'`).

**Room:** `user:{plantUserId}` (joined automatically on connect)

---

## Connect

```javascript
import { io } from 'socket.io-client'

const socket = io(`${API_ORIGIN}/admin`, {
  auth: { token: plantAccessToken },
})

socket.on('connect', () => {
  // user:{userId} room is joined by the server
})
```

---

## `freight_bid_submitted`

Fired once per carrier submission.

### Payload

```json
{
  "leadId": "6a2ff893542dbde8d31e876d",
  "deliveryId": "6a327628a2982523aa1e91ac",
  "deliveryNumber": "DEL-0012",
  "bidId": "6a328001a2982523aa1e91bd",
  "carrierId": "6a310001a2982523aa1e9001",
  "carrierName": "ABC Freight LLC",
  "submittedAt": "2026-06-17T14:22:00.000Z",
  "quotedAmount": 4200,
  "projectName": "ABC Warehouse",
  "jobId": "PRO-019"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `leadId` | string | Mongo lead `_id` — use for project navigation |
| `deliveryId` | string | Freight request id |
| `deliveryNumber` | string | Human-readable delivery ref |
| `bidId` | string | Freight bid row id |
| `carrierId` | string | Carrier id |
| `carrierName` | string | Display name |
| `submittedAt` | ISO date | Submission timestamp |
| `quotedAmount` | number | Carrier bid amount (USD) |
| `projectName` | string | May be empty — use `jobId` fallback |
| `jobId` | string | e.g. `PRO-019` |

### Suggested UI actions

- Toast: **"{carrierName} submitted a freight bid (${quotedAmount})"**
- Refresh freight bid list: `GET /api/plant/projects/:projectId/freight/bids` or `GET /api/plant/deliveries/:deliveryId/bids`
- Refresh freight KPIs: `GET /api/plant/deliveries/freight/stats`
- Highlight the bid row for `bidId`

### Example listener

```javascript
socket.on('freight_bid_submitted', (data) => {
  showToast(`${data.carrierName} submitted $${data.quotedAmount} for ${data.deliveryNumber}`)
  refreshFreightBids(data.leadId, data.deliveryId)
})
```

---

## `all_freight_bids_submitted`

Fired when the **last pending** carrier for a delivery submits (no bids left in `sent` or `resubmit_requested`).

Typical case: plant sent bids to 3 carriers → third submission triggers this event **in addition to** `freight_bid_submitted`.

### Payload

```json
{
  "leadId": "6a2ff893542dbde8d31e876d",
  "deliveryId": "6a327628a2982523aa1e91ac",
  "deliveryNumber": "DEL-0012",
  "bidCount": 3,
  "projectName": "ABC Warehouse",
  "jobId": "PRO-019"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `bidCount` | number | Total freight bids on this delivery |
| Other fields | | Same as single-submit event |

### Suggested UI actions

- Banner / alert: **"All carrier bids received for DEL-0012 — ready to review and award"**
- Enable or highlight **Award carrier** flow
- Refresh `GET /api/plant/deliveries/freight/stats` (`bidsPending` should decrease)

### Example listener

```javascript
socket.on('all_freight_bids_submitted', (data) => {
  showAlert(`All ${data.bidCount} carrier bids received for ${data.deliveryNumber}`)
  refreshFreightStats()
})
```

---

## Public submit API response (new field)

`POST /api/public/freight-bids/:token/submit` now includes:

```json
{
  "success": true,
  "message": "Freight bid submitted",
  "data": {
    "bidId": "...",
    "status": "submitted",
    "quotedAmount": 4200,
    "carrierNotes": "",
    "submittedAt": "2026-06-17T14:22:00.000Z",
    "allFreightBidsSubmitted": true
  }
}
```

`allFreightBidsSubmitted` — carrier portal can show a confirmation message; plant panel should rely on **socket events**, not this field.

---

## Comparison with shipper events

| Shipper | Freight |
|---------|---------|
| `shipper_file_submitted` | `freight_bid_submitted` |
| `all_shipper_files_submitted` | `all_freight_bids_submitted` |
| Vendor uploads quote file | Carrier submits `quotedAmount` |
| `requestId`, `vendorId`, `quoteValue` | `bidId`, `carrierId`, `quotedAmount`, `deliveryId` |

---

## Full plant socket event list (reference)

| Event | Module |
|-------|--------|
| `project_assigned` | Projects |
| `bom_extraction_complete` | BOM |
| `bom_extraction_failed` | BOM |
| `shipper_file_submitted` | Shipper |
| `all_shipper_files_submitted` | Shipper |
| `shipper_comparison_complete` | Shipper |
| `shipper_comparison_failed` | Shipper |
| **`freight_bid_submitted`** | **Freight** |
| **`all_freight_bids_submitted`** | **Freight** |

See also: `docs/plant-dashboard-api.md` (dashboard integration + all socket events).

---

## Frontend checklist

- [ ] Listen for `freight_bid_submitted` on plant dashboard and freight bid screens
- [ ] Listen for `all_freight_bids_submitted` to show “ready to award” state
- [ ] On event, refresh bids API + `deliveries/freight/stats`
- [ ] Navigate using `leadId` / `jobId` + `deliveryId`
- [ ] Requires deploy of backend with socket emit on public submit route
