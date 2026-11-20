const bcrypt = require("bcryptjs");
const Customer = require("../models/Customer");

/**
 * Add or replace email and phone on a customer that may have neither.
 * A blank email or phone leaves the saved value as it is, so a form that posts
 * empty boxes does not block the rest of the save and does not clear a contact.
 * A duplicate email is rejected.
 * Returns { error } or { changed }.
 */
const applyCustomerContactUpdate = async (customer, body = {}) => {
  const { email, phone, countryCode } = body;
  if (email === undefined && phone === undefined && countryCode === undefined) {
    return { changed: false };
  }

  let changed = false;

  if (email !== undefined) {
    const normalizedEmail = String(email).toLowerCase().trim();
    if (normalizedEmail) {
      const emailTaken = await Customer.findOne({
        email: normalizedEmail,
        _id: { $ne: customer._id },
      })
        .select("_id")
        .lean();
      if (emailTaken)
        return { error: "Customer with this email already exists" };
      if (customer.email !== normalizedEmail) {
        customer.email = normalizedEmail;
        changed = true;
      }
    }
  }

  if (phone !== undefined) {
    const trimmedPhone = String(phone).trim();
    if (trimmedPhone) {
      const sentCode =
        countryCode !== undefined ? String(countryCode).trim() : "";
      const nextCode =
        sentCode || String(customer.phone?.countryCode || "").trim() || "+1";
      const sameNumber = customer.phone?.number === trimmedPhone;
      const sameCode = customer.phone?.countryCode === nextCode;
      if (!sameNumber || !sameCode) {
        customer.phone = { number: trimmedPhone, countryCode: nextCode };
        changed = true;
      }
      if (!customer.password) {
        customer.password = await bcrypt.hash(trimmedPhone, 12);
        changed = true;
      }
    }
  } else if (countryCode !== undefined) {
    const nextCode = String(countryCode).trim();
    const number = String(customer.phone?.number || "").trim();
    if (nextCode && number && customer.phone?.countryCode !== nextCode) {
      customer.phone = { number, countryCode: nextCode };
      changed = true;
    }
  }

  return { changed };
};

const manualContactValues = (body = {}) => ({
  email: body.email == null ? "" : String(body.email).trim().toLowerCase(),
  phone: body.phone == null ? "" : String(body.phone).trim(),
  countryCode:
    body.countryCode == null ? "" : String(body.countryCode).trim(),
});

/**
 * Fields for a new customer. Email and phone are omitted when the form left them blank.
 * A provided email must be unique. A provided phone becomes the initial password.
 */
const buildManualCustomerContact = async (body = {}) => {
  const { email, phone, countryCode } = manualContactValues(body);
  const fields = {};

  if (email) {
    const emailTaken = await Customer.findOne({ email }).select("_id").lean();
    if (emailTaken) return { error: "Customer with this email already exists" };
    fields.email = email;
  }

  if (phone) {
    fields.phone = { number: phone, countryCode: countryCode || "+1" };
    fields.password = await bcrypt.hash(phone, 12);
  }

  return { fields };
};

/**
 * When a manual lead form includes an email or phone, save it on the customer.
 * Blank values are ignored so the create still succeeds.
 */
const saveManualContactOnCustomer = async (customer, body = {}) => {
  const { email, phone, countryCode } = manualContactValues(body);
  if (!email && !phone) return {};

  const contact = await applyCustomerContactUpdate(customer, {
    ...(email ? { email } : {}),
    ...(phone ? { phone, countryCode: countryCode || "+1" } : {}),
  });
  if (contact.error) return contact;
  if (contact.changed) await customer.save();
  return {};
};

module.exports = {
  applyCustomerContactUpdate,
  buildManualCustomerContact,
  saveManualContactOnCustomer,
};
