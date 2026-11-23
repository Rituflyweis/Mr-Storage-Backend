# Contract upload vs DocuSign

**Audience:** Sales panel, Admin, Accounts, and whoever is wiring the contract screen  
**Status:** The upload flow is live. DocuSign email signing is implemented. See `docusign-contract-signing-api-fe.md`. The iframe path is still not built.

The storyboard below is **not** the flow the sales panel uses today, and it is **not** an iframe.

---

## What is live today

Sales uploads a signed PDF. The backend stores that file on the lead as a contract. Sales, Admin, and Accounts open the same file under **Project → Agreement**.

There is no DocuSign email, no Sent / Delivered / Viewed / Completed status, and no signing URL.

| Action | Method and path |
|---|---|
| Save the uploaded contract | `POST /api/upload/leads/:leadId/agreement` |
| Read it (sales) | `GET /api/sales/leads/:leadId/agreement` |
| Read it (admin) | `GET /api/admin/leads/:leadId/agreement` |
| Read it on the customer’s project | `GET /api/admin/customers/:customerId/projects/:leadId/agreement` and the sales equivalent |
| Read it (accounts) | `GET /api/account/projects/:projectId/agreement` |

`POST` body:

```json
{ "url": "https://…/signed-contract.pdf", "name": "Signed contract.pdf" }
```

`url` and `name` are required. The file is stored as document type `contract`. The agreement APIs return the latest contract on that lead.

Admins can view the same agreement. This is the flow behind “the contract upload in the sales panel.”

---

## What the storyboard describes

This is the **email signing** path from the design brief. It is not implemented.

1. **Contract ready** — quote finalized, contract ready.
2. **Review contract** — sales reviews the contract PDF or preview.
3. **Send for signature** — send to the customer’s email (editable), with optional CC, a company signer, and a message.
4. **Sent → Delivered → Viewed** — the customer gets a **DocuSign** email. Status updates come from DocuSign.
5. **Customer signs → Completed** — the signed PDF is saved under **Project → Agreement**. Sales and Accounts see Signed and can download it.

The customer signs on DocuSign’s site, from the email DocuSign sends. The frontend shows a send form and a status badge. It does **not** embed DocuSign.

---

## Iframe is a different, later option

DocuSign also allows embedded signing. That is the path where:

1. The backend creates a short-lived signing URL.
2. The customer portal opens that URL in an iframe (or redirects to DocuSign and comes back).

That URL is **not** generated today. The storyboard above does not use it. The design brief marks the iframe as a later phase. The first version, if DocuSign is built, is the email path.

| Question | Answer |
|---|---|
| Is the storyboard the same as the sales contract upload? | No. Upload is live. The storyboard is DocuSign email signing, and it is not built. |
| Does the frontend show a DocuSign URL in an iframe? | Not for this storyboard. An iframe would be a separate later option. |
| Who can see the uploaded contract? | Sales, Admin, and Accounts, from the agreement APIs above. |
