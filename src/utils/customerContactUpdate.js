const bcrypt = require('bcryptjs')
const Customer = require('../models/Customer')

/**
 * Add or replace email and phone on a customer that may have neither.
 * Blank values are rejected. A duplicate email is rejected.
 * Returns { error } or { changed }.
 */
const applyCustomerContactUpdate = async (customer, body = {}) => {
  const { email, phone, countryCode } = body
  if (email === undefined && phone === undefined && countryCode === undefined) {
    return { changed: false }
  }

  if (email !== undefined) {
    const normalizedEmail = String(email).toLowerCase().trim()
    if (!normalizedEmail) {
      if (customer.email) return { error: 'email cannot be empty' }
    } else {
      const emailTaken = await Customer.findOne({
        email: normalizedEmail,
        _id: { $ne: customer._id },
      }).select('_id').lean()
      if (emailTaken) return { error: 'Customer with this email already exists' }
      customer.email = normalizedEmail
    }
  }

  if (phone !== undefined) {
    const trimmedPhone = String(phone).trim()
    if (!trimmedPhone) {
      if (customer.phone?.number) return { error: 'phone cannot be empty' }
    } else {
      const nextCode = countryCode !== undefined
        ? String(countryCode).trim()
        : String(customer.phone?.countryCode || '').trim()
      customer.phone = {
        number: trimmedPhone,
        countryCode: nextCode || '+1',
      }
      if (!customer.password) {
        customer.password = await bcrypt.hash(trimmedPhone, 12)
      }
    }
  } else if (countryCode !== undefined) {
    const number = String(customer.phone?.number || '').trim()
    if (!number) return { error: 'Add a phone number before setting the country code' }
    customer.phone = {
      number,
      countryCode: String(countryCode).trim() || '+1',
    }
  }

  return { changed: true }
}

module.exports = { applyCustomerContactUpdate }
