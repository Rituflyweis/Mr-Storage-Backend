# Follow-Up Automation Admin Config UI Integration

Use this guide to wire the React admin screen to backend config APIs with the exact values expected by the current implementation.

## API Endpoints

- `GET /api/followup-automation/config`
- `PUT /api/followup-automation/config`

Auth: admin token required for `PUT`.

## Payload Contract (PUT)

```json
{
  "channels": {
    "sms": true,
    "email": true
  },
  "timezone": "UTC",
  "chatDropOff": {
    "enabled": true,
    "inactivityMinutes": 30,
    "maxAttempts": 3,
    "attemptIntervalsMinutes": [30, 180, 1440]
  },
  "leadFollowUp": {
    "warm": {
      "enabled": true,
      "preset": "twice_week",
      "maxAttempts": 4,
      "intervalsDays": [3, 7, 10, 14]
    },
    "cold": {
      "enabled": true,
      "preset": "d7_15_30",
      "maxAttempts": 4,
      "intervalsDays": [7, 15, 30]
    }
  },
  "manualReminder": {
    "defaultReminderMinutes": 30,
    "sendDueNowReminder": true
  }
}
```

## Field Rules

- `channels.sms`, `channels.email`: boolean.
- `timezone`: string (`UTC` or IANA timezone like `America/Chicago`).
- `chatDropOff.inactivityMinutes`: number, `>= 0`.
- `chatDropOff.maxAttempts`: number, recommended `1..6`.
- `chatDropOff.attemptIntervalsMinutes`: positive number array, ascending.
- `leadFollowUp.warm.enabled`: boolean.
- `leadFollowUp.warm.maxAttempts`: number, recommended `1..6`.
- `leadFollowUp.warm.intervalsDays`: positive number array, ascending.
- `leadFollowUp.cold.enabled`: boolean.
- `leadFollowUp.cold.maxAttempts`: number, recommended `1..6`.
- `leadFollowUp.cold.intervalsDays`: positive number array, ascending.
- `manualReminder.defaultReminderMinutes`: number, `>= 0`.
- `manualReminder.sendDueNowReminder`: boolean.

## Important Backend Behavior (Must Know)

- Backend now **always enforces**:
  - `chatDropOff.requireNotQuoteReady = true`
  - `chatDropOff.requireNotHandedToSales = true`
- Do not show these toggles in UI; they are internal rules.
- You can omit both fields from payload; backend sets and enforces them anyway.

## UI Preset Enums

These are current UI preset IDs used by `docs/followup-automation-admin-config-ui.html`.

### Warm preset IDs

- `twice_week`
- `weekly`
- `d7_15_30`
- `custom`

### Cold preset IDs

- `d7_15_30`
- `every_15`
- `monthly`
- `custom`

### Chat preset IDs

- `default`
- `twice_day`
- `daily`
- `custom`

## Suggested TS Types

```ts
export type WarmPreset = "twice_week" | "weekly" | "d7_15_30" | "custom";
export type ColdPreset = "d7_15_30" | "every_15" | "monthly" | "custom";
export type ChatPreset = "default" | "twice_day" | "daily" | "custom";

export interface FollowupAutomationConfigPayload {
  channels: { sms: boolean; email: boolean };
  timezone: string;
  chatDropOff: {
    enabled: boolean;
    inactivityMinutes: number;
    maxAttempts: number;
    attemptIntervalsMinutes: number[];
  };
  leadFollowUp: {
    warm: { enabled: boolean; preset?: WarmPreset; maxAttempts: number; intervalsDays: number[] };
    cold: { enabled: boolean; preset?: ColdPreset; maxAttempts: number; intervalsDays: number[] };
  };
  manualReminder: {
    defaultReminderMinutes: number;
    sendDueNowReminder: boolean;
  };
}
```

## Scheduling Note for “Twice a week”

- Preset currently maps to interval offsets `[3, 7, 10, 14]`.
- This is offset-based cadence, not strict calendar-week slots.
- Example anchor on Tuesday:
  - next attempt at `+3 days` (Friday),
  - then `+7 days` (next Tuesday).

## Migration Note (old key support)

- Old key `coldLead` is still accepted for backward compatibility.
- New integrations should use only `leadFollowUp.warm` and `leadFollowUp.cold` as the single source of truth.

