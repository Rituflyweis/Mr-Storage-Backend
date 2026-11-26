# Meta Lead Ads → CRM (setup for client)

When someone submits your **Facebook / Instagram lead form**, the CRM creates a lead automatically. Staff see the form answers in **Open Chat** and on the lead detail card.

**Webhook URL (same as Messenger):**  
`https://<your-api-host>/api/facebook/messenger`  
**Verify token:** same as `FACEBOOK_VERIFY_TOKEN` on the server.

## In Meta Business / Developer app

1. **Webhooks → Page** — subscribe the Steel Building Depot Page.
2. Besides **messages**, also subscribe **`leadgen`**.
3. Confirm **Verify and save** on the callback URL above.
4. The Page access token on the server must include **`leads_retrieval`** (and **`pages_manage_metadata`** as Meta requires for lead download).

## What the team sees in CRM

| Where | What |
|--------|------|
| Leads list | `source: "meta_lead_ads"` |
| Open Chat | First message labeled **Meta lead ad** with all form fields |
| Lead detail API | `data.metaLeadAd.fieldData` — structured copy of the form |

Sam does **not** auto-chat Meta lead ads until you add that separately; these are form submissions, not Messenger threads.

## Permissions note

Meta often requires **App Review** for `leads_retrieval` in **Live** mode. In **Development** mode, users with a role on the app can test.