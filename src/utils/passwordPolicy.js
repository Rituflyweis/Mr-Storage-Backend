// Staff password rules (shown under "Password Requirements" on the Security Settings screen).
// Applied whenever a new password is set; existing passwords keep working until changed.
const PASSWORD_RULES = [
  { test: (p) => p.length >= 8, message: 'at least 8 characters long' },
  { test: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p), message: 'include uppercase and lowercase letters' },
  { test: (p) => /\d/.test(p), message: 'include at least one number' },
  { test: (p) => /[^A-Za-z0-9\s]/.test(p), message: 'include at least one special character' },
]
const MAX_PASSWORD_LENGTH = 128

// Returns an error message, or null when the password is acceptable.
const validatePassword = (password) => {
  if (typeof password !== 'string' || !password) return 'New password is required'
  if (password.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`
  const failed = PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.message)
  return failed.length ? `Password must be ${failed.join(', ')}` : null
}

module.exports = { validatePassword, PASSWORD_RULES }
