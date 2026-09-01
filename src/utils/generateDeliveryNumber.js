const Delivery = require('../models/Delivery')
const { allocatePrefixedCode } = require('./allocateSequentialId')

const generateDeliveryNumber = async () =>
  allocatePrefixedCode({
    model: Delivery,
    field: 'deliveryNumber',
    prefix: 'DEL',
    pad: 4,
  })

module.exports = generateDeliveryNumber
