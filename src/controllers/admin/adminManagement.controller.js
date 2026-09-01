const bcrypt = require('bcryptjs')
const User = require('../../models/User')
const auditService = require('../../services/audit.service')
const mailer = require('../../services/email/mailer')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS } = require('../../config/constants')

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
  if (isActive !== undefined) userPayload.isActive = Boolean(isActive)

  const user = await User.create(userPayload)

  await mailer.sendEmployeeCredentials({
    toEmail: user.email,
    name: user.name,
    role: user.role,
    tempPassword: password,
  })

  await auditService.log({
    type: 'user',
    action: AUDIT_ACTIONS.ADMIN_CREATED,
    performedBy: req.user._id,
    metadata: {
      adminUserId: String(user._id),
      email: user.email,
      name: user.name,
      isActive: user.isActive,
    },
  })

  return created(res, { admin: user }, 'Admin user created')
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
    if (admin.isMainAdmin && isActive === false) {
      return badRequest(res, 'Main admin cannot be deactivated')
    }
    admin.isActive = Boolean(isActive)
    changes.isActive = Boolean(isActive)
  }

  await admin.save()

  await auditService.log({
    type: 'user',
    action: AUDIT_ACTIONS.ADMIN_UPDATED,
    performedBy: req.user._id,
    metadata: {
      adminUserId: String(admin._id),
      changes,
    },
  })

  return success(res, { admin }, 'Admin user updated')
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
