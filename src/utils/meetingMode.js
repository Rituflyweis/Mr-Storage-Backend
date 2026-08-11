const MEETING_MODES = ['online', 'offline']

const MEETING_MODE_ALIASES = {
  online: 'online',
  offline: 'offline',
  'in-person': 'offline',
  in_person: 'offline',
  inperson: 'offline',
}

const normalizeMeetingMode = (mode) => {
  const key = String(mode || '').trim().toLowerCase()
  return MEETING_MODE_ALIASES[key] || null
}

const isValidMeetingModeInput = (mode) => normalizeMeetingMode(mode) != null

module.exports = {
  MEETING_MODES,
  normalizeMeetingMode,
  isValidMeetingModeInput,
}
