const fullName = (firstName, lastName) =>
  `${firstName || ''} ${lastName || ''}`.trim()

/** Staff profile shape — admin, sales, plant, construction, account */
const shapeStaffProfile = (user) => {
  if (!user) return null
  const profile = {
    _id: user._id,
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    mobile: user.mobile || '',
    avatar: user.avatar || '',
    role: user.role,
    department: user.department || '',
    isActive: user.isActive !== false,
    notificationSettings: user.notificationSettings || {},
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
  if (user.role === 'admin') profile.isMainAdmin = Boolean(user.isMainAdmin)
  return profile
}

/** Customer portal profile shape */
const shapeCustomerProfile = (customer) => {
  if (!customer) return null
  return {
    _id: customer._id,
    customerId: customer.customerId || '',
    name: fullName(customer.firstName, customer.lastName),
    firstName: customer.firstName || '',
    lastName: customer.lastName || '',
    email: customer.email || '',
    phone: customer.phone || { number: '', countryCode: '' },
    mobile: customer.mobile || '',
    photo: customer.photo || null,
    company: customer.company || '',
    location: customer.location || '',
    isActive: customer.isActive !== false,
    source: customer.source || '',
    passwordChangedAt: customer.passwordChangedAt ?? null,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  }
}

const parseOptionalTrimmedString = (value) => {
  if (value === undefined) return undefined
  if (value === null) return ''
  return String(value).trim()
}

/** Accept phone string + countryCode, or { number, countryCode } */
const parseCustomerPhoneInput = (phone, countryCode) => {
  if (phone === undefined && countryCode === undefined) return undefined

  if (phone !== undefined && typeof phone === 'object' && phone !== null) {
    return {
      number: String(phone.number || '').trim(),
      countryCode: String(phone.countryCode || '+1').trim() || '+1',
    }
  }

  return {
    number: String(phone ?? '').trim(),
    countryCode: String(countryCode || '+1').trim() || '+1',
  }
}

const applyCustomerNameInput = (customer, { name, firstName, lastName }) => {
  if (firstName !== undefined) customer.firstName = String(firstName).trim()
  if (lastName !== undefined) customer.lastName = String(lastName).trim()

  if (name !== undefined) {
    const trimmed = String(name).trim()
    if (!trimmed) return 'Name cannot be empty'
    const spaceIdx = trimmed.indexOf(' ')
    if (spaceIdx === -1) {
      customer.firstName = trimmed
      customer.lastName = ''
    } else {
      customer.firstName = trimmed.slice(0, spaceIdx).trim()
      customer.lastName = trimmed.slice(spaceIdx + 1).trim()
    }
  }

  if (!customer.firstName) return 'Name cannot be empty'
  return null
}

module.exports = {
  shapeStaffProfile,
  shapeCustomerProfile,
  parseOptionalTrimmedString,
  parseCustomerPhoneInput,
  applyCustomerNameInput,
}
