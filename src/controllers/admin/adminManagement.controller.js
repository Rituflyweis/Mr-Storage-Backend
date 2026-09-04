const bcrypt = require('bcryptjs')
const User = require('../../models/User')
const auditService = require('../../services/audit.service')
const mailer = require('../../services/email/mailer')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS } = require('../../config/constants')
const EMAIL_SEND_TIMEOUT_MS = 5000

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false
  return fallback
}

const getRequester = async (req) =>
  User.findById(req.user._id).select('_id role isMainAdmin name email isActive')

const requireMainAdmin = async (req, res) => {
  const requester = await getRequester(req)
  if (!requester || requester.role !== 'admin') {
    forbidden(res, 'Only admins can perform this action')
    return null
  }
  if (!requester.isMainAdmin) {
    forbidden(res, 'Only main admin can manage admin users')
    return null
  }
  return requester
}

exports.setCurrentAdminAsMain = asyncHandler(async (req, res) => {
  const requester = await getRequester(req)
  if (!requester || requester.role !== 'admin') return forbidden(res, 'Only admins can perform this action')

  const existingMain = await User.findOne({ role: 'admin', isMainAdmin: true }).select('_id name email')
  if (existingMain && String(existingMain._id) !== String(requester._id)) {
    return forbidden(
      res,
      `Main admin already assigned to ${existingMain.name || existingMain.email}. Ask current main admin to transfer access.`
    )
  }

  if (requester.isMainAdmin) {
    return success(res, { admin: requester }, 'You are already the main admin')
  }

  requester.isMainAdmin = true
  await requester.save()

  await auditService.log({
    type: 'user',
    action: AUDIT_ACTIONS.ADMIN_MAIN_ASSIGNED,
    performedBy: req.user._id,
    metadata: {
      targetAdminId: String(requester._id),
      targetEmail: requester.email,
      source: 'self_assign',
    },
  })

  return success(res, { admin: requester }, 'Main admin access enabled')
})

exports.listAdmins = asyncHandler(async (req, res) => {
  const requester = await requireMainAdmin(req, res)
  if (!requester) return

  const admins = await User.find({ role: 'admin' }).select('-password').sort({ createdAt: -1 }).lean()
  return success(res, {
    admins,
    summary: {
      total: admins.length,
      active: admins.filter((a) => a.isActive).length,
      mainAdminId: admins.find((a) => a.isMainAdmin)?._id || null,
    },
  })
})

exports.createAdmin = asyncHandler(async (req, res) => {
  const requester = await requireMainAdmin(req, res)
  if (!requester) return

  const { name, email, phone, password, department, permissions, isActive } = req.body
  const normalizedEmail = String(email || '').toLowerCase().trim()
  const exists = await User.findOne({ email: normalizedEmail })
  if (exists) return badRequest(res, 'Email already in use')

  const hashed = await bcrypt.hash(password, 12)
  const userPayload = {
    name,
    email: normalizedEmail,
    password: hashed,
    phone,
    role: 'admin',
    isMainAdmin: false,
  }
  if (department !== undefined) userPayload.department = department
  if (permissions !== undefined) userPayload.permissions = permissions
  if (isActive !== undefined) userPayload.isActive = toBoolean(isActive, true)

  const user = await User.create(userPayload)

  let credentialsEmailSent = true
  let credentialsEmailWarning = null
  try {
    const emailSendResult = await Promise.race([
      mailer
        .sendEmployeeCredentials({
          toEmail: user.email,
          name: user.name,
          role: user.role,
          tempPassword: password,
        })
        .then(() => ({ ok: true }))
        .catch((err) => ({ ok: false, err })),
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ ok: false, err: new Error('Admin credentials email timed out') }),
          EMAIL_SEND_TIMEOUT_MS
        )
      ),
    ])

    if (!emailSendResult?.ok) {
      credentialsEmailSent = false
      credentialsEmailWarning = emailSendResult?.err?.message || 'Failed to send admin credentials email'
      console.error('[AdminManagement] send credentials failed:', credentialsEmailWarning)
    }
  } catch (err) {
    credentialsEmailSent = false
    credentialsEmailWarning = err.message || 'Failed to send admin credentials email'
    console.error('[AdminManagement] send credentials failed:', credentialsEmailWarning)
  }

  await auditService.log({
    type: 'user',
    action: AUDIT_ACTIONS.ADMIN_CREATED,
    performedBy: req.user._id,
    metadata: {
      adminUserId: String(user._id),
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      credentialsEmailSent,
      credentialsEmailWarning,
    },
  })

  return created(
    res,
    { admin: user, credentialsEmailSent, credentialsEmailWarning },
    credentialsEmailSent
      ? 'Admin user created'
      : 'Admin user created, but credentials email could not be sent'
  )
})

exports.updateAdmin = asyncHandler(async (req, res) => {
  const requester = await requireMainAdmin(req, res)
  if (!requester) return

  const admin = await User.findById(req.params.adminId)
  if (!admin || admin.role !== 'admin') return notFound(res, 'Admin user not found')
  if (admin.isMainAdmin && String(admin._id) !== String(requester._id)) {
    return badRequest(res, 'Cannot edit another main admin')
  }

  const { name, email, phone, department, permissions, isActive } = req.body
  const changes = {}

  if (email !== undefined) {
    const normalizedEmail = String(email).toLowerCase().trim()
    if (normalizedEmail !== admin.email) {
      const exists = await User.findOne({ email: normalizedEmail, _id: { $ne: admin._id } })
      if (exists) return badRequest(res, 'Email already in use')
      admin.email = normalizedEmail
      changes.email = normalizedEmail
    }
  }
  if (name !== undefined) {
    admin.name = name
    changes.name = name
  }
  if (phone !== undefined) {
    admin.phone = phone
    changes.phone = phone
  }
  if (department !== undefined) {
    admin.department = department
    changes.department = department
  }
  if (permissions !== undefined) {
    admin.permissions = permissions
    changes.permissionsUpdated = true
  }
  if (isActive !== undefined) {
    const nextIsActive = toBoolean(isActive, true)
    if (admin.isMainAdmin && nextIsActive === false) {
      return badRequest(res, 'Main admin cannot be deactivated')
    }
    admin.isActive = nextIsActive
    changes.isActive = nextIsActive
  }

  let credentialsEmailSent = true
  let credentialsEmailWarning = null
  if (changes.email) {
    const tempPassword =
      Math.random().toString(36).slice(-6) +
      Math.random().toString(36).slice(-4).toUpperCase()
    admin.password = await bcrypt.hash(tempPassword, 12)
    admin.passwordChangedAt = new Date()
    changes.credentialsRegenerated = true

    try {
      const emailSendResult = await Promise.race([
        mailer
          .sendEmployeeCredentials({
            toEmail: admin.email,
            name: admin.name,
            role: admin.role,
            tempPassword,
          })
          .then(() => ({ ok: true }))
          .catch((err) => ({ ok: false, err })),
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ ok: false, err: new Error('Updated credentials email timed out') }),
            EMAIL_SEND_TIMEOUT_MS
          )
        ),
      ])

      if (!emailSendResult?.ok) {
        credentialsEmailSent = false
        credentialsEmailWarning = emailSendResult?.err?.message || 'Failed to send updated credentials email'
        console.error('[AdminManagement] send updated credentials failed:', credentialsEmailWarning)
      }
    } catch (err) {
      credentialsEmailSent = false
      credentialsEmailWarning = err.message || 'Failed to send updated credentials email'
      console.error('[AdminManagement] send updated credentials failed:', credentialsEmailWarning)
    }
  }

  await admin.save()

  await auditService.log({
    type: 'user',
    action: AUDIT_ACTIONS.ADMIN_UPDATED,
    performedBy: req.user._id,
    metadata: {
      adminUserId: String(admin._id),
      changes,
      credentialsEmailSent,
      credentialsEmailWarning,
    },
  })

  return success(
    res,
    { admin, credentialsEmailSent, credentialsEmailWarning },
    credentialsEmailSent
      ? 'Admin user updated'
      : 'Admin user updated, but updated credentials email could not be sent'
  )
})

exports.toggleAdminStatus = asyncHandler(async (req, res) => {
  const requester = await requireMainAdmin(req, res)
  if (!requester) return

  const admin = await User.findById(req.params.adminId)
  if (!admin || admin.role !== 'admin') return notFound(res, 'Admin user not found')
  if (admin.isMainAdmin) return badRequest(res, 'Main admin status cannot be toggled')

  admin.isActive = !admin.isActive
  await admin.save()

  await auditService.log({
    type: 'user',
    action: AUDIT_ACTIONS.ADMIN_STATUS_TOGGLED,
    performedBy: req.user._id,
    metadata: {
      adminUserId: String(admin._id),
      isActive: admin.isActive,
    },
  })

  return success(res, { admin }, `Admin marked ${admin.isActive ? 'active' : 'inactive'}`)
})

exports.deleteAdmin = asyncHandler(async (req, res) => {
  const requester = await requireMainAdmin(req, res)
  if (!requester) return

  const admin = await User.findById(req.params.adminId)
  if (!admin || admin.role !== 'admin') return notFound(res, 'Admin user not found')
  if (admin.isMainAdmin) return badRequest(res, 'Main admin cannot be deleted')
  if (String(admin._id) === String(requester._id)) return badRequest(res, 'You cannot delete your own account')

  await User.findByIdAndDelete(admin._id)

  await auditService.log({
    type: 'user',
    action: AUDIT_ACTIONS.ADMIN_DELETED,
    performedBy: req.user._id,
    metadata: {
      adminUserId: String(admin._id),
      email: admin.email,
      name: admin.name,
    },
  })

  return success(res, {}, 'Admin user deleted')
})

exports.transferMainAdmin = asyncHandler(async (req, res) => {
  const requester = await requireMainAdmin(req, res)
  if (!requester) return

  const target = await User.findById(req.params.adminId)
  if (!target || target.role !== 'admin') return notFound(res, 'Admin user not found')
  if (!target.isActive) return badRequest(res, 'Cannot set inactive user as main admin')
  if (String(target._id) === String(requester._id)) {
    return success(res, { mainAdmin: requester }, 'You are already the main admin')
  }

  requester.isMainAdmin = false
  target.isMainAdmin = true
  await requester.save()
  await target.save()

  await auditService.log({
    type: 'user',
    action: AUDIT_ACTIONS.ADMIN_MAIN_ASSIGNED,
    performedBy: req.user._id,
    metadata: {
      previousMainAdminId: String(requester._id),
      newMainAdminId: String(target._id),
      source: 'transfer',
    },
  })

  return success(res, { previousMainAdmin: requester, mainAdmin: target }, 'Main admin transferred')
})
