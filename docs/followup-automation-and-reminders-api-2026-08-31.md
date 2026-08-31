# Follow-Up Automation and Reminders API (2026-08-31)

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

- `kind`: `chat_dropoff | cold_lead | invoice_reminder | manual_followup | meeting_reminder`
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
- `source`: `manual | cold_lead_auto | chat_dropoff_auto | invoice_auto`
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
      "chatDropOff": { "enabled": true, "inactivityMinutes": 30, "maxAttempts": 3, "attemptIntervalsMinutes": [30, 180, 1440] },
      "coldLead": { "enabled": true, "intervalsDays": [1, 3, 7, 14], "maxAttempts": 4 },
      "invoiceReminder": { "enabled": true, "intervalsHours": [24, 72, 168], "maxAttempts": 3 },
      "manualReminder": { "defaultReminderMinutes": 30, "sendDueNowReminder": true },
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

### Sales create follow-up

`POST /api/sales/followups`

### Admin create follow-up

`POST /api/admin/followups`

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

New optional request fields:

```json
{
  "reminderMinutes": 30,
  "reminderSms": true,
  "reminderEmail": true
}
```

## Automation Runtime Behavior

- Runner starts with backend boot and executes every 60 seconds.
- Chat drop-off sends only when lead is still active and configured conditions pass.
- Cold lead reminders use configured day intervals and max attempts.
- Invoice reminders target invoices in `sent` / `overdue`.
- Manual follow-up reminders send when due (`followUpDate <= now`) and `source = manual`.
- Meeting reminders send when current time reaches `meetingTime - reminderMinutes`.

## Delivery Provider Behavior

- SMS uses Twilio when configured:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_FROM_PHONE`
- If Twilio is missing, SMS falls back to non-blocking stub logs.
- Email uses existing SendGrid setup; if missing, email attempts are logged as `skipped`.
