# Quotation / Estimate approval flow (for managers)

**Status:** Live on backend  
**Same idea as invoices:** sales cannot send to the customer until admin approves. Editing after approval starts the approval cycle again.

---

## Sales panel

1. Sales creates a quotation (or converts an estimate to a quotation).  
   It goes to admin as **Pending Approval**.  
   Sales **cannot send** it to the customer yet.

2. If sales **edits that pending quotation** (or saves the linked estimate):  
   - the old approval request is **cancelled**  
   - a **new pending request** is created for the updated version  
   - sales does **not** need to submit again  
   - admin still sees it as waiting, but only the **new version** is waiting

3. If admin **rejects** it:  
   sales can edit, then **must submit again** for approval.

4. If admin **approves** it and sales later **edits** it (quotation or linked estimate):  
   - approval is **cleared**  
   - status becomes **not submitted / needs resubmit**  
   - **Send stays off**  
   - sales **must submit again** before it can be sent

5. Only after admin **approves the current version** can sales **send** the quotation to the customer.

6. Once the quotation is **sent**, it is locked. Sales cannot edit it.

---

## Admin panel

1. Admin sees quotations waiting for approval (**one row per quotation**, not one row per history event).

2. For a quotation that was edited while pending, detail should show:
   - **Old version: Cancelled**
   - **New version: Pending approval**

3. Admin can **Approve** or **Reject** only the **current pending** version.

4. **Approve** → sales can send to the customer.

5. **Reject** → it goes back to sales to fix and resubmit.

---

## Simple rules

| What sales does | What happens to approval |
|---|---|
| Creates quote / converts estimate | Auto **Pending Approval** |
| Edits while **pending** | Old request cancelled + new pending (no extra submit) |
| Edits after **approved** | Approval cleared. Sales **must submit again** |
| Edits after **rejected** | Approval cleared. Sales **must submit again** |
| Tries to **send** before approval | Blocked |
| Tries to edit after **sent** | Blocked |

- Edit while waiting for approval = cancel old request + new pending request automatically.  
- Edit after approval or rejection = sales must submit again.  
- Send to customer = only after admin approval of **that** version.

---

## Estimate vs quotation (important)

Sales often edits the **estimate**, not the quotation screen.

That is already wired:

- If the estimate is already converted to a quotation, saving the estimate updates the quotation **and** runs the same approval rules as above.
- If the quotation is already **sent**, saving the estimate does **not** change quotation approval.

---

## What sales should see on screen

| State | Badge | Edit | Submit for approval | Send to customer |
|---|---|---|---|---|
| Pending | Pending Approval | Yes (auto new request) | Hide | Disabled |
| Approved | Approved | Yes (clears approval) | Hide until they edit | Enabled |
| After editing an approved quote | Needs resubmit | Yes | **Show** | Disabled |
| Rejected | Rejected | Yes | Show after edit | Disabled |
| Sent | Sent | No | Hide | Hide |

---

## One-line summary for leadership

**Sales can still change an approved quote. The moment they save that change, admin approval is no longer valid. They must send it back through approval before the customer can be emailed.**
