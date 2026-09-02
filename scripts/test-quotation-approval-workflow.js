const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const { JWT_ACCESS_SECRET } = require("../src/config/env");
const User = require("../src/models/User");
const Customer = require("../src/models/Customer");
const Lead = require("../src/models/Lead");
const Quotation = require("../src/models/Quotation");

const API_BASE = "http://127.0.0.1:5001/api";

const asToken = (user) =>
  jwt.sign(
    { _id: String(user._id), email: user.email, role: user.role, name: user.name },
    JWT_ACCESS_SECRET,
    { expiresIn: "2h" },
  );

const callApi = async ({ method = "GET", path, token, body }) => {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch (_) {}
  return { status: res.status, ok: res.ok, json };
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const run = async () => {
  await connectDB();
  const stamp = Date.now();
  const report = { startedAt: new Date().toISOString(), scenarios: [] };

  const admin = await User.findOne({ role: "admin", isActive: true }).lean();
  const sales = await User.findOne({ role: "sales", isActive: true }).lean();
  assert(admin, "No active admin user found");
  assert(sales, "No active sales user found");

  const adminToken = asToken(admin);
  const salesToken = asToken(sales);
  const created = { customers: [], leads: [], quotations: [] };

  const scenario = async (name, fn) => {
    try {
      await fn();
      report.scenarios.push({ name, status: "PASS" });
    } catch (err) {
      report.scenarios.push({ name, status: "FAIL", error: err.message });
    }
  };

  try {
    const customer = await Customer.create({
      customerId: `QAPPR-CUST-${stamp}`,
      firstName: "Quotation",
      lastName: `Flow${stamp}`,
      email: `quotation.flow.${stamp}@example.com`,
      phone: { number: "5551112233", countryCode: "+1" },
      password: "hashed_test_password",
      source: "manual",
      company: "Quotation QA",
      location: "Test City",
    });
    created.customers.push(customer._id);

    const lead = await Lead.create({
      customerId: customer._id,
      assignedSales: sales._id,
      source: "manual",
      projectName: `Quotation Approval ${stamp}`,
      lifecycleStatus: "proposal_sent",
      isQuoteReady: true,
      isHandedToSales: true,
    });
    created.leads.push(lead._id);

    let quotationId = null;

    await scenario("Sales create quotation auto-submits pending approval", async () => {
      const r = await callApi({
        method: "POST",
        path: "/quotations",
        token: salesToken,
        body: {
          leadId: String(lead._id),
          width: 20,
          length: 50,
          materialCost: 10000,
          freightCost: 1000,
          markupPercent: 20,
          buildingType: "PEMB",
          basePrice: 13200,
        },
      });
      assert(r.status === 201, `Expected 201, got ${r.status}`);
      quotationId = r.json?.data?.quotation?._id;
      assert(quotationId, "Missing quotation ID");
      created.quotations.push(quotationId);
      assert(r.json?.data?.quotation?.approval?.status === "pending_approval", "Expected pending_approval");
      assert(r.json?.data?.quotation?.workflowStatus === "pending_approval", "Expected workflow pending_approval");
    });

    await scenario("Sales cannot send quotation before admin approval", async () => {
      const r = await callApi({
        method: "POST",
        path: `/quotations/${quotationId}/send`,
        token: salesToken,
      });
      assert(r.status === 400, `Expected 400, got ${r.status}`);
      assert(String(r.json?.message || "").toLowerCase().includes("approved"), "Expected approval block message");
    });

    await scenario("Admin sees quotation in pending queue", async () => {
      const r = await callApi({
        path: "/quotations/approval/pending",
        token: adminToken,
      });
      assert(r.status === 200, `Expected 200, got ${r.status}`);
      const found = (r.json?.data?.quotations || []).some((q) => String(q._id) === String(quotationId));
      assert(found, "Expected quotation in pending approval list");
    });

    await scenario("Admin approves quotation", async () => {
      const r = await callApi({
        method: "PUT",
        path: `/quotations/${quotationId}/approve`,
        token: adminToken,
        body: { note: "Approved in QA test" },
      });
      assert(r.status === 200, `Expected 200, got ${r.status}`);
      assert(r.json?.data?.quotation?.approval?.status === "approved", "Expected approved");
      assert(r.json?.data?.quotation?.workflowStatus === "approved", "Expected workflow approved");
    });

    await scenario("Sales can send quotation after admin approval", async () => {
      const r = await callApi({
        method: "POST",
        path: `/quotations/${quotationId}/send`,
        token: salesToken,
      });
      assert(r.status === 200, `Expected 200, got ${r.status} (${r.json?.message || "no message"})`);
      assert(r.json?.data?.quotation?.status === "sent", "Expected sent status");
      assert(r.json?.data?.quotation?.workflowStatus === "sent", "Expected workflow sent");
      assert(
        ["sendgrid", "smtp_fallback", "unknown"].includes(String(r.json?.data?.emailProvider || "")),
        "Expected email provider in response",
      );
    });

    await scenario("Admin can reject pending quotation", async () => {
      const rCreate = await callApi({
        method: "POST",
        path: "/quotations",
        token: salesToken,
        body: {
          leadId: String(lead._id),
          width: 30,
          length: 60,
          materialCost: 7000,
          freightCost: 900,
          markupPercent: 15,
          buildingType: "PEMB",
        },
      });
      assert(rCreate.status === 201, `Expected 201, got ${rCreate.status}`);
      const id2 = rCreate.json?.data?.quotation?._id;
      assert(id2, "Missing second quotation id");
      created.quotations.push(id2);

      const rReject = await callApi({
        method: "PUT",
        path: `/quotations/${id2}/reject`,
        token: adminToken,
        body: { reason: "Fix building details" },
      });
      assert(rReject.status === 200, `Expected 200, got ${rReject.status}`);
      assert(rReject.json?.data?.quotation?.approval?.status === "rejected", "Expected rejected");
    });

    await scenario("Editing rejected quotation resets to not_submitted", async () => {
      const q = await Quotation.findOne({ leadId: lead._id, "approval.status": "rejected" }).sort({ createdAt: -1 }).lean();
      assert(q, "Expected rejected quotation row");
      const r = await callApi({
        method: "PUT",
        path: `/quotations/${q._id}`,
        token: salesToken,
        body: { basePrice: Number(q.basePrice || 0) + 500, changeNote: "Updated after rejection" },
      });
      assert(r.status === 200, `Expected 200, got ${r.status}`);
      assert(r.json?.data?.quotation?.approval?.status === "not_submitted", "Expected not_submitted after edit");
    });

    await scenario("Sales can re-submit edited quotation", async () => {
      const q = await Quotation.findOne({ leadId: lead._id, "approval.status": "not_submitted" }).sort({ createdAt: -1 }).lean();
      assert(q, "Expected not_submitted quotation row");
      const r = await callApi({
        method: "POST",
        path: `/quotations/${q._id}/submit-approval`,
        token: salesToken,
        body: { note: "Resubmitted after fixing requested points" },
      });
      assert(r.status === 200, `Expected 200, got ${r.status}`);
      assert(r.json?.data?.quotation?.approval?.status === "pending_approval", "Expected pending_approval on resubmit");
    });
  } finally {
    if (created.quotations.length) await Quotation.deleteMany({ _id: { $in: created.quotations } });
    if (created.leads.length) await Lead.deleteMany({ _id: { $in: created.leads } });
    if (created.customers.length) await Customer.deleteMany({ _id: { $in: created.customers } });
  }

  report.finishedAt = new Date().toISOString();
  report.passCount = report.scenarios.filter((s) => s.status === "PASS").length;
  report.failCount = report.scenarios.filter((s) => s.status === "FAIL").length;
  console.log(JSON.stringify(report, null, 2));
  await mongoose.connection.close();
  process.exit(report.failCount ? 1 : 0);
};

run().catch(async (err) => {
  console.error("[QUOTATION_APPROVAL_TEST_FAILED]", err.message);
  try {
    await mongoose.connection.close();
  } catch (_) {}
  process.exit(1);
});
