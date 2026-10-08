# Admin panel — Construction daily work logs (GET APIs)

**Base URL:** `https://mr-storage-backend-025k.onrender.com/api/admin/construction`  
**Auth:** `Authorization: Bearer <admin-token>`  
**Role:** `admin` only

Same **WorkLog** collection as the construction app. Admin uses **`projectId`** for the project filter and supports **date range** on log `date`.

Tasks (admin): [`frontend-admin-construction-tasks-get-api.md`](./frontend-admin-construction-tasks-get-api.md)  
Construction app work logs: [`frontend-construction-work-logs-get-api.md`](./frontend-construction-work-logs-get-api.md)

---

## 1. List work logs

```http
GET /api/admin/construction/work-logs
```

### Query parameters

| Param | Required | Description |
|-------|----------|-------------|
| `projectId` | No | Project Mongo `_id` (maps to `leadId` in DB) |
| `startDate` | No | Log **date** ≥ start (ISO) |
| `endDate` | No | Log **date** ≤ end (ISO) |
| `page` | No | Default `1` |
| `limit` | No | Default `20` |

There is **no** `search` or `status` filter on this GET endpoint.

### Example request

```http
GET https://mr-storage-backend-025k.onrender.com/api/admin/construction/work-logs?projectId=68f1a2b3c4d5e6f7a8b9c0d1&startDate=2026-05-01&endDate=2026-05-31&page=1&limit=20
Authorization: Bearer <token>
```

### Example response (`200`)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "logs": [
      {
        "_id": "68f3b1c2d3e4f5a6b7c8d9e0",
        "leadId": {
          "_id": "68f1a2b3c4d5e6f7a8b9c0d1",
          "projectName": "Storage Namra",
          "jobId": "2026001"
        },
        "taskId": {
          "_id": "68f2a1b2c3d4e5f6a7b8c9d0",
          "title": "Install wall panels"
        },
        "loggedBy": {
          "_id": "68e79dc9e3d92b7f3e1df429",
          "name": "Jane Doe"
        },
        "date": "2026-05-19T00:00:00.000Z",
        "progress": 63,
        "description": "Completed foundation excavation according to plan",
        "photos": [
          "https://your-bucket.s3.amazonaws.com/documents/site-photo.jpg"
        ],
        "issues": "Minor delay due to rain",
        "createdAt": "2026-05-19T16:00:00.000Z",
        "updatedAt": "2026-05-19T16:00:00.000Z"
      }
    ],
    "total": 5,
    "page": 1,
    "limit": 20
  }
}
```

### Field notes

| Field | Notes |
|-------|--------|
| `projectId` query | Same value as `leadId` on construction routes |
| `taskId` | Populated `{ _id, title }` or null |
| `loggedBy` | Admin list populates **`name` only** (construction also returns `email`) |
| Sort | **`date` descending** |

---

## 2. Create work log (reference)

```http
POST /api/admin/construction/work-logs
Content-Type: application/json
Authorization: Bearer <token>
```

### Request body

```json
{
  "leadId": "68f1a2b3c4d5e6f7a8b9c0d1",
  "date": "2026-05-19",
  "taskId": "68f2a1b2c3d4e5f6a7b8c9d0",
  "progress": 63,
  "description": "Completed foundation excavation according to plan",
  "photos": ["https://…/photo.jpg"],
  "issues": "Minor delay due to rain"
}
```

| Field | Required |
|-------|----------|
| `leadId` | **Yes** (POST uses `leadId`, not `projectId`) |
| `date` | **Yes** |
| `taskId` | No |
| `progress` | No (default `0`) |
| `description` | No |
| `photos` | No |
| `issues` | No |

### Example response (`201`)

```json
{
  "success": true,
  "message": "Work log created",
  "data": {
    "log": {
      "_id": "68f3b1c2d3e4f5a6b7c8d9e0",
      "leadId": "68f1a2b3c4d5e6f7a8b9c0d1",
      "taskId": "68f2a1b2c3d4e5f6a7b8c9d0",
      "loggedBy": "68e79dc9e3d92b7f3e1df429",
      "date": "2026-05-19T00:00:00.000Z",
      "progress": 63,
      "description": "Completed foundation excavation according to plan",
      "photos": [],
      "issues": "Minor delay due to rain"
    }
  }
}
```

Note: POST response key is **`log`** on admin vs **`workLog`** on construction — same document shape.

---

## Admin vs construction

| | **Admin GET** | **Construction GET** |
|--|---------------|----------------------|
| Path | `/api/admin/construction/work-logs` | `/api/construction/work-logs` |
| Project filter | `projectId` | `leadId` |
| Date range | `startDate`, `endDate` | Not supported |
| Pagination | `page`, `limit` + `total` | `page`, `limit` + `total` |
| `loggedBy` | `name` | `name`, `email` |

---

## Errors

| HTTP | When |
|------|------|
| `400` | POST validation failed |
| `401` | Missing or invalid token |
| `403` | Not `admin` role |
| `404` | POST with invalid `leadId` |
