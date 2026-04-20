require('dotenv').config()

const required = [
  'MONGO_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
]

for (const key of required) {
  if (!process.env[key]) {
    console.error(`[ENV] Missing required env var: ${key}`)
    process.exit(1)
  }
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[ENV] ANTHROPIC_API_KEY is not set — AI features will fail at runtime')
}

module.exports = {
  PORT: parseInt(process.env.PORT || '5001', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGO_URI: process.env.MONGO_URI,

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,

  CLAUDE_MAX_PRIOR_CONTEXT_CHARS: parseInt(process.env.CLAUDE_MAX_PRIOR_CONTEXT_CHARS || '45000', 10),
  CLAUDE_MAX_LIVE_CONTEXT_CHARS: parseInt(process.env.CLAUDE_MAX_LIVE_CONTEXT_CHARS || '28000', 10),
  CLAUDE_CONTEXT_SUMMARY_MAX_CHARS: parseInt(process.env.CLAUDE_CONTEXT_SUMMARY_MAX_CHARS || '2200', 10),
  CLAUDE_LIVE_VERBATIM_TURNS: parseInt(process.env.CLAUDE_LIVE_VERBATIM_TURNS || '12', 10),
  CLAUDE_MAX_SCORE_PRIOR_CHARS: parseInt(process.env.CLAUDE_MAX_SCORE_PRIOR_CHARS || '22000', 10),
  CLAUDE_MAX_SCORE_LIVE_CHARS: parseInt(process.env.CLAUDE_MAX_SCORE_LIVE_CHARS || '18000', 10),

  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
  AWS_S3_PRESIGNED_URL_EXPIRES: parseInt(process.env.AWS_S3_PRESIGNED_URL_EXPIRES || '300', 10),

  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  MAIL_FROM: process.env.MAIL_FROM || 'Construction AI <noreply@example.com>',

  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:3000',
}
