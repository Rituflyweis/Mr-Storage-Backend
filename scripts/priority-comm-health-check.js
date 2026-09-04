#!/usr/bin/env node
/* eslint-disable no-console */
require("dotenv").config();

const mongoose = require("mongoose");
const { MONGO_URI } = require("../src/config/env");
const FollowUpDispatchLog = require("../src/models/FollowUpDispatchLog");
const FollowUp = require("../src/models/FollowUp");
const {
  getOrCreateConfig,
  runAutomationSweep,
} = require("../src/services/followup/followUpAutomation.service");
const { isTwilioConfigured } = require("../src/services/sms/sms.service");
const { isEmailConfigured, sendOtp } = require("../src/services/email/mailer");

const args = new Set(process.argv.slice(2));
const shouldRunSweep = args.has("--run-sweep");
const shouldTestOtp = args.has("--test-otp");
const otpEmail = process.env.OTP_TEST_EMAIL || "";

const WINDOW_HOURS = Number(process.env.FOLLOWUP_HEALTH_WINDOW_HOURS || 24);

const printHeader = (title) => {
  console.log(`\n=== ${title} ===`);
};

const summarizeDispatches = async (sinceDate) => {
  const rows = await FollowUpDispatchLog.aggregate([
    { $match: { createdAt: { $gte: sinceDate } } },
    {
      $group: {
        _id: { kind: "$kind", channel: "$channel", status: "$status" },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.kind": 1, "_id.channel": 1, "_id.status": 1 } },
  ]);

  if (!rows.length) {
    console.log("No dispatch logs found in the selected window.");
    return;
  }

  rows.forEach((row) => {
    const key = `${row._id.kind} | ${row._id.channel} | ${row._id.status}`;
    console.log(`${key}: ${row.count}`);
  });
};

const summarizeFollowUps = async (sinceDate) => {
  const rows = await FollowUp.aggregate([
    { $match: { createdAt: { $gte: sinceDate } } },
    { $group: { _id: "$source", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  if (!rows.length) {
    console.log("No follow-up records created in the selected window.");
    return;
  }

  rows.forEach((row) => {
    console.log(`${row._id || "unknown"}: ${row.count}`);
  });
};

const run = async () => {
  await mongoose.connect(MONGO_URI);
  const sinceDate = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

  printHeader("Channel configuration");
  console.log(`Email configured: ${isEmailConfigured() ? "YES" : "NO"}`);
  console.log(`Twilio configured: ${isTwilioConfigured() ? "YES" : "NO (SMS stub mode)"}`);

  const config = await getOrCreateConfig();
  printHeader("Automation toggles");
  console.log(`chatDropOff.enabled: ${Boolean(config.chatDropOff?.enabled)}`);
  console.log(`warmLead.enabled: ${Boolean(config.leadFollowUp?.warm?.enabled)}`);
  console.log(`coldLead.enabled: ${Boolean(config.leadFollowUp?.cold?.enabled)}`);
  console.log(`invoiceReminder.enabled: ${Boolean(config.invoiceReminder?.enabled)}`);
  console.log(`channels.sms: ${Boolean(config.channels?.sms)}`);
  console.log(`channels.email: ${Boolean(config.channels?.email)}`);

  if (shouldRunSweep) {
    printHeader("Automation sweep");
    const sweep = await runAutomationSweep();
    console.log(JSON.stringify(sweep, null, 2));
  }

  printHeader(`Dispatch logs in last ${WINDOW_HOURS}h`);
  await summarizeDispatches(sinceDate);

  printHeader(`Follow-up records in last ${WINDOW_HOURS}h`);
  await summarizeFollowUps(sinceDate);

  if (shouldTestOtp) {
    printHeader("OTP smoke test");
    if (!otpEmail) {
      console.log("Skipped: set OTP_TEST_EMAIL env var to run --test-otp.");
    } else {
      try {
        await sendOtp({
          toEmail: otpEmail,
          name: "Health Check",
          otp: "123456",
          expiresInMinutes: 10,
        });
        console.log(`OTP send call succeeded for ${otpEmail}`);
      } catch (err) {
        console.log(`OTP send failed for ${otpEmail}: ${err.message}`);
      }
    }
  }
};

run()
  .catch((err) => {
    console.error("[priority-comm-health-check] Failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.connection.close();
    } catch (_) {
      // no-op
    }
  });

