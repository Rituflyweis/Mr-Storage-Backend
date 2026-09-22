const schedule = require('node-schedule')
const env = require('../../config/env')
const { runDbBackup, isBackupConfigured } = require('../../services/backup/dbBackup.service')

const JOB_NAME = 'daily-db-backup'

const initDbBackupScheduler = () => {
  if (!env.DB_BACKUP_IN_PROCESS_SCHEDULE) {
    console.log('[dbBackupScheduler] in-process schedule off (use cron or DB_BACKUP_IN_PROCESS_SCHEDULE=true)')
    return
  }
  if (!env.DB_BACKUP_ENABLED) {
    console.log('[dbBackupScheduler] disabled (DB_BACKUP_ENABLED=false)')
    return
  }
  if (!isBackupConfigured()) {
    console.warn('[dbBackupScheduler] skipped — configure MONGO_URI and AWS S3')
    return
  }

  const existing = schedule.scheduledJobs[JOB_NAME]
  if (existing) existing.cancel()

  schedule.scheduleJob(
    JOB_NAME,
    { rule: env.DB_BACKUP_CRON, tz: env.DB_BACKUP_TIMEZONE },
    () => {
      runDbBackup({ trigger: 'schedule' }).catch((err) => {
        console.error('[dbBackupScheduler] scheduled run failed:', err.message)
      })
    },
  )

  console.log(
    `[dbBackupScheduler] daily backup scheduled (${env.DB_BACKUP_CRON}, ${env.DB_BACKUP_TIMEZONE})`,
  )
}

module.exports = { initDbBackupScheduler, JOB_NAME }
