const env = require('../../config/env')

const TOKEN_URL = 'https://zoom.us/oauth/token'
const API_BASE = 'https://api.zoom.us/v2'

let cachedToken = { value: '', expiresAt: 0 }

const zoomConfigured = () =>
  Boolean(env.ZOOM_ACCOUNT_ID && env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET)

const zoomError = (status, body) => {
  const message = body?.message || body?.reason || `Zoom request failed (${status})`
  const err = new Error(message)
  err.status = status
  return err
}

const zoomFetch = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let body = {}
  if (text) {
    try { body = JSON.parse(text) } catch { body = { message: text.slice(0, 300) } }
  }
  if (!res.ok) throw zoomError(res.status, body)
  return body
}

const accessToken = async () => {
  if (!zoomConfigured()) {
    throw new Error('Zoom is not configured. Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET.')
  }
  if (cachedToken.value && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value

  const basic = Buffer.from(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`).toString('base64')
  const url = `${TOKEN_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(env.ZOOM_ACCOUNT_ID)}`
  const body = await zoomFetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
  })
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
  }
  return cachedToken.value
}

const api = async (method, path, payload) => {
  const token = await accessToken()
  return zoomFetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  })
}

const meetingPayload = ({ title, meetingTime, duration }) => ({
  topic: String(title || 'Online meeting').slice(0, 200),
  type: 2,
  start_time: new Date(meetingTime).toISOString(),
  duration: Math.min(Math.max(Number(duration) || 30, 15), 24 * 60),
  timezone: 'UTC',
  settings: {
    join_before_host: true,
    waiting_room: false,
    approval_type: 2,
    meeting_authentication: false,
    audio: 'both',
  },
})

const publicJoinUrl = (meeting) => {
  const join = String(meeting?.join_url || '').trim()
  if (!join) throw new Error('Zoom did not return a join link')
  return join
}

/**
 * Creates a scheduled Zoom meeting anyone with the link can join.
 * Returns { meetingId, joinUrl, startUrl }.
 */
const createPublicZoomMeeting = async (input) => {
  const host = encodeURIComponent(env.ZOOM_HOST_USER || 'me')
  const created = await api('POST', `/users/${host}/meetings`, meetingPayload(input))
  return {
    meetingId: String(created.id || ''),
    joinUrl: publicJoinUrl(created),
    startUrl: String(created.start_url || ''),
  }
}

const updatePublicZoomMeeting = async (meetingId, input) => {
  if (!meetingId) return
  await api('PATCH', `/meetings/${encodeURIComponent(meetingId)}`, meetingPayload(input))
}

const deletePublicZoomMeeting = async (meetingId) => {
  if (!meetingId) return
  try {
    await api('DELETE', `/meetings/${encodeURIComponent(meetingId)}`)
  } catch (err) {
    if (err.status !== 404) console.error('[Zoom] delete meeting failed:', err.message)
  }
}

/**
 * Online meetings get a Zoom join link when the request did not supply one.
 * A supplied meetingLink is kept as-is.
 */
const resolveOnlineMeetingLink = async ({
  mode,
  meetingLink,
  title,
  meetingTime,
  duration,
  zoomMeetingId,
}) => {
  const provided = String(meetingLink || '').trim()
  if (mode !== 'online') {
    return { meetingLink: provided, zoomMeetingId: zoomMeetingId || '', zoomStartUrl: '' }
  }
  if (provided) {
    return { meetingLink: provided, zoomMeetingId: zoomMeetingId || '', zoomStartUrl: '' }
  }
  if (zoomMeetingId) {
    return { meetingLink: '', zoomMeetingId, zoomStartUrl: '' }
  }
  const created = await createPublicZoomMeeting({ title, meetingTime, duration })
  return {
    meetingLink: created.joinUrl,
    zoomMeetingId: created.meetingId,
    zoomStartUrl: created.startUrl,
  }
}

module.exports = {
  zoomConfigured,
  createPublicZoomMeeting,
  updatePublicZoomMeeting,
  deletePublicZoomMeeting,
  resolveOnlineMeetingLink,
}
