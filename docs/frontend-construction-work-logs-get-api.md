# Construction panel — Daily work logs (GET APIs)

**Base URL:** `https://mr-storage-backend-025k.onrender.com/api/construction`  
**Auth:** `Authorization: Bearer <token>`  
**Roles:** `construction` | `admin`

Work logs are **daily site diary** entries (date, description, photos, optional link to a task). They do **not** auto-update task status. For the task board, use **tasks** → [`frontend-construction-tasks-get-api.md`](./frontend-construction-tasks-get-api.md).

---

## 1. List work logs

```http
GET /api/construction/work-logs
```

### Query parameters

| Param | Required | Description |
|-------|----------|-------------|
| `leadId` | No | Filter by project Mongo `_id` (use on project detail) |
| `page` | No | Default `1` |
| `limit` | No | Default `20` |

There is **no** `search`, `status`, or date-range filter on this GET endpoint today.

### Example request

```http
GET https://mr-storage-backend-025k.onrender.com/api/construction/work-logs?leadId=68f1a2b3c4d5e6f7a8b9c0d1&page=1&limit=20
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
          "name": "Jane Doe",
          "email": "jane@example.com"
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
    "total": 5
  }
}
```

### Field notes

| Field | Notes |
|-------|--------|
| `taskId` | Populated with `{ _id, title }` when linked; may be **`null`** if log is not tied to a task |
| `progress` | `0–100` on the **log only**; does not change linked task status |
| `photos` | Array of HTTPS URLs (upload via `/api/upload/presigned-url` first) |
| Sort | **`date` descending** (newest log date first) |

---

## 2. Create work log (reference)

```http
POST /api/construction/work-logs
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
| `leadId` | **Yes** |
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
    "workLog": {
      "_id": "68f3b1c2d3e4f5a6b7c8d9e0",
      "leadId": "68f1a2b3c4d5e6f7a8b9c0d1",
      "taskId": "68f2a1b2c3d4e5f6a7b8c9d0",
      "loggedBy": "68e79dc9e3d92b7f3e1df429",
      "date": "2026-05-19T00:00:00.000Z",
      "progress": 63,
      "description": "Completed foundation excavation according to plan",
      "photos": ["https://…/photo.jpg"],
      "issues": "Minor delay due to rain"
    }
  }
}
```

---

## Errors

| HTTP | When |
|------|------|
| `400` | POST missing `leadId` or `date` |
| `401` | Missing or invalid token |
| `403` | Role not `construction` or `admin` |
| `404` | POST with invalid `leadId` |

---

## Tasks vs work logs

| | **GET /tasks** | **GET /work-logs** |
|--|----------------|-------------------|
| Purpose | Task board / assignments | Daily work history |
| Filters | `leadId`, status, priority, search, dates | `leadId`, pagination only |
| Extra data | Inline `stats` | — |
