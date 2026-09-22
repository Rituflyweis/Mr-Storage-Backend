const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const env = require('../../config/env')
const {
  sendDbBackupNotification,
  sendDbBackupFailureNotification,
} = require('../email/mailer')

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
})

let backupRunning = false

const isAwsConfigured = () =>
  Boolean(env.AWS_S3_BUCKET && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)

const isBackupConfigured = () =>
  Boolean(env.MONGO_URI && isAwsConfigured())

const dbNameFromUri = (uri) => {
  const match = String(uri).match(/\/([^/?]+)(\?|$)/)
  return match?.[1] || 'mongodb'
}

const mongodumpBin = () =>
  process.env.MONGODUMP_PATH ||
  (process.env.PATH || '')
    .split(path.delimiter)
    .map((dir) => path.join(dir, process.platform === 'win32' ? 'mongodump.exe' : 'mongodump'))
    .find((candidate) => {
      try {
        return fs.existsSync(candidate)
      } catch {
        return false
      }
    }) ||
  'mongodump'

const runMongodump = (archivePath) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      mongodumpBin(),
      ['--uri', env.MONGO_URI, `--archive=${archivePath}`, '--gzip'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            'mongodump not found. Install MongoDB Database Tools and ensure mongodump is on PATH.',
          ),
        )
      } else {
        reject(err)
      }
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `mongodump exited with code ${code}`))
    })
  })

const listBackupObjects = async (prefix) => {
  const objects = []
  let token
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.AWS_S3_BUCKET,
        Prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
        ContinuationToken: token,
      }),
    )
    for (const item of res.Contents || []) {
      if (item.Key && !item.Key.endsWith('/')) objects.push(item)
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return objects
}

const enforceRetention = async (prefix) => {
  const max = env.DB_BACKUP_RETENTION_COUNT
  const objects = await listBackupObjects(prefix)
  if (objects.length <= max) return { deleted: 0, kept: objects.length }

  objects.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified))
  const toDelete = objects.slice(max)
  for (const obj of toDelete) {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: env.AWS_S3_BUCKET,
        Key: obj.Key,
      }),
    )
  }
  return { deleted: toDelete.length, kept: max }
}

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * Full DB dump → S3 → retention (max N) → email with presigned download link.
 */
const runDbBackup = async ({ trigger = 'manual' } = {}) => {
  if (!env.DB_BACKUP_ENABLED) {
    return { skipped: true, reason: 'DB_BACKUP_ENABLED is false' }
  }
  if (!isBackupConfigured()) {
    return { skipped: true, reason: 'Missing MONGO_URI or AWS S3 configuration' }
  }
  if (backupRunning) {
    return { skipped: true, reason: 'Backup already in progress' }
  }

  backupRunning = true
  const startedAt = Date.now()
  let tmpDir
  let archivePath

  try {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mr-storage-db-backup-'))
    archivePath = path.join(tmpDir, 'dump.archive.gz')

    await runMongodump(archivePath)
    const stat = await fsp.stat(archivePath)
    const fileBuffer = await fsp.readFile(archivePath)

    const now = new Date()
    const dateLabel = now.toISOString().slice(0, 10)
    const stamp = now.toISOString().replace(/[:.]/g, '-')
    const prefix = env.DB_BACKUP_S3_PREFIX.replace(/\/$/, '')
    const s3Key = `${prefix}/${dateLabel}/mr-storage-${stamp}.archive.gz`

    await s3.send(
      new PutObjectCommand({
        Bucket: env.AWS_S3_BUCKET,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: 'application/gzip',
        ServerSideEncryption: 'AES256',
        Metadata: {
          'backup-date': dateLabel,
          environment: env.NODE_ENV,
          trigger: String(trigger),
        },
      }),
    )

    let retention = { deleted: 0, kept: null, warning: null }
    try {
      retention = await enforceRetention(prefix)
    } catch (retentionErr) {
      retention.warning = retentionErr.message
      console.warn('[dbBackup] retention skipped:', retentionErr.message)
    }

    const downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: env.AWS_S3_BUCKET,
        Key: s3Key,
      }),
      { expiresIn: env.DB_BACKUP_PRESIGN_EXPIRY_SEC },
    )

    const s3Uri = `s3://${env.AWS_S3_BUCKET}/${s3Key}`
    const publicStyleUrl = `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${s3Key}`

    await sendDbBackupNotification({
      dateLabel,
      dbName: dbNameFromUri(env.MONGO_URI),
      environment: env.NODE_ENV,
      s3Key,
      s3Uri,
      downloadUrl,
      publicStyleUrl,
      sizeLabel: formatBytes(stat.size),
      durationSec: Math.round((Date.now() - startedAt) / 1000),
      retentionDeleted: retention.deleted,
      retentionKept: retention.kept,
      retentionWarning: retention.warning,
    })

    console.log(
      `[dbBackup] OK key=${s3Key} size=${stat.size} retentionDeleted=${retention.deleted} trigger=${trigger}`,
    )

    return {
      ok: true,
      s3Key,
      downloadUrl,
      bytes: stat.size,
      retention,
    }
  } catch (err) {
    console.error('[dbBackup] failed:', err.message)
    try {
      await sendDbBackupFailureNotification({
        dateLabel: new Date().toISOString().slice(0, 10),
        environment: env.NODE_ENV,
        errorMessage: err.message,
        trigger,
      })
    } catch (mailErr) {
      console.error('[dbBackup] failure email error:', mailErr.message)
    }
    throw err
  } finally {
    backupRunning = false
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

module.exports = {
  runDbBackup,
  isBackupConfigured,
  isAwsConfigured,
}
