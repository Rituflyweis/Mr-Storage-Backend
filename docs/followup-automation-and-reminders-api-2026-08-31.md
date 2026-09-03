# Follow-Up Automation and Reminders API (2026-08-31)

## Enum Reference (Frontend)

Use these enums in frontend constants/dropdowns:

- `followUp.status` (stored): `pending | completed`
- `followUp.computedStatus` (frontend/read-time): `pending | completed | overdue`
- `followUp.modeOfContact`: `call | email | meeting | sms`
- `followUp.source`: `manual | warm_lead_auto | cold_lead_auto | chat_dropoff_auto | invoice_auto`
- `dispatchLog.kind`: `chat_dropoff | warm_lead | cold_lead | invoice_reminder | manual_followup | meeting_reminder`
- `dispatchLog.channel`: `sms | email`
- `dispatchLog.status`: `sent | failed | skipped`
- `calendar.kind`: `meeting | followup`
- `calendar.status`: `scheduled | completed | cancelled`
- `meeting.mode`: `online | offline`
- `meeting.status`: `scheduled | completed | cancelled | rescheduled`
- `lead.temperature`: `hot | warm | cold`

## What was added

- Global admin-configurable automation for:
  - Chat drop-off follow-ups
  - Cold lead follow-ups
  - Invoice approval/payment reminders
- Manual follow-up reminders now support:
  - Reminder timing (`reminderMinutes`)
  - Customer notification toggles (`notifyCustomer`, `sendSms`, `sendEmail`)
- Meeting reminders now support:
  - Reminder timing (`reminderMinutes`)
  - Channel toggles (`reminderSms`, `reminderEmail`)
- Delivery logs for outbound reminders (`FollowUpDispatchLog`)
- Automation config storage (`FollowUpAutomationConfig`)

## New Models

## `FollowUpAutomationConfig`

Singleton document (`key: "global"`):

- `chatDropOff.enabled`
- `chatDropOff.inactivityMinutes`
- `chatDropOff.maxAttempts`
- `chatDropOff.attemptIntervalsMinutes`
- `chatDropOff.requireNotQuoteReady`
- `chatDropOff.requireNotHandedToSales`
- `coldLead.enabled`
- `coldLead.intervalsDays`
- `coldLead.maxAttempts`
- `invoiceReminder.enabled`
- `invoiceReminder.intervalsHours`
- `invoiceReminder.maxAttempts`
- `manualReminder.defaultReminderMinutes`
- `manualReminder.sendDueNowReminder`
- `channels.sms`
- `channels.email`
- `timezone`

## `FollowUpDispatchLog`

Per-attempt outbound history:

- `kind`: `chat_dropoff | warm_lead | cold_lead | invoice_reminder | manual_followup | meeting_reminder`
- `channel`: `sms | email`
- `status`: `sent | failed | skipped`
- `leadId`, `customerId`, `invoiceId`, `followUpId`, `meetingId`
- `sentBy`, `sentAt`, `metadata`, `error`

## Updated Existing Models

## `FollowUp`

Added:

- `reminderMinutes` (default `30`)
- `notifyCustomer` (default `true`)
- `sendSms` (default `true`)
- `sendEmail` (default `true`)
- `reminderSentAt`
- `source`: `manual | warm_lead_auto | cold_lead_auto | chat_dropoff_auto | invoice_auto`
- `relatedInvoiceId`

## `Meeting`

Added:

- `reminderMinutes` (default `30`)
- `reminderSms` (default `true`)
- `reminderEmail` (default `true`)
- `reminderSentAt`

## API Endpoints

Base: `/api/followup-automation`

### 1) Get automation config

`GET /config`  
Roles: `admin`, `sales`

Response:

```json
{
  "success": true,
  "data": {
    "config": {
      "key": "global",
      "chatDropOff": {
        "enabled": true,
        "inactivityMinutes": 30,
        "maxAttempts": 3,
        "attemptIntervalsMinutes": [30, 180, 1440]
      },
      "coldLead": {
        "enabled": true,
        "intervalsDays": [1, 3, 7, 14],
        "maxAttempts": 4
      },
      "invoiceReminder": {
        "enabled": true,
        "intervalsHours": [24, 72, 168],
        "maxAttempts": 3
      },
      "manualReminder": {
        "defaultReminderMinutes": 30,
        "sendDueNowReminder": true
      },
      "channels": { "sms": true, "email": true },
      "timezone": "UTC"
    }
  }
}
```

### 2) Update automation config

`PUT /config`  
Roles: `admin`

Request body (partial update supported):

```json
{
  "chatDropOff": {
    "enabled": true,
    "inactivityMinutes": 20,
    "attemptIntervalsMinutes": [20, 120, 720]
  },
  "coldLead": {
    "enabled": true,
    "intervalsDays": [1, 2, 5]
  },
  "invoiceReminder": {
    "intervalsHours": [24, 48]
  },
  "channels": {
    "sms": true,
    "email": true
  }
}
```

### 3) Run automation sweep now

`POST /run-now`  
Roles: `admin`

Response includes scan/sent counts:

```json
{
  "success": true,
  "data": {
    "chatDropOff": { "scanned": 19, "sent": 0 },
    "coldLead": { "scanned": 14, "sent": 2 },
    "invoiceReminder": { "scanned": 4, "sent": 1 },
    "manualReminder": { "scanned": 5, "sent": 3 },
    "meetingReminder": { "scanned": 4, "sent": 1 }
  }
}
```

### 4) Send chat drop-off follow-up immediately

`POST /chat/:leadId/send-now`  
Roles: `admin`, `sales` (sales only for assigned lead)

Request body:

```json
{
  "message": "Hi, just checking in. Share your pending details and we can finalize your quote."
}
```

## Existing Follow-Up APIs (enhanced fields)

### Manual follow-up flow APIs (sales)

`POST /api/sales/followups`

`GET /api/sales/followups/stats`

`GET /api/sales/followups/upcoming`

`PUT /api/sales/followups/:followUpId/complete`

### Manual follow-up flow APIs (admin)

`POST /api/admin/followups`

`GET /api/admin/followups`

`GET /api/admin/followups/activity-log`

`GET /api/admin/followups/stats`

`GET /api/admin/followups/upcoming`

`PUT /api/admin/followups/:followUpId/complete`

Admin behavior:

- Admin can create follow-ups on behalf of any sales user using `assignedTo` in `POST /api/admin/followups`.
- Admin follow-up listing endpoints return follow-ups across users (with query filters like `employeeId`, `status`, date range).

New optional request fields on both:

```json
{
  "reminderMinutes": 30,
  "notifyCustomer": true,
  "sendSms": true,
  "sendEmail": true
}
```

`modeOfContact` now accepts `sms` as well.

## Existing Meeting APIs (enhanced fields)

`POST/PUT /api/sales/meetings` and `POST/PUT /api/admin/meetings`

Meeting visibility behavior:

- Sales sees only meetings tied to their assigned leads.
- Admin can view meetings across users/projects (with optional filters like `leadId`, `status`, `search`).

New optional request fields:

```json
{
  "reminderMinutes": 30,
  "reminderSms": true,
  "reminderEmail": true
}
```

## In-house calendar sync APIs (no Google/Outlook dependency)

Calendar events are maintained inside this platform and auto-synced from follow-up/meeting actions.

- Follow-up create -> calendar event auto-created
- Follow-up complete -> calendar event auto-marked `completed`
- Meeting create -> calendar event auto-created
- Meeting reschedule/edit -> calendar event auto-updated
- Meeting cancel -> calendar event auto-marked `cancelled`

### Fetch calendar events

`GET /api/calendar/events?startDate=<iso>&endDate=<iso>&status=scheduled|completed|cancelled&kind=meeting|followup`

- `sales` can fetch only their own calendar.
- `admin` can fetch own events or pass `userId` to view a specific employee.

### Update reminder preference from calendar

`PUT /api/calendar/events/:eventId/reminder`

Request body:

```json
{
  "reminderMinutes": 30,
  "reminderSms": true,
  "reminderEmail": true
}
```

This updates both calendar event reminder settings and the linked source record (`Meeting`/`FollowUp`).

## Realtime socket events for reminders (frontend contract)

### Namespace and room

- Namespace: `/admin`
- Room: `user:<loggedInUserId>`
- Frontend should join the user room after socket connect (existing `join_user_room` flow).

### Event to listen

- `followup:reminder`

### Payload shape

```json
{
  "_id": "66f4d94c8d6c0b4f1f9a6c2e",
  "notificationId": "66f4d94c8d6c0b4f1f9a6c2f",
  "type": "followup_reminder",
  "followUpId": "66f4d94c8d6c0b4f1f9a6c2e",
  "leadId": "66f4d94c8d6c0b4f1f9a6c10",
  "followUpDate": "2026-08-31T10:00:00.000Z",
  "modeOfContact": "call",
  "reminderMinutes": 30,
  "message": "Follow-up is scheduled at 8/31/2026, 10:00:00 AM and is due in 30 minutes."
}
```

### Notes

- This socket event is emitted for follow-up reminder scheduler notifications.
- Reminder records are also persisted in `Notification`, so UI can recover missed realtime events from notification APIs.
- Calendar events can be fetched via `GET /api/calendar/events` to render scheduled items in the in-app calendar UI.

## All reminder types and frontend handling matrix

Use this as the single source of truth for admin/sales reminder UX.

### 1) Manual/Scheduled follow-up reminder

- Trigger: `followUpDate - reminderMinutes`
- Audience: assigned sales user (and optional customer SMS/email if enabled)
- Realtime socket:
  - `followup:reminder` on `/admin` namespace, `user:<userId>` room
- Persisted notification:
  - yes (`Notification` with `type: "followup"`)
- External channels:
  - SMS/email based on follow-up toggles + global channel config

### 2) Meeting reminder

- Trigger: `meetingTime - reminderMinutes`
- Audience: meeting creator (admin/sales)
- Realtime socket:
  - currently none (frontend should read notifications list + calendar events)
- Persisted notification:
  - currently no dedicated meeting notification row from automation runner
- External channels:
  - SMS/email based on meeting reminder toggles + global channel config

### 3) Chat drop-off auto follow-up reminder

- Trigger: based on chat inactivity + configured interval attempts
- Audience: lead customer (plus follow-up gets created for assigned sales)
- Realtime socket:
  - currently none
- Persisted notification:
  - follow-up records/logs are created; fetch follow-up lists/activity for admin/sales UI
- External channels:
  - SMS/email to customer based on config

### 4) Cold lead auto follow-up reminder

- Trigger: based on configured day intervals and max attempts
- Audience: lead customer (plus follow-up gets created for assigned sales)
- Realtime socket:
  - currently none
- Persisted notification:
  - follow-up records/logs are created; fetch follow-up lists/activity for admin/sales UI
- External channels:
  - SMS/email to customer based on config

### 5) Invoice reminder automation

- Trigger: configured hour intervals from invoice `sentAt`/`createdAt`
- Audience: customer (plus follow-up record linked to invoice)
- Realtime socket:
  - currently none
- Persisted notification:
  - follow-up records/logs are created; fetch follow-up/invoice views for UI
- External channels:
  - SMS/email to customer based on config

### Frontend recommendation

- Listen to realtime socket event: `followup:reminder`
- Also poll/read:
  - `GET /api/calendar/events`
  - follow-up listing/activity endpoints
  - notifications endpoints
- This ensures no reminder is missed even if socket disconnects or a reminder type is non-realtime.

## Automation Runtime Behavior

- Runner starts with backend boot and executes every 60 seconds.
- Chat drop-off sends only when lead is still active and configured conditions pass.
- Cold lead reminders use configured day intervals and max attempts.
- Invoice reminders target invoices in `sent` / `overdue`.
- Manual follow-up reminders are triggered at `followUpDate - reminderMinutes`.
- Meeting reminders send when current time reaches `meetingTime - reminderMinutes`.
- Reminder text includes schedule time + `due in X minutes` phrasing.

## Delivery Provider Behavior

- SMS uses Twilio when configured:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_FROM_PHONE`
- If Twilio is missing, SMS falls back to non-blocking stub logs.
- Email uses existing SendGrid setup; if missing, email attempts are logged as `skipped`.
