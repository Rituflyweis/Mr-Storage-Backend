const multer = require('multer')

const xlsxMime = (file) =>
  file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
  file.mimetype === 'application/octet-stream' ||
  file.originalname?.toLowerCase().endsWith('.xlsx')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(xlsxMime(file) ? null : new Error('Only .xlsx Excel files are supported'), xlsxMime(file))
  },
})

/** Accept Excel on common multipart field names (no FE rename required). */
const leadImportUpload = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'csv', maxCount: 1 },
  { name: 'excel', maxCount: 1 },
  { name: 'document', maxCount: 1 },
])

module.exports = leadImportUpload
