#!/usr/bin/env node
/**
 * Manual / Render cron entry: full MongoDB dump → S3 → email.
 *   node scripts/run-db-backup.js
 */
require('dotenv').config()

const { runDbBackup } = require('../src/services/backup/dbBackup.service')

runDbBackup({ trigger: process.env.DB_BACKUP_TRIGGER || 'cron' })
  .then((result) => {
    if (result.skipped) {
      console.log('[run-db-backup] skipped:', result.reason)
      process.exit(0)
    }
    console.log('[run-db-backup] success:', result.s3Key)
    process.exit(0)
  })
  .catch((err) => {
    console.error('[run-db-backup] failed:', err.message)
    process.exit(1)
  })
