# Customer Panel — API Notes for Frontend

Base URL: `{{baseUrl}}/api/customer` (Postman: `customer-portal.postman_collection.json`, updated)
Auth: `Authorization: Bearer <customerToken>` on every route except `/auth/*`.

> This covers two passes over the Figma Customer Panel screens. The second pass found two real gaps worth flagging up front:
> 1. **Drawings had no per-building grouping at all** — the model only stored one flat list per project. Added `buildingLabel` + `category` and three new endpoints.
> 2. **"Order Quotations" was pointed at the wrong model in the first pass.** The existing `Quotation` model is the whole-building RFQ/steel-building quote (used on the Project Overview "RFQ" tab) — totally different from the Figma "Order Quotations" screens, which show coil type/length/qty/color/unit-price line items tied to a Material Order. That had **no backing model at all**. Built a new `OrderQuotation` model + full endpoint set for it. `GET /quotations/summary` now reads from `OrderQuotation`, not `Quotation`.

---

## 1. Project Overview — third pass: real Project Steps + embedded orders
- `GET /projects/:leadId` — header info, **now also returns**:
  - `projectSteps` — the 5-node stepper (see below).
  - `orders: { recent: [...5 latest], counts: { newOrders, pending, completed } }` — so the "Orders List / View All" preview on this screen doesn't need a second call.
- `GET /projects/:leadId/stats` — also now returns `projectSteps` (same object, for screens that only hit `/stats`).
- `GET /projects/:leadId/tracking` — **NEW**, powers the "Project Tracking" tab: `projectSteps`, `taskProgress { completed, inProgress, pending, total, completedPct }`, `timeline { plannedCompletion, status }`, `milestones[]`.
- `POST /projects/:leadId/cancel` — body `{ reason }`. *(existing)*
- `GET /projects/:leadId/orders` — orders list for this project, **now includes a `project` header object** (leadId/projectName/jobId/location).

### Project Steps stepper — Design → Fabrication → Dispatch → Install → Complete
Computed server-side from `Lead.lifecycleStatus` + `lifecycleHistory`, mapping the 21 granular sales+plant lifecycle stages down to these 5 buckets:
```json
{
  "steps": [
    { "key": "design", "label": "Design", "status": "completed", "date": "2026-06-01T..." },
    { "key": "fabrication", "label": "Fabrication", "status": "in_progress", "date": null },
    { "key": "dispatch", "label": "Dispatch", "status": "pending", "date": null },
    { "key": "install", "label": "Install", "status": "pending", "date": null },
    { "key": "complete", "label": "Complete", "status": "pending", "date": null }
  ],
  "currentStepNumber": 2, "totalSteps": 5, "currentStepLabel": "Fabrication", "overallProgressPct": 40
}
```
`overallProgressPct = currentStepNumber / totalSteps` — a project at step 4 of 5 (Install) shows 80%, matching the Figma example exactly.

**Known limitation, flagged honestly:** nothing in the data model marks a project "Complete" beyond the `delivered` stage — there's no separate installation/closure signal. So once a project reaches `delivered`, **Install** shows `in_progress` and **Complete** stays `pending` forever. If you need a real "Complete" state, we need a new flag (e.g. a "mark project complete" action) — let us know and we'll wire it up. Also: `date` per step comes from `lifecycleHistory` entries within that bucket, so it'll be `null` for leads whose history wasn't populated when they were created (older/imported leads) — new leads created through the app will have it.

### Per-step detail (Current Step Details panel) — new
Each step in the array above now also carries:
```json
{
  "startedBy": "Installation Team", "startedAt": "2025-05-28T10:30:00.000Z",
  "completedBy": "Sarah Lee", "completedAt": "2025-05-12T10:00:00.000Z",
  "currentStage": "Wall Panel Installation", "completionPct": 80,
  "expectedCompletion": "2025-06-08T00:00:00.000Z",
  "notes": "Installation is proceeding as per schedule.",
  "attachments": [{ "name": "Installation.pdf", "url": "https://..." }]
}
```
Backed by a new `ProjectStepDetail` model (one record per project per step-key). It's a pure overlay — `status` (completed/in_progress/pending) and `date` always come from `Lead.lifecycleStatus`/`lifecycleHistory` as before; this model only supplies the descriptive fields (`startedBy`, `currentStage` sub-label, step-level `completionPct`, `expectedCompletion`, `notes`, `attachments`). For a step with no detail record yet, `completedBy`/`startedBy`/`currentStage`/`notes` are `''`, `completionPct` falls back to `100` (completed) / `0` (pending) / `null` (in-progress, no explicit % set), `attachments` is `[]`.

**Written by staff, not the customer** — construction-panel-only:
- `PUT /api/construction/projects/:leadId/steps/:stepKey` — body: any of `startedBy, startedAt, completedBy, completedAt, currentStage, completionPct, expectedCompletion, notes`. `stepKey` = `design|fabrication|dispatch|install|complete`. Upserts.
- `POST /api/construction/projects/:leadId/steps/:stepKey/attachments` — body `{ name, url }`, pushes onto that step's attachment list.

Tested live end-to-end: staff `PUT`s a new `completionPct`/`notes` and `POST`s an attachment → customer's `/tracking` response reflects both immediately.

**Mock data:** `scripts/seedCustomerMiscMock.js` seeds all 3 projects, each at a different realistic stage (not just PRO-001 — PRO-002 and PRO-011 were caught still returning empty/null step-detail fields and fixed):
- **PRO-001** — matches the Figma screen exactly: pushed to `delivered` (Install active), Design/Fabrication/Dispatch completed by Sarah Lee/Michael Smith/David Brown, Install in progress at 80% with the Installation.pdf/Safety.pdf attachments.
- **PRO-002** — mid-way: Design completed (Priya Nair), Fabrication in progress at 45% ("Frame Assembly").
- **PRO-011** — just started: Design in progress at 20% ("Concept Drawings"). Also fixed this project's blank `projectName`/`location` (were empty strings from the original base seed) — now `"warehouse - Austin"` / `"Austin"`.

## 2. Drawings & Images (rebuilt with building-level grouping)
Three-level hierarchy now, matching the Figma flow (Project Drawings landing → pick a project → pick a building → drawings/documents for that building):
- `GET /drawings` — **NEW.** Cross-project landing page: `{ leadId, projectName, jobId, location, numberOfBuildings, totalDrawings, lastUpdate }[]`.
- `GET /projects/:leadId/buildings` — **NEW.** Per-building counts for one project: `{ buildingLabel, totalDrawings, totalDocuments, lastUpdate }[]`. Building list = `numberOfBuildings`-derived labels ("Building A", "Building B", …) **union** with any building label that actually has uploaded docs (so it doesn't silently drop buildings beyond the stored count).
- `GET /projects/:leadId/buildings/:buildingLabel` — Returns `{ project, drawings: [...], documents: [...] }` split by `category` (`drawing`/`photo` vs `document`) — matches the two separate sections on the building detail screen (Drawings vs Documents/Agreement/Contract/Invoice). **Third pass:** added the `project` header object (was missing).
- `GET /projects/:leadId/drawings` — flat list, still there, unchanged. *(existing)*
- Approve / request-revision still work by `docId` exactly as before. *(existing)*

**Note for whoever uploads drawings (admin/construction panel):** `POST /admin/construction/drawings/:leadId` now accepts optional `buildingLabel` and `category` (`drawing|photo|document`) in the body. Anything uploaded without them defaults to `buildingLabel: 'Building A'`, `category: 'drawing'`.

**Mock data for testing:** `customer1@example.com`'s 3 projects (PRO-001, PRO-002, PRO-011) were seeded with `numberOfBuildings: 4` and, for each building, 6 drawings (mixed `approved`/`pending`/`under_review` status) + 3 documents (Agreement/Contract/Invoice) — via `scripts/seedCustomerDrawingsMock.js` (idempotent, safe to re-run, skips a project once it already has ≥20 drawing docs). Verified live: landing page shows all 3 projects with `numberOfBuildings: 4` and `totalDrawings` in the 24–29 range; each building shows 6 drawings + 3 documents; building detail correctly splits `drawings[]` vs `documents[]` with populated `uploadedBy`.

**Bundle Scan / Notifications / Chat / Tracking mock data:** `scripts/seedCustomerMiscMock.js` (idempotent) — 2 scannable bundles per project (`PRO-00X-BND-001/002`), 4 notifications per project across every filter type (drawing/payment/meeting/system), 6 chat messages per project spread across all 3 department channels, and (added in the latest run) 3 tasks + 3 milestones per project for the Project Tracking tab. This closed a real gap: the bundle I used to verify the Bundle Scan endpoints earlier was a throwaway test record I deleted afterward, so nothing persisted for actual testing — now fixed.

**Order/Quotation mock data:** same 3 projects also seeded with `scripts/seedCustomerOrdersMock.js` (idempotent, skips a project once it has ≥4 active orders) — 3 orders per project spanning the full stepper: one `new_order` (no quotation), one `quotation_received` (quotation sent, awaiting response), one `completed` (quotation approved, both line items delivered against a real `Delivery` record where one exists for that project). Verified live: `material-orders/summary` and `quotations/summary` return correctly varied counts per project (not identical placeholder numbers), and the completed order's detail correctly returns 2 `deliveredItems` with `deliveryReference`/`deliveryStatus` populated and 0 `pendingItems`.

## 3. Dashboard
`GET /dashboard` extended in place:
- `projectTimeline` — now a real number (days to the next incomplete project milestone), was always `null`.
- `shipmentBreakdown.totalBundles` — now a real count, was always `null`.
- `ordersList`, `notificationsFeed`, `recentMessages` — last 5 of each, new arrays.
- Everything else (`activeProjects`, `deliveryTracking`, `nextDelivery`, financials) unchanged.

## 4. Communication (chat) — new
Channels are fixed: `project | finance | construction`.
- `GET /chat/channels?leadId=`
- `GET /chat/:channel/messages?leadId=&page=&limit=`
- `POST /chat/:channel/messages` — body `{ leadId, content }`
- Department channels only — no 1:1 "Direct" messages yet (Figma has a Direct tab).

## 5. Notifications — new
- `GET /notifications?filter=all|unread|drawings|finance|meetings`
- `PUT /notifications/:id/read`
- `PUT /notifications/read-all`
- Nothing else in the system writes into this collection automatically yet for customers — feed will be empty until that's wired up.

## 6. My Delivery Schedule — additions for the "Delivery Rescheduled" banner + list-row status

Every delivery row (list *and* detail — `mapDeliveryRow` is shared) now also includes:
```json
{
  "siteReadiness": { "siteReady": true, "equipmentReady": false },
  "confirmationEmailSent": true, "confirmationEmailSentAt": "2026-07-22T10:43:18.590Z",
  "reschedule": {
    "_id": "...", "previousDate": "2026-08-10T00:00:00.000Z", "date": "2026-08-11T00:00:00.000Z",
    "reason": "Weather", "acknowledged": false, "acknowledgedAt": null
  }
}
```
`siteReadiness` mirrors the existing `confirm-site-ready`/`confirm-equipment` flags (now surfaced in the list, not just after opening detail). `reschedule` is the most recent `rescheduleHistory` entry, or `null` if the delivery was never rescheduled — powers the "Delivery Rescheduled: Previous Date X, New Date Y, Reason Z" banner.

- `POST /deliveries/:deliveryId/acknowledge-reschedule` — **new.** Acknowledges the latest reschedule. Blocked (400) if already acknowledged or if there's no reschedule history at all.

**Real bug fixed along the way:** `DELIVERY_STATUSES` (the enum backing `Delivery.status`) never actually included `'rescheduled'`, even though the dashboard's `rescheduledDeliveries` counter, the tab filters, and the plant-panel reschedule flow all already referenced that status string. It silently "worked" only because those existing writes used `updateOne`/`findByIdAndUpdate` (which skip schema validation by default) — the moment my acknowledge endpoint did a full `.save()` on the same document, it threw a validation error. Added `'rescheduled'` to the enum in `src/config/constants.js`.

Also added `previousDate` to `rescheduleHistory` entries (the plant-panel `PATCH /plant/deliveries/:deliveryId/reschedule` endpoint didn't persist what the date *was* before the change — only the new one — so there was no way to show "Previous Date: March 28" at all before this). — third pass: fixed to match `/projects/:leadId/buildings` & `/orders` pattern
**This was the reported mismatch — fixed:**
- `GET /deliveries?tab=upcoming` — unscoped, **all** projects. Kept as-is for back-compat.
- `GET /deliveries/summary` — **NEW.** Per-project `{ leadId, projectName, jobId, location, upcoming, past, rescheduled }[]` — same shape/pattern as `material-orders/summary` and `quotations/summary`.
- `GET /deliveries/:id?tab=upcoming` — **CHANGED.** This single path now smart-dispatches on what `id` resolves to:
  - If `id` is a **leadId** you own → returns that project's delivery schedule, with a `project` header object added to the response (same pattern as buildings/orders/order-quotations).
  - If `id` is a **deliveryId** → falls through to the existing single-delivery-detail response (unchanged shape) — so nothing that already calls this path with a delivery id breaks.
  - This was necessary because `/deliveries/:deliveryId` already existed for single-delivery detail — Express can't register two different handlers on the identical one-segment path pattern, so rather than break existing delivery-detail consumers, the endpoint inspects which kind of id it got. Tested live both ways: a leadId returns `{ project, deliveries, total, tabs }`, a deliveryId returns `{ delivery }`.
- `GET /deliveries/:deliveryId/documents` — links for the "Delivery Documents / Download All" dialog (3 PDF links, not a zip).
- `POST /deliveries/:deliveryId/confirm-site-ready` — body: 4 booleans + `confirmedBy`.
- `POST /deliveries/:deliveryId/confirm-equipment` — body: 4 booleans.

## 7. Bundle Scan (QR) — new
Powers the "Scan QR Code / Enter Bundle ID" flow off the Delivery Schedule screen.
- `POST /bundles/scan` — body `{ bundleId }` (accepts either the Mongo `_id` or the human `bundleNo` like `B-001`, same lookup as the QR value). Returns bundle info + a best-effort `deliveryReference` (destination/status) resolved from the most recent active delivery on that project — bundles aren't directly linked to a delivery record in the data model, so this is a nearest-match, not a hard foreign key.
- `GET /bundles/:bundleId`
- `POST /bundles/:bundleId/report-issue` — body `{ issue }`, powers "Report Issue".
- `POST /bundles/:bundleId/contact-support` — body `{ message }`, emails the project's assigned sales rep.
- `GET /bundles/:bundleId/download` — bundle-contents PDF.
- `GET /bundles/:bundleId/download/packing-list` — packing-list PDF for that bundle's truck load (all sibling bundles on the same packing list).
- Ownership is enforced: only bundles belonging to a lead the logged-in customer owns are scannable.

## 8. Material Orders
- `GET /material-orders/summary` — per-project `{ newOrders, pending, completed }` counts. **Fixed in the third pass:** these now come from the same `stage` logic as the Order Details stepper (below), not a raw/arbitrary "created in last 7 days" heuristic — so the list-screen tiles and the detail-screen stepper always agree.
- `GET /projects/:leadId/orders` — list + `counts` (same stage-based breakdown). Now includes a `project` header object.
- `POST /projects/:leadId/orders` — "Add New Order" form:
  ```json
  {
    "buildingLabel": "Building A",
    "requiredBy": "2026-08-15",
    "preferredDeliveryDate": "2026-08-10",
    "priority": "high",
    "specialInstructions": "...",
    "attachments": [{ "name": "PO.pdf", "url": "https://..." }],
    "items": [{ "name": "Black 26ga", "quantity": 30, "unit": "ft", "lengthFeet": 24, "color": "Black" }]
  }
  ```
- `GET /projects/:leadId/orders/:orderId` — includes `order.stage`, `order.createdByName`, and the linked `quotation` (if any). **New in the third pass:** `order.deliveredItems` / `order.pendingItems` — the requested coil line items split by delivery status, powering the "Delivered / Pending" tabs + table (Coil Type/Length/Quantity/Color/Delivery ID/Status/Delivery Date) on the Order Details screen. Each item now carries `deliveryStatus`, `deliveryId`, `deliveryReference`, `deliveredAt`.
- `POST /projects/:leadId/orders/:orderId/cancel` — powers "Cancel Order". Blocked once `fulfilled` or already `cancelled`.

### Order Details status stepper
The Figma "Order Details" screen shows: **New Order → Quotation Receive → Quotation Approve → Order Confirmed → Completed**, plus Cancel. `order.stage` is computed server-side from the order + its latest linked quotation:
| stage | meaning |
|---|---|
| `new_order` | order placed, no quotation sent yet |
| `quotation_received` | a quotation exists, awaiting customer response |
| `quotation_approved` | (transitional — rare to observe) |
| `order_confirmed` | customer approved the quotation |
| `completed` | order marked `fulfilled` |
| `cancelled` / `rejected` | terminal states |

No building collection exists — `buildingLabel` stays free text, same as before.

### Marking items delivered (staff-side, not customer-facing, but relevant to how the tabs fill in)
`POST /api/construction/material-requests/:requestId/items/:itemId/deliver` (construction-panel auth) — body `{ deliveryId?, deliveryReference? }`. Marks one line item delivered; **once every item on the order is delivered, the order auto-flips to `fulfilled`** (`stage` → `completed`). Tested live: partial delivery keeps the order `pending`/`quotation_received` with a mixed deliveredItems/pendingItems split, and delivering the last item auto-completes it.

## 9. Order Quotations (rebuilt on the correct model)
Backed by the new `OrderQuotation` model (coil-line items), linked to a `MaterialRequest` order.
- `GET /quotations/summary` — per-project `{ newQuotation, pendingApproval, approved }` counts, for the top-level "Order Quotations" project list.
- `GET /projects/:leadId/order-quotations` — Powers the per-project "All Quotations" table (`Order ID | Quotation ID | Building | Order Date | Quotation Received | Order Value | Status`). Filters: `buildingLabel, status, dateFrom, dateTo`. Now includes a `project` header object.
- `GET /order-quotations/:quotationId` — **new.** Full detail: line items (coilType/lengthFeet/quantity/color/unitPrice/amount), `subtotal/tax/freight/totalValue`, seller info, plus a computed `summary { totalCoilTypes, totalLength, totalQuantity }`.
- `POST /order-quotations/:quotationId/approve` — flips the quotation to `approved` **and** the linked order to `approved` (drives `order.stage` → `order_confirmed`). Returns the exact success message the Figma modal shows: *"Quotation Approved — Submitted Successfully"*.
- `POST /order-quotations/:quotationId/reject` — body `{ reason }`.

**How a quotation gets created** (not a customer action — staff-side, so this doesn't ship with your build, but you should know the pipeline exists and is testable): `POST /api/construction/material-requests/:requestId/quotations` (construction-panel auth) — takes `lineItems[]`, `tax`, `freight`, seller info, computes `subtotal`/`totalValue`, and emails nothing yet (frontend for that side is out of scope here, just flagging that the pipe is wired end-to-end and tested).

---

## Full test trace (already run against the live dev DB before handoff)
Customer creates order → construction staff sends a quotation → customer sees it in the per-project quotations table and in `quotations/summary` → customer approves → order stage flips to `order_confirmed`. Also verified: cancel-order (and double-cancel correctly rejected), building-level drawing upload + retrieval (including the "building beyond stored `numberOfBuildings` count" edge case, which was a real bug caught and fixed), full bundle-scan flow (scan by id and by bundleNo, detail, report-issue, both PDFs), site-ready/equipment confirmation, chat send/receive, notifications stats/read.

## Things to flag back to us
1. Notifications feed has no automatic writer yet — empty until something else creates entries.
2. Chat is department-only, no 1:1 "Direct" messages.
3. Delivery Documents "Download All" returns 3 links, not a single zip.
4. Bundle → Delivery linkage in `deliveryReference` is a best-effort "most recent active delivery on this project," not a hard foreign key — the data model doesn't store which delivery a bundle rode on.
5. Postman collections updated: `customer-portal.postman_collection.json` (new folders: 📦 Material Orders, 🧾 Order Quotations, 🔔 Notifications, 💬 Communication, 📱 Bundle Scan (QR), plus additions to 🖼️ Project Drawings and 🚚 Delivery Schedule) and `construction-panel.postman_collection.json` (new "Send Order Quotation to Customer" request). Every new request in both was hit against the live dev DB.
