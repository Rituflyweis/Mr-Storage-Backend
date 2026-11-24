# Facebook Messenger — what we need from you

This connects your Facebook Page to the sales chat. When someone messages the Page, Sam replies, and that person is saved in the CRM as a lead, with a hot / warm / cold status and a full transcript.

We do **not** need your Facebook password.

Please use **one** of the two options below. Option 1 is the one we prefer.

Our Facebook account name is **Node Flyweis**. The email on that account is **node6@flyweis.technology**. When you add someone, search or invite with that email.

---

## Option 1 — add Node Flyweis as a Page admin

Please add **node6@flyweis.technology** (Facebook name **Node Flyweis**) as an **Admin** of the Facebook Page.

**Page settings → Page access → People with Facebook access → Add new → enter node6@flyweis.technology → Admin**

Editor is not enough. A Page admin can create the Meta app, connect the Page, and generate the token. We do that part. You do not need to open Meta for Developers.

Also confirm:

- The Page is **published**. An unpublished Page will not receive customer messages.
- You can stay available later as the Page admin if Meta asks to verify the business. That step is required before every customer, not only test users, can talk to the bot.

Please leave **Node Flyweis** as an Admin until we have finished testing. We need to open the Page inbox and see the customer’s message and Sam’s reply, so we can confirm the lead is actually being answered. You can remove the Admin access after we tell you the test passed.

### What you send us

| Item                                     | Where it is                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Facebook Page id                         | Page → **About** → **Page transparency**, or **Settings** → **Page setup**. It is the numeric id. |
| A note that node6@flyweis.technology is now an Admin | After you add the account                                                                         |

Please do not send a token. We will create it while logged in as Node Flyweis.

---

## Option 2 — you create the Meta app and send us the token

Use this only if you would rather not give Node Flyweis admin access for the app setup.

You still need to give **Node Flyweis** access to the Page inbox. Without that we cannot see the live thread and confirm that the customer got a reply.

**Page settings → Page access → People with Facebook access → Add new → node6@flyweis.technology**, with access to **Messages**.

### What you do

1. Go to [developers.facebook.com](https://developers.facebook.com) and log in with a Facebook account that is an Admin of the Page.
2. Create an app. Choose the **Business** type.
3. Add the **Messenger** product to the app.
4. Under Messenger settings, connect your Facebook Page.
5. Generate a **Page access token** for that Page.
6. Copy the **App secret** from **App settings → Basic**.
7. Copy the **Page id** (the numeric id on the Page, or in Page transparency).
8. Send us those three items in a private message, not a group chat:
   - Page id
   - Page access token
   - App secret
9. We will send you back two values to paste into the same Messenger settings:
   - **Callback URL**
   - **Verify token**
10. After the callback shows as verified, subscribe the Page to **messages**.

We choose the verify token. Please do not invent a different one.

After the test passes you can regenerate the Page access token if you want the old one to stop working. Tell us before you do that, so we can update the server.

---

## What we set up after that

1. Connect your Page to Messenger.
2. Point Facebook at our server so new messages are received.
3. Subscribe the Page to **messages**.
4. Open the Page inbox as Node Flyweis and confirm the customer message and Sam’s reply are both there. The same thread should appear in the CRM with source **messenger**.

---

## Who can message the bot at first

Until Meta approves the app for the public, only people added as an admin, developer, or tester on the app will get a reply.

Customers who message the Page before that approval will not get a Sam reply. We will tell you when it is ready for everyone.

Facebook does not give us the person’s phone or email. The lead is created from their Messenger name. If they type a phone or email in the chat, that is stored on the lead.

---

## What this does not include

- We will not post on the Page, run ads, or change Page settings beyond connecting Messenger.
- We will not ask for your personal Facebook password.
- Instagram messages are not part of this step. Say if you want that as well.
