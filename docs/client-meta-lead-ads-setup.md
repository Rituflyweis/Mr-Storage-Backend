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

## Server logs (when testing)

After deploy, `pm2 logs` (or your process logs) should show:

| Log line | Meaning |
|----------|---------|
| `[FacebookWebhook] received` | POST hit the server; includes `changeFields`, `leadgenEvents`, `messagingEvents` |
| `[FacebookWebhook] rejected: invalid X-Hub-Signature-256` | `FACEBOOK_APP_SECRET` does not match Meta app |
| `[MetaLeadAds] processing leadgen batch` | Real `leadgen_id` found — ingest started |
| `[MetaLeadAds] ingest start` / `ingest success` | Lead created; `fieldNames` lists form keys |
| `[MetaLeadAds] ingest failed` | Often missing `leads_retrieval` or invalid test `leadgen_id` |
| `[MetaLeadAds] webhook had leadgen field but no usable leadgen_id` | Meta **Test** button — normal; use a real form submit for full ingest |

## Permissions note

Meta often requires **App Review** for `leads_retrieval` in **Live** mode. In **Development** mode, users with a role on the app can test.