require("dotenv").config();

const required = ["MONGO_URI", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`[ENV] Missing required env var: ${key}`);
    process.exit(1);
  }
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "[ENV] ANTHROPIC_API_KEY is not set — AI features will fail at runtime",
  );
}

module.exports = {
  PORT: parseInt(process.env.PORT || "5001", 10),
  NODE_ENV: process.env.NODE_ENV || "development",
  MONGO_URI: process.env.MONGO_URI,

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_RESET_SECRET:
    process.env.JWT_RESET_SECRET || process.env.JWT_ACCESS_SECRET,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || "7d",

  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
  /** Faster model for live phone turns. Empty uses ANTHROPIC_MODEL. */
  VOICE_ANTHROPIC_MODEL: (process.env.VOICE_ANTHROPIC_MODEL || "claude-haiku-4-5").trim(),

  CLAUDE_MAX_PRIOR_CONTEXT_CHARS: parseInt(
    process.env.CLAUDE_MAX_PRIOR_CONTEXT_CHARS || "45000",
    10,
  ),
  CLAUDE_MAX_LIVE_CONTEXT_CHARS: parseInt(
    process.env.CLAUDE_MAX_LIVE_CONTEXT_CHARS || "28000",
    10,
  ),
  CLAUDE_CONTEXT_SUMMARY_MAX_CHARS: parseInt(
    process.env.CLAUDE_CONTEXT_SUMMARY_MAX_CHARS || "2200",
    10,
  ),
  CLAUDE_LIVE_VERBATIM_TURNS: parseInt(
    process.env.CLAUDE_LIVE_VERBATIM_TURNS || "12",
    10,
  ),
  CLAUDE_MAX_SCORE_PRIOR_CHARS: parseInt(
    process.env.CLAUDE_MAX_SCORE_PRIOR_CHARS || "22000",
    10,
  ),
  CLAUDE_MAX_SCORE_LIVE_CHARS: parseInt(
    process.env.CLAUDE_MAX_SCORE_LIVE_CHARS || "18000",
    10,
  ),

  AWS_REGION: process.env.AWS_REGION || "us-east-1",
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
  AWS_S3_PRESIGNED_URL_EXPIRES: parseInt(
    process.env.AWS_S3_PRESIGNED_URL_EXPIRES || "300",
    10,
  ),

  SENDGRID_API_KEY: (process.env.SENDGRID_API_KEY || "").trim() || undefined,
  SENDGRID_FROM: (process.env.SENDGRID_FROM || "").trim() || undefined,
  MAIL_FROM:
    (process.env.MAIL_FROM || "").trim() ||
    "Construction AI <noreply@example.com>",
  MAIL_FROM_NODE_MAILER: (process.env.MAIL_FROM_NODE_MAILER || "").trim() || null,

  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: parseInt(process.env.SMTP_PORT || "587", 10),
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_MAIL_FROM:
    (process.env.MAIL_FROM_NODE_MAILER || "").trim() ||
    (process.env.SMTP_MAIL_FROM || "").trim() ||
    (process.env.SMTP_USER
      ? `Steel Building Depot <${process.env.SMTP_USER}>`
      : null),

  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  TWILIO_FROM_PHONE: process.env.TWILIO_FROM_PHONE || '',
  /** Inbound AI voice number (defaults to SMS from-number if unset). */
  TWILIO_PHONE_NUMBER:
    process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_PHONE || '',
  /** Public HTTPS origin Twilio posts to, e.g. https://api.example.com (no trailing slash). */
  TWILIO_WEBHOOK_BASE_URL: (process.env.TWILIO_WEBHOOK_BASE_URL || '').replace(/\/$/, ''),
  /** Set "true" to enforce X-Twilio-Signature; production defaults to validating when unset. */
  TWILIO_VALIDATE_SIGNATURE: process.env.TWILIO_VALIDATE_SIGNATURE,
  /**
   * elevenlabs = ConversationRelay (Deepgram STT + ElevenLabs TTS, streaming).
   * gather = legacy <Gather> + Polly (higher latency).
   */
  VOICE_ENGINE: (process.env.VOICE_ENGINE || 'elevenlabs').trim().toLowerCase(),
  /** ElevenLabs voice id. Twilio speaks it; no ElevenLabs key is required on this server. */
  ELEVENLABS_VOICE_ID: (process.env.ELEVENLABS_VOICE_ID || 'UgBBYS2sOqTuMpoF3BR0').trim(),
  /** ConversationRelay model suffix. v4 is Twilio's low-latency ElevenLabs voice. */
  ELEVENLABS_TTS_MODEL: (process.env.ELEVENLABS_TTS_MODEL || 'v4').trim(),
  VOICE_LANGUAGE: (process.env.VOICE_LANGUAGE || 'en-US').trim(),
  /** Silence after the agent finishes speaking before we ask if the caller is still there. */
  VOICE_SILENCE_MS: parseInt(process.env.VOICE_SILENCE_MS || '8000', 10),
  /** How many "are you still there?" checks before the call is ended. */
  VOICE_SILENCE_CHECKS: parseInt(process.env.VOICE_SILENCE_CHECKS || '3', 10),
  /** Call a new inquiry back. Set "false" to queue nothing and dial nothing automatically. */
  VOICE_OUTBOUND_ENABLED: process.env.VOICE_OUTBOUND_ENABLED !== 'false',
  VOICE_OUTBOUND_DELAY_MINUTES: parseInt(process.env.VOICE_OUTBOUND_DELAY_MINUTES || '30', 10),
  VOICE_OUTBOUND_MAX_ATTEMPTS: parseInt(process.env.VOICE_OUTBOUND_MAX_ATTEMPTS || '3', 10),
  /** Minutes after a miss before the next try. Then snapped into business hours. */
  VOICE_OUTBOUND_SPACING_MINUTES: parseInt(process.env.VOICE_OUTBOUND_SPACING_MINUTES || '120', 10),
  VOICE_OUTBOUND_HOUR_START: parseInt(process.env.VOICE_OUTBOUND_HOUR_START || '9', 10),
  VOICE_OUTBOUND_HOUR_END: parseInt(process.env.VOICE_OUTBOUND_HOUR_END || '19', 10),
  VOICE_OUTBOUND_DEFAULT_TZ: (process.env.VOICE_OUTBOUND_DEFAULT_TZ || 'America/Chicago').trim(),
  VOICE_OUTBOUND_SMS: process.env.VOICE_OUTBOUND_SMS !== 'false',
  VOICE_OUTBOUND_VOICEMAIL: process.env.VOICE_OUTBOUND_VOICEMAIL !== 'false',

  CLIENT_URL: process.env.CLIENT_URL || "https://steelbuildingdepot.com",
  MASTER_OTP:
    process.env.NODE_ENV !== "production"
      ? process.env.MASTER_OTP || null
      : null,

  INVOICE_COMPANY_NAME: process.env.INVOICE_COMPANY_NAME || "",
  INVOICE_COMPANY_ADDRESS: process.env.INVOICE_COMPANY_ADDRESS || "",
  INVOICE_COMPANY_EMAIL: process.env.INVOICE_COMPANY_EMAIL || "",
  INVOICE_COMPANY_WEBSITE: process.env.INVOICE_COMPANY_WEBSITE || "",
  INVOICE_LOGO_URL: process.env.INVOICE_LOGO_URL || "",
  INVOICE_BANK_NAME: process.env.INVOICE_BANK_NAME || "",
  INVOICE_BANK_ACCOUNT_NAME: process.env.INVOICE_BANK_ACCOUNT_NAME || "",
  INVOICE_BANK_ACCOUNT_NUMBER: process.env.INVOICE_BANK_ACCOUNT_NUMBER || "",
  INVOICE_BANK_ROUTING_NUMBER: process.env.INVOICE_BANK_ROUTING_NUMBER || "",
  INVOICE_BANK_SWIFT: process.env.INVOICE_BANK_SWIFT || "",
  INVOICE_BANK_IBAN: process.env.INVOICE_BANK_IBAN || "",
  INVOICE_BANK_BRANCH_ADDRESS: process.env.INVOICE_BANK_BRANCH_ADDRESS || "",
  INVOICE_BANK_PAYMENT_INSTRUCTIONS: process.env.INVOICE_BANK_PAYMENT_INSTRUCTIONS || "",

  ADMIN_LOGIN_URL:
    process.env.ADMIN_LOGIN_URL || "https://admin.storagematerials.org/sign-in",
  SALES_LOGIN_URL:
    process.env.SALES_LOGIN_URL || "https://sales.storagematerials.org",
  PLANT_LOGIN_URL:
    process.env.PLANT_LOGIN_URL || "https://plant.storagematerials.org/login",

  DB_BACKUP_ENABLED:
    process.env.DB_BACKUP_ENABLED !== "false" &&
    process.env.DB_BACKUP_ENABLED !== "0",
  /** In-process node-schedule (local dev). Production should use Render cron + set this false on web. */
  DB_BACKUP_IN_PROCESS_SCHEDULE:
    process.env.DB_BACKUP_IN_PROCESS_SCHEDULE === "true" ||
    (process.env.DB_BACKUP_IN_PROCESS_SCHEDULE !== "false" &&
      (process.env.NODE_ENV || "development") !== "production"),
  DB_BACKUP_NOTIFY_EMAIL:
    (process.env.DB_BACKUP_NOTIFY_EMAIL || "").trim() ||
    "info@steelbuildingdepot.com",
  /** When false (default), outbound mail to info@steelbuildingdepot.com is dropped in mailer. */
  ALLOW_MAIL_TO_INFO_STEELBUILDING:
    process.env.ALLOW_MAIL_TO_INFO_STEELBUILDING === "true",
  /** Nodemailer new-lead alerts (AI chat / website form) to active admin emails. Off unless true. */
  LEAD_ENQUIRY_EMAIL_ENABLED:
    process.env.LEAD_ENQUIRY_EMAIL_ENABLED === "true" ||
    process.env.LEAD_ENQUIRY_EMAIL_ENABLED === "1",
  DB_BACKUP_S3_PREFIX:
    (process.env.DB_BACKUP_S3_PREFIX || "").trim() ||
    `db-backups/${process.env.NODE_ENV || "development"}`,
  DB_BACKUP_RETENTION_COUNT: parseInt(
    process.env.DB_BACKUP_RETENTION_COUNT || "30",
    10,
  ),
  DB_BACKUP_PRESIGN_EXPIRY_SEC: parseInt(
    process.env.DB_BACKUP_PRESIGN_EXPIRY_SEC || "604800",
    10,
  ),
  DB_BACKUP_CRON: (process.env.DB_BACKUP_CRON || "").trim() || "0 4 * * *",
  DB_BACKUP_TIMEZONE:
    (process.env.DB_BACKUP_TIMEZONE || "").trim() || "Asia/Kolkata",
  PROJECT_ID_TIMEZONE:
    (process.env.PROJECT_ID_TIMEZONE || "").trim() || "America/New_York",
};
