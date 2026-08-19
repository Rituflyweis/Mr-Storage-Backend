const { allocatePrefixedCode } = require('./allocateSequentialId')

const generateJobId = async () => {
  const Lead = require('../models/Lead')
  return allocatePrefixedCode({
    model: Lead,
    field: 'jobId',
    prefix: 'PRO',
    pad: 3,
    includeDeleted: true,
  })
}

module.exports = generateJobId
