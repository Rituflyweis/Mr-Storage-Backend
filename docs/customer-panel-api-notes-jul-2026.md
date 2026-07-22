# Customer Panel — API Notes for Frontend

Base URL: `{{baseUrl}}/api/customer` (Postman: `customer-portal.postman_collection.json`, updated)
Auth: `Authorization: Bearer <customerToken>` on every route except `/auth/*`.

> This covers two passes over the Figma Customer Panel screens. The second pass found two real gaps worth flagging up front:
> 1. **Drawings had no per-building grouping at all** — the model only stored one flat list per project. Added `buildingLabel` + `category` and three new endpoints.
> 2. **"Order Quotations" was pointed at the wrong model in the first pass.** The existing `Quotation` model is the whole-building RFQ/steel-building quote (used on the Project Overview "RFQ" tab) — totally different from the Figma "Order Quotations" screens, which show coil type/length/qty/color/unit-price line items tied to a Material Order. That had **no backing model at all**. Built a new `OrderQuotation` model + full endpoint set for it. `GET /quotations/summary` now reads from `OrderQuotation`, not `Quotation`.

---

## 1. Project Overview
- `GET /projects/:leadId` — header info. *(existing)*
- `GET /projects/:leadId/stats` — 5-step progress stepper. *(existing)*
- `POST /projects/:leadId/cancel` — body `{ reason }`. *(existing)*
- `GET /projects/:leadId/orders` — orders list for this project.

## 2. Drawings & Images (rebuilt with building-level grouping)
Three-level hierarchy now, matching the Figma flow (Project Drawings landing → pick a project → pick a building → drawings/documents for that building):
- `GET /drawings` — **NEW.** Cross-project landing page: `{ leadId, projectName, jobId, location, numberOfBuildings, totalDrawings, lastUpdate }[]`.
- `GET /projects/:leadId/buildings` — **NEW.** Per-building counts for one project: `{ buildingLabel, totalDrawings, totalDocuments, lastUpdate }[]`. Building list = `numberOfBuildings`-derived labels ("Building A", "Building B", …) **union** with any building label that actually has uploaded docs (so it doesn't silently drop buildings beyond the stored count).
- `GET /projects/:leadId/buildings/:buildingLabel` — **NEW.** Returns `{ drawings: [...], documents: [...] }` split by `category` (`drawing`/`photo` vs `document`) — matches the two separate sections on the building detail screen (Drawings vs Documents/Agreement/Contract/Invoice).
- `GET /projects/:leadId/drawings` — flat list, still there, unchanged. *(existing)*
- Approve / request-revision still work by `docId` exactly as before. *(existing)*

**Note for whoever uploads drawings (admin/construction panel):** `POST /admin/construction/drawings/:leadId` now accepts optional `buildingLabel` and `category` (`drawing|photo|document`) in the body. Anything uploaded without them defaults to `buildingLabel: 'Building A'`, `category: 'drawing'`.

**Mock data for testing:** `customer1@example.com`'s 3 projects (PRO-001, PRO-002, PRO-011) were seeded with `numberOfBuildings: 4` and, for each building, 6 drawings (mixed `approved`/`pending`/`under_review` status) + 3 documents (Agreement/Contract/Invoice) — via `scripts/seedCustomerDrawingsMock.js` (idempotent, safe to re-run, skips a project once it already has ≥20 drawing docs). Verified live: landing page shows all 3 projects with `numberOfBuildings: 4` and `totalDrawings` in the 24–29 range; each building shows 6 drawings + 3 documents; building detail correctly splits `drawings[]` vs `documents[]` with populated `uploadedBy`.

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

## 6. My Delivery Schedule
Existing large set (Contact Driver/Company, Email Confirmation, Add to Calendar, Request Callback, individual PDFs) unchanged. Added:
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
- `GET /projects/:leadId/orders` — list + `counts` (same stage-based breakdown).
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
- `GET /projects/:leadId/order-quotations` — **new.** Powers the per-project "All Quotations" table (`Order ID | Quotation ID | Building | Order Date | Quotation Received | Order Value | Status`). Filters: `buildingLabel, status, dateFrom, dateTo`.
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
