# Follow-Up Insights APIs - Frontend Contract Plan (2026-09-02)

This document defines the planned API contracts for the new role-aware follow-up insights module.

Frontend can start UI integration against these request/response shapes while backend implementation is in progress.

## Goals

- Single API for follow-up activity listing for both admin and sales.
- Default view shows manual follow-ups.
- Query switch for automatic follow-ups without a separate API.
- Date-range totals for lead count + follow-up count + status buckets.
- Summary tiles for lead temperature transitions (hot/warm/cold movement).

---

## Auth and Roles

- All endpoints below are protected.
- Allowed roles: `admin`, `sales`.
- Scope rules:
  - `admin`: full visibility.
  - `sales`: only own/owned-lead scope.

---

## Enum Reference (Frontend)

Use these enums as fixed constants in UI/API clients.

- `role`: `admin | sales`
- `kind`: `manual | automatic`
- `view`: `summary | detail`
- `followUp.status` (stored): `pending | completed`
- `followUp.computedStatus` (read-time): `pending | completed | overdue`
- `followUp.modeOfContact`: `call | email | meeting | sms`
- `followUp.source`: `manual | warm_lead_auto | cold_lead_auto | chat_dropoff_auto | invoice_auto`
- `transition.temperature`: `hot | warm | cold`
- `transition.source`: `manual_override | ai_scoring | system`

Transition summary response always uses these keys:

- `hot_to_warm`
- `hot_to_cold`
- `warm_to_hot`
- `warm_to_cold`
- `cold_to_hot`
- `cold_to_warm`

---

## Endpoint 1: Unified Follow-Up Activity

`GET /api/followups/activity`

### Query Params

- `kind`: `manual | automatic` (default: `manual`)
- `view`: `summary | detail` (default: `summary`)
- `leadId`: required when `view=detail`
- `startDate`: ISO datetime/date (optional)
- `endDate`: ISO datetime/date (optional)
- `page`: number (default `1`)
- `limit`: number (default `20`, max `200`)
- `status`: optional filter (`pending | completed | overdue`)
- `modeOfContact`: optional filter (`call | email | meeting | sms`)

### Scope Behavior

#### `kind=manual`

- `admin`: all follow-ups where `source = manual`
- `sales`: follow-ups where any is true:
  - `createdBy == req.user._id`, or
  - `assignedTo == req.user._id`, or
  - `lead.assignedSales == req.user._id`

#### `kind=automatic`

- `admin`: all follow-ups where `source != manual`
- `sales`: follow-ups where:
  - `source != manual`, and
  - `lead.assignedSales == req.user._id`

Automatic sources:
- `warm_lead_auto`
- `cold_lead_auto`
- `chat_dropoff_auto`
- `invoice_auto`

---

## Response: `view=summary`

```json
{
  "success": true,
  "data": {
    "kind": "manual",
    "view": "summary",
    "filters": {
      "startDate": "2026-09-01T00:00:00.000Z",
      "endDate": "2026-09-30T23:59:59.999Z",
      "status": null,
      "modeOfContact": null
    },
    "totals": {
      "leadCount": 12,
      "followUpCount": 47,
      "pendingCount": 21,
      "completedCount": 20,
      "overdueCount": 6
    },
    "leads": [
      {
        "lead": {
          "_id": "66f1a9...",
          "jobId": "PRO-019",
          "projectName": "Paris Expansion",
          "lifecycleStatus": "proposal_sent",
          "assignedSales": {
            "_id": "66e0...",
            "name": "John Sales"
          },
          "leadScoring": {
            "temperature": "warm"
          }
        },
        "followUpCount": 6,
        "pendingCount": 3,
        "completedCount": 2,
        "overdueCount": 1,
        "lastFollowUpAt": "2026-09-27T15:00:00.000Z",
        "lastFollowUpStatus": "pending"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalLeads": 12
    }
  }
}
```

---

## Response: `view=detail`

```json
{
  "success": true,
  "data": {
    "kind": "automatic",
    "view": "detail",
    "lead": {
      "_id": "66f1a9...",
      "jobId": "PRO-019",
      "projectName": "Paris Expansion",
      "lifecycleStatus": "proposal_sent",
      "assignedSales": {
        "_id": "66e0...",
        "name": "John Sales"
      },
      "leadScoring": {
        "temperature": "warm"
      }
    },
    "totals": {
      "followUpCount": 9,
      "pendingCount": 4,
      "completedCount": 4,
      "overdueCount": 1
    },
    "history": [
      {
        "_id": "6701...",
        "followUpDate": "2026-09-26T14:30:00.000Z",
        "status": "pending",
        "computedStatus": "overdue",
        "modeOfContact": "sms",
        "source": "chat_dropoff_auto",
        "assignedTo": {
          "_id": "66e0...",
          "name": "John Sales"
        },
        "createdBy": null,
        "reminderMinutes": 30,
        "notifyCustomer": true,
        "sendSms": true,
        "sendEmail": true,
        "notes": "Auto nudge",
        "createdAt": "2026-09-26T14:00:00.000Z",
        "completedAt": null
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalHistory": 9
    }
  }
}
```

---

## Endpoint 2: Temperature Transition Summary Tiles

`GET /api/followups/temperature-transition-summary`

### Query Params

- `startDate` (optional)
- `endDate` (optional)

### Response

```json
{
  "success": true,
  "data": {
    "filters": {
      "startDate": "2026-09-01T00:00:00.000Z",
      "endDate": "2026-09-30T23:59:59.999Z"
    },
    "transitions": {
      "hot_to_warm": 5,
      "hot_to_cold": 2,
      "warm_to_hot": 7,
      "warm_to_cold": 3,
      "cold_to_hot": 4,
      "cold_to_warm": 8
    },
    "totals": {
      "totalTransitions": 29,
      "leadTouchedCount": 18
    },
    "bySource": {
      "manual_override": 6,
      "ai_scoring": 21,
      "system": 2
    }
  }
}
```

---

## Endpoint 3 (Optional): Transition Drilldown List

`GET /api/followups/temperature-transitions`

### Query Params

- `from`: `hot | warm | cold` (optional)
- `to`: `hot | warm | cold` (optional)
- `source`: `manual_override | ai_scoring | system` (optional)
- `startDate`, `endDate` (optional)
- `page`, `limit`

### Response

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "_id": "6710...",
        "leadId": "66f1a9...",
        "customerId": "66c2...",
        "fromTemperature": "hot",
        "toTemperature": "warm",
        "source": "ai_scoring",
        "changedBy": null,
        "changedAt": "2026-09-15T09:45:00.000Z",
        "metadata": {
          "scoreBefore": 72,
          "scoreAfter": 64,
          "reason": "AI re-score"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 42
    }
  }
}
```

---

## Planned Validation Rules

- `view=detail` requires valid `leadId`.
- `kind` enum: `manual | automatic`.
- `view` enum: `summary | detail`.
- `status` enum: `pending | completed | overdue`.
- `modeOfContact` enum: `call | email | meeting | sms`.
- `from/to/source` enums validated on transition drilldown API.
- Date filters support existing date range helper pattern used in current APIs.

---

## Error Contract

Standard existing shape:

```json
{
  "success": false,
  "message": "Readable error message"
}
```

Typical cases:
- invalid query enum -> `400`
- missing `leadId` for detail view -> `400`
- lead not visible in sales scope -> `403`
- lead not found -> `404`

---

## Backend Implementation Notes (for alignment)

- New model planned: `LeadTemperatureTransition`.
- Transition rows written only when `fromTemperature !== toTemperature`.
- Write points:
  - manual temperature update helper
  - AI scoring update path
  - any future system temperature update path

---

## Frontend UI Wiring Guidance

- Default load:
  - call `GET /api/followups/activity` (no query) for manual summary.
- Tab switch:
  - manual: `kind=manual`
  - automatic: `kind=automatic`
- Date filter:
  - pass `startDate`, `endDate`; use `totals` block for top counters.
- Detail panel:
  - call same endpoint with `view=detail&leadId=<id>&kind=<tab>`.
- Tiles:
  - call `GET /api/followups/temperature-transition-summary` with same date range.

---

## Final Planned Route Map

- `GET /api/followups/activity`
- `GET /api/followups/temperature-transition-summary`
- `GET /api/followups/temperature-transitions` (optional drilldown)

All under common admin/sales guard.
