// Stub SMS sender — no SMS provider (e.g. Twilio) is configured yet.
// Logs the outgoing message and resolves successfully so calling code
// (and the frontend) can be wired up end-to-end ahead of the real integration.
const sendSms = async ({ to, body }) => {
  console.log(`[SMS stub] to=${to} body="${body}"`)
  return { sid: `stub_${Date.now()}`, to, body, status: 'queued', provider: 'stub' }
}

module.exports = { sendSms }
