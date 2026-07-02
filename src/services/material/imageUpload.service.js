const { randomUUID } = require('crypto')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const env = require('../../config/env')

const ensureS3Config = () => {
  if (!env.AWS_S3_BUCKET || !env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS S3 is not configured. Set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_S3_BUCKET.')
  }
}

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
})

const getFileExtension = (filename = '') => {
  const lastPart = filename.split('.').pop()
  if (!lastPart || lastPart === filename) return 'bin'
  return lastPart.toLowerCase()
}

const uploadImage = async(file) => {
  if (!file) return null

  ensureS3Config()

  const ext = getFileExtension(file.originalname)
  const key = `material/${Date.now()}-${randomUUID()}.${ext}`

  await s3.send(new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }))

  return `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`
}

module.exports = {
  uploadImage,
}
