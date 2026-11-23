# Zoom online meetings — frontend integration handoff

**Date:** 23 Nov 2026  
**Status:** Backend Zoom (Server-to-Server OAuth) is configured and tested.  
**Panels:** Admin, Sales, Customer portal  

**Share this file with frontend.** No Zoom API keys, OAuth, or Marketplace setup on the client — only these REST APIs.

---

## 1. Product behavior (summary)

| Mode | `meetingLink` on create | Backend behavior |
|------|-------------------------|------------------|
| `online` | Omitted or empty | Backend creates a Zoom meeting; response includes `meetingLink` (join URL) |
| `online` | Non-empty string | Link stored as-is; Zoom is **not** called |
| `offline` (or `in-person` → normalized to `offline`) | Any | No Zoom; optional manual link in `meetingLink` if you have one |

Staff UIs should **not require** typing a Zoom URL for online meetings. Leave `meetingLink` out (or send `""`) and show the link returned from the API.

---

## 2. Meeting fields (API model)

| Field | Type | Notes |
|-------|------|--------|
| `mode` | `"online"` \| `"offline"` | Request may send `"in-person"`; API stores `"offline"` |
| `meetingLink` | string | Public join URL; customers use this |
| `zoomStartUrl` | string | **Host start URL — staff only** |
| `zoomMeetingId` | string | Internal; optional in UI |
| `status` | `scheduled` \| `completed` \| `cancelled` \| `rescheduled` | Default `scheduled` |
| `duration` | number (minutes) | Optional; Zoom uses 15–1440 when creating; default 30 if omitted |
| `meetingTime` | ISO 8601 | Required on create |
| `title` | string | Required on create |
| `customerId` | MongoId | Required on create |
| `leadId` | MongoId | Optional (Sales); tie to project when set |
| `reminderMinutes` | int 0–10080 | Optional; default 30 |
| `reminderSms` | boolean | Optional; default true |
| `reminderEmail` | boolean | Optional; default true |
| `notes` | string | Optional |

---

## 3. Who sees what

| Field | Admin / Sales | Customer portal |
|-------|---------------|-----------------|
| `meetingLink` | Show + copy | Show + copy when joinable (see §7) |
| `zoomStartUrl` | Show as **“Start meeting (host)”** | **Never** — field omitted from portal API |
| `zoomMeetingId` | Optional debug/detail | Not needed |

---

## 4. Auth & base paths

| Panel | Base path | Auth |
|-------|-----------|------|
| Admin | `/api/admin/meetings` | Bearer JWT (`admin`) |
| Sales | `/api/sales/meetings` | Bearer JWT (`sales`) |
| Customer portal | `/api/customer-portal/projects/:leadId/meetings` | Customer portal auth (existing pattern) |

Standard envelopes: `{ success, message?, data }`.

---

## 5. Admin & Sales endpoints

### 5.1 List meetings

`GET /api/admin/meetings` · `GET /api/sales/meetings`

| Query | Description |
|-------|-------------|
| `status` | Optional: `scheduled`, `completed`, `cancelled`, `rescheduled` |
| `search` | Optional; title substring |
| `leadId` | Optional; filter by project |

**Default list filter:** excludes `completed` and `cancelled` unless `status` is set.

**200** — `data.meetings[]` includes full staff fields (`zoomStartUrl`, `zoomMeetingId`, etc.).

Admin only: `GET /api/admin/meetings/:meetingId` — single meeting.

### 5.2 Create meeting

`POST /api/admin/meetings` · `POST /api/sales/meetings`

**Minimum body (auto Zoom for online):**

```json
{
  "customerId": "674a1b2c3d4e5f6789012345",
  "leadId": "674a1b2c3d4e5f6789012346",
  "title": "Design review",
  "meetingTime": "2026-11-22T15:00:00.000Z",
  "duration": 30,
  "mode": "online"
}
```

- **Do not** send `meetingLink` for auto-generated Zoom (or send `""`).
- **Sales:** `leadId` optional but recommended for project context.
- **Admin:** `customerId` required (validator); `leadId` optional in body.

**201** — `data.meeting` example:

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "meeting": {
      "_id": "...",
      "customerId": "...",
      "leadId": "...",
      "title": "Design review",
      "meetingTime": "2026-11-22T15:00:00.000Z",
      "duration": 30,
      "mode": "online",
      "status": "scheduled",
      "meetingLink": "https://us05web.zoom.us/j/88653476546?pwd=...",
      "zoomMeetingId": "88653476546",
      "zoomStartUrl": "https://us05web.zoom.us/s/...",
      "reminderMinutes": 30,
      "reminderSms": true,
      "reminderEmail": true,
      "notes": "",
      "createdBy": "...",
      "createdAt": "...",
      "updatedAt": "..."
    }
  }
}
```

### 5.3 Edit meeting

`PUT /api/admin/meetings/:meetingId` · `PUT /api/sales/meetings/:meetingId`

Send only fields that change. Relevant Zoom rules:

| Action | Backend |
|--------|---------|
| Change `title`, `meetingTime`, or `duration` on an online Zoom meeting | Updates the **same** Zoom meeting; **join link unchanged** |
| Change `mode` to `online` with no stored link | Creates Zoom and sets `meetingLink` |
| Set `status` to `cancelled` | Deletes Zoom meeting server-side |
| Send `meetingLink: ""` | Does **not** clear an existing saved link |
| Send `meetingLink` with a non-empty URL | Overrides / stores manual link (no new Zoom create if link already exists) |

**200** — `data.meeting` (updated document).

### 5.4 Complete meeting

`PUT /api/admin/meetings/:meetingId/complete` · `PUT /api/sales/meetings/:meetingId/complete`

Marks `status: completed`, sets `completedAt`. Does not delete Zoom (cancel flow does).

---

## 6. Errors (Zoom / config)

If Zoom is down, misconfigured, or rejects the request, **create** and **edit** return **400** and **do not** persist a broken online meeting on create:

```json
{ "success": false, "message": "Zoom is not configured. Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET." }
```

Other examples: invalid host user, missing scopes, Zoom rate limits — message is Zoom’s text in `message`.

**UI:** Show `message` in a toast or inline error; keep the form open; do not show a fake join link.

---

## 7. Customer portal

`GET /api/customer-portal/projects/:leadId/meetings`

| Query | Description |
|-------|-------------|
| `status` | Optional filter |
| `page`, `limit` | Pagination (default `page=1`, `limit=20`) |

**200** — `data.meetings`, `data.total`, `data.page`, `data.limit`, `data.stats` (`total`, `scheduled`, `completed`, `cancelled`).

Each meeting includes `meetingLink` and **excludes** `zoomStartUrl`.

**Show “Join meeting” only when:**

- `mode === "online"`
- `status === "scheduled"`
- `meetingLink` is non-empty

Do not show join for `cancelled` or `completed` even if `meetingLink` is still on the document.

---

## 8. Recommended UI flows

### Create / edit (Admin & Sales)

1. Mode toggle: **Online** | **Offline** (you may label offline “In person”).
2. If **Online**: hide “Meeting link” input **or** show as read-only after save; primary CTA is create/save, not paste URL.
3. After create success: show `meetingLink` with copy; show **Start as host** button opening `zoomStartUrl` in a new tab (staff only).
4. On edit reschedule: only send changed fields; link stays stable for customers already invited.

### Optional: manual link override

Advanced staff option: “Use my own link” → send `meetingLink` on create. Zoom auto-create is skipped.

### Cancel

Set `status: "cancelled"` via PUT. Hide join in UI; optionally show “Meeting cancelled”.

---

## 9. Frontend checklist

- [ ] Online create/update without `meetingLink` for default Zoom flow  
- [ ] Display `meetingLink` + copy (staff + customer)  
- [ ] Display `zoomStartUrl` only on Admin/Sales  
- [ ] Never render `zoomStartUrl` in customer portal (field not returned anyway)  
- [ ] Handle 400 Zoom errors without optimistic UI  
- [ ] Cancel hides join; completed hides join  
- [ ] `in-person` in forms maps to API `offline` / `in-person` (both accepted on write)

---

## 10. Out of scope for frontend

- Zoom Marketplace app, webhooks, or secret tokens  
- Server env: `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_HOST_USER` (ops/backend only)  
- Embedding Zoom SDK in the browser (not implemented; links only)

---

## 11. Quick test (Postman / dev)

1. `POST /api/sales/meetings` with JWT, body from §5.2, `mode: "online"`, no `meetingLink`.  
2. Expect **201** and `meetingLink` starting with `https://` and containing `/j/`.  
3. `GET` customer portal meetings for same `leadId` — same `meetingLink`, no `zoomStartUrl`.

---

**Questions:** Backend / Zoom ops — not FE. For API shape changes, see this repo’s `src/controllers/admin/meeting.controller.js` and `src/controllers/sales/meeting.controller.js`.