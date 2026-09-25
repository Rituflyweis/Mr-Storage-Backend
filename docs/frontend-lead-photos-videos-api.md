# Photos & Videos API — Frontend guide

**Date:** 2026-09-25  
**Audience:** Frontend (Construction, Admin, Sales, Plant)  
**Auth (all routes):** `Authorization: Bearer <accessToken>`

Photos and videos live on `Lead.documents[]` with `type: "photo"` or `type: "video"`.  
They are **separate from drawings** — use the `/media` endpoints below for the “+ Upload Photos & Videos” flow.

**Does not break drawings:** existing `GET/POST /api/construction/drawings*` stay unchanged.

---

## Quick map (what to call for which UI)

| UI need | Method | Path |
|--------|--------|------|
| **Construction — list all projects + their photos/videos** | `GET` | `/api/construction/media` |
| **Any panel — one lead’s photos & videos** | `GET` | panel path below (§3) |
| **Upload photo/video** | `POST` | presign → S3 → panel `…/media/:leadId` (§1) |

---

## 1. Upload photo or video (all panels)

Same 3 steps everywhere. This is **not** CSV / lead import.

### Step A — Presigned URL

```http
POST /api/common/upload/presigned-url
Content-Type: application/json
```

```json
{
  "fileName": "site-photo.jpg",
  "fileType": "image/jpeg",
  "folder": "media"
}
```

Use `video/mp4` (etc.) for videos.  
Roles: `admin` | `sales` | `plant` | `construction`

**Response:**

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://…presigned…",
    "fileUrl": "https://bucket.s3.region.amazonaws.com/media/….jpg",
    "key": "media/…"
  }
}
```

### Step B — PUT file to S3

```http
PUT <uploadUrl>
Content-Type: <same as fileType>
Body: <raw file bytes>
```

### Step C — Attach to lead (pick your panel)

Body (required):

```json
{
  "url": "<fileUrl from step A>",
  "name": "site-photo.jpg",
  "type": "photo"
}
```

`type` must be `"photo"` or `"video"`.

| Panel | Upload |
|-------|--------|
| **Construction** (Drawings & Attachments → + Upload Photos & Videos) | `POST /api/construction/media/:leadId` |
| Admin | `POST /api/admin/leads/:leadId/media` |
| Sales | `POST /api/sales/leads/:leadId/media` |
| Plant | `POST /api/plant/projects/:leadId/media` |
| Admin plant | `POST /api/admin/plant/projects/:leadId/media` |

**Alternate (any upload role):**

```http
POST /api/common/upload/leads/:leadId/documents
```

```json
{ "url": "…", "name": "…", "type": "photo" }
```

(`type` optional here; omit → `general`. For media always send `photo` / `video`.)

**Success:**

```json
{
  "success": true,
  "message": "photo uploaded",
  "data": {
    "document": {
      "_id": "…",
      "url": "…",
      "name": "site-photo.jpg",
      "type": "photo",
      "uploadedBy": "…",
      "uploadedAt": "…",
      "approvalStatus": "pending"
    }
  }
}
```

---

## 2. Construction panel — list all projects + photos & videos

For **Project Drawings / Drawings & Attachments** when you need every project that has media (or filter to media only).

```http
GET /api/construction/media
```

**Roles:** `construction` | `admin`

| Query | Notes |
|-------|--------|
| `type` | optional `photo` \| `video` |
| `leadId` | optional filter one project |
| `search` | project name / jobId |
| `page` | default `1` |
| `limit` | default `20` |

**Response:**

```json
{
  "success": true,
  "data": {
    "projects": [
      {
        "leadId": "68f…",
        "projectId": "PEB-1021",
        "projectName": "ABC Logistics Warehouse",
        "location": { },
        "lastUpdate": "2025-04-25T…",
        "documents": [ /* photo + video, newest first */ ],
        "photos": [ /* type=photo only */ ],
        "videos": [ /* type=video only */ ],
        "photoCount": 2,
        "videoCount": 1
      }
    ],
    "total": 1
  }
}
```

Use `photos` / `videos` (or `documents`) under each project to render media tiles.  
Drawings list remains: `GET /api/construction/drawings` (unchanged).

---

## 3. One lead — get all photos & videos (shared by all panels)

Same handler / same response shape. Use the path for the logged-in panel.

| Panel | GET one lead’s media |
|-------|----------------------|
| Construction | `GET /api/construction/media/:leadId` |
| Admin | `GET /api/admin/leads/:leadId/media` |
| Sales | `GET /api/sales/leads/:leadId/media` |
| Plant | `GET /api/plant/projects/:leadId/media` |
| Admin plant | `GET /api/admin/plant/projects/:leadId/media` |

**Query:** `?type=photo` or `?type=video` (optional). Omit → both.

**Response (identical across panels):**

```json
{
  "success": true,
  "data": {
    "leadId": "68f…",
    "projectId": "PEB-1021",
    "projectName": "ABC Logistics Warehouse",
    "documents": [
      {
        "_id": "…",
        "url": "https://…",
        "name": "site-photo.jpg",
        "type": "photo",
        "uploadedAt": "…",
        "approvalStatus": "pending",
        "reviewedAt": null,
        "uploadedBy": { "_id": "…", "name": "…", "email": "…", "role": "…" }
      }
    ],
    "photos": [ /* same shape, photo only */ ],
    "videos": [ /* same shape, video only */ ],
    "total": 3,
    "photoCount": 2,
    "videoCount": 1
  }
}
```

**Access:**

- Admin / Construction — any lead  
- Sales — only assigned leads  
- Plant — only scoped plant projects  

---

## 4. Construction UI wiring (recommended)

**Page:** Drawings & Attachments → “+ Upload Photos & Videos”

1. User picks project (`leadId`) + files.  
2. For each file: Step A → B → C with  
   `POST /api/construction/media/:leadId`  
   and `type: "photo"` or `"video"` (from MIME / extension).  
3. Refresh media:  
   - All projects: `GET /api/construction/media`  
   - Or one project: `GET /api/construction/media/:leadId`  

Keep **drawings** on:

- List: `GET /api/construction/drawings`  
- One project: `GET /api/construction/drawings/:leadId`  
- Upload drawing: `POST /api/construction/drawings/:leadId` `{ url, name, type?: "drawing" }`  

Do **not** reuse lead-import / CSV copy for this modal.

---

## 5. Document `type` reference

| `type` | Purpose |
|--------|---------|
| `photo` | Images |
| `video` | Videos |
| `drawing` | Construction drawings (existing) |
| `approval` / `general` / `contract` / `other` | Existing, unchanged |

---

## 6. Cheat sheet

```text
# Upload (construction)
POST /api/common/upload/presigned-url
PUT  <uploadUrl>
POST /api/construction/media/:leadId   { url, name, type: "photo"|"video" }

# List all projects + media (construction)
GET  /api/construction/media

# One lead media (construction)
GET  /api/construction/media/:leadId

# One lead media (other panels — same response)
GET  /api/admin/leads/:leadId/media
GET  /api/sales/leads/:leadId/media
GET  /api/plant/projects/:leadId/media
GET  /api/admin/plant/projects/:leadId/media
```
