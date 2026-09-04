const ISO_OFFSET_RE = /[+-]\d{2}:\d{2}$/;
const ISO_Z_RE = /Z$/i;
const ISO_LOCAL_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(?:Z)?$/i;

const isValidTimeZone = (timeZone) => {
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch (_) {
    return false;
  }
};

const getOffsetMsAt = (date, timeZone) => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
    0,
  );
  return asUtc - date.getTime();
};

const wallTimeToUtcDate = (components, timeZone) => {
  const { year, month, day, hour, minute, second, millisecond } = components;
  const wallUtcTs = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );

  // Iterative solve for timezone offset (handles DST transitions).
  let ts = wallUtcTs;
  for (let i = 0; i < 3; i += 1) {
    const offset = getOffsetMsAt(new Date(ts), timeZone);
    ts = wallUtcTs - offset;
  }
  return new Date(ts);
};

const parseIsoLocalComponents = (raw) => {
  const m = String(raw || "").trim().match(ISO_LOCAL_RE);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] || 0),
    minute: Number(m[5] || 0),
    second: Number(m[6] || 0),
    millisecond: Number((m[7] || "0").padEnd(3, "0")),
  };
};

const resolveFollowUpDate = (input, { timezone = "UTC" } = {}) => {
  if (!input) return { date: null, timezoneUsed: timezone, mode: "invalid" };
  if (input instanceof Date) {
    return { date: input, timezoneUsed: timezone, mode: "date_object" };
  }

  const raw = String(input).trim();
  if (!raw) return { date: null, timezoneUsed: timezone, mode: "invalid" };

  // Explicit numeric timezone offset should always be trusted.
  if (ISO_OFFSET_RE.test(raw)) {
    const date = new Date(raw);
    return {
      date: Number.isNaN(date.getTime()) ? null : date,
      timezoneUsed: timezone,
      mode: "explicit_offset",
    };
  }

  const zone = isValidTimeZone(timezone) ? timezone : "UTC";
  const comps = parseIsoLocalComponents(raw);

  // Backend compatibility mode:
  // If frontend sends floating local time (or local time with forced "Z"),
  // interpret it in configured business timezone to avoid UTC shifts.
  if (comps && (ISO_Z_RE.test(raw) || !/[zZ]|[+-]\d{2}:\d{2}$/.test(raw))) {
    return {
      date: wallTimeToUtcDate(comps, zone),
      timezoneUsed: zone,
      mode: ISO_Z_RE.test(raw) ? "forced_z_interpreted_in_zone" : "floating_interpreted_in_zone",
    };
  }

  const parsed = new Date(raw);
  return {
    date: Number.isNaN(parsed.getTime()) ? null : parsed,
    timezoneUsed: zone,
    mode: "native_parse",
  };
};

module.exports = {
  isValidTimeZone,
  resolveFollowUpDate,
};
