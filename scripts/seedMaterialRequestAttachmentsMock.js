const mongoose = require('mongoose')
require('dotenv').config()
const MaterialRequest = require('../src/models/MaterialRequest')

async function run() {
  await mongoose.connect(process.env.MONGO_URI)

  const r = await MaterialRequest.findById('6a5e1c0b3c268565f3e0e958')
  if (!r) {
    console.log('Material request not found')
    process.exit(1)
  }

  r.attachments = [
    { name: 'material-list.pdf', url: 'https://mr-storage-project.s3.ap-south-1.amazonaws.com/documents/sample-material-request-list.pdf' },
    { name: 'site-photo.jpg', url: 'https://mr-storage-project.s3.ap-south-1.amazonaws.com/documents/sample-material-request-photo.jpg' },
  ]
  await r.save()

  console.log('updated:', r._id.toString(), JSON.stringify(r.attachments))
  process.exit(0)
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
