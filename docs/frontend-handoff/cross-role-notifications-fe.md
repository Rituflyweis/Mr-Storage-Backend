# Cross-role in-app notifications (staff + customer portal)

Persisted notifications: **`GET /api/notifications`** (staff) / customer portal notification routes.  
Realtime: Socket.IO **`/admin`**, events **`notification`** / **`new_notification`**, room **`user:{userId}`**.

After deploy, **re-trigger the action** — history is not backfilled.

Helpers: `src/utils/staffRequestNotifications.util.js`, `src/utils/materialRequestNotifications.util.js`.

## Panel routing matrix

| Scenario | Notified | API `type` |
|----------|----------|------------|
| Sales / system **invoice** → admin approval | All **admin** | `invoice` |
| Admin **invoice** approve/reject | Submitting **sales** | `invoice` |
| Sales **quotation** → admin approval | All **admin** | `quotation` |
| Admin **quotation** approve/reject | Submitting **sales** | `quotation` |
| Admin **payment approval** created | All **account** | `payment` |
| Account/admin **payment approval** review | **Requester** | `payment` |
| Freight cost → **payment approval** auto-created | All **account** | `payment` |
| **Vendor/freight payable** submitted (admin manual, vendor upload link, account misc pending) | All **admin** | `payment` |
| Admin **payable** approved for payment | All **account** | `payment` |
| Admin **payable** rejected | **Creator** (`createdBy`) | `payment` |
| Customer **payment proof** uploaded | **admin**, **account**, lead **sales** | `payment` |
| Payment proof verified/rejected | **Customer** | `payment` |
| Sales **escalates** lead | All **admin** | `escalation` |
| Admin resolves/assigns **escalation** | **Sales** (raiser / assignee) | `escalation` |
| Sales raises **PO order** | All **admin** | `system` |
| Admin **PO** approved/rejected | **Sales** who raised PO | `system` |
| Admin **assigns lead** (manual) | Assigned **sales** | `lead` |
| Round-robin **auto-assign** lead | Assigned **sales** | `lead` |
| **Material request** (construction/admin) | All **plant** | `material_request` |
| **Customer material order** | **admin**, **sales** (owner), **plant** | `material_request` |
| Material request **approved/rejected/fulfilled** | **Requester** (staff or customer) | `material_request` |
| Plant **drawing** uploaded (pending review) | All **admin** | `drawing` |
| Drawing **approved/rejected** (plant/admin review) | **Uploader** (plant/construction) | `drawing` |
| Customer drawing approve/revision | **Sales** + assigned **plant** (existing) | `drawing` |
| **Shipper file** / all shippers in (vendor portal) | Assigned **plant** users on project | `material_request` |
| **Freight bid** submitted / all bids in (carrier portal) | Assigned **plant** users | `freight_bid` |
| **Tax mapping** → `PENDING` | All **admin** | `system` |
| **New inbound lead** | All **admin** | `lead` |
| **Chat** / customer direct message | **Sales** + **admin** | `chat` |
| **PO released** to plant user | That **plant** user | `system` |
| **Task** assigned/reassigned (construction) | Assignee | `task` |
| **Meeting** invite (admin) | Invitees | `meeting` |
| Delivery milestone (customer-facing) | **Customer** | `delivery` |

## FE checklist

- [ ] List uses `GET /api/notifications`, not socket-only.
- [ ] Filter chips match `type` enum on `Notification` model.
- [ ] Deep link: `refModel` + `refId` + optional `leadId`.
