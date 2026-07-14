const crypto = require("node:crypto");

const tokenEndpoint = "https://oauth2.googleapis.com/token";
const calendarScope = "https://www.googleapis.com/auth/calendar.events";

function isGoogleCalendarConfigured() {
  return Boolean(
    process.env.GOOGLE_CALENDAR_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY,
  );
}

async function createSolarisCalendarEvent(input) {
  const timeZone = process.env.GOOGLE_CALENDAR_TIMEZONE || "Asia/Kolkata";
  const event = normalizeCalendarEvent(input, timeZone);

  if (!isGoogleCalendarConfigured()) {
    return {
      sent: false,
      preview: true,
      configured: false,
      provider: "google-calendar",
      event,
      htmlLink: createGoogleCalendarTemplateLink(event),
      reason: "Google Calendar is not configured.",
    };
  }

  const accessToken = await getAccessToken();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data?.error?.message || `Google Calendar failed with HTTP ${response.status}.`);
    error.status = response.status;
    error.detail = data;
    throw error;
  }

  return {
    sent: true,
    preview: false,
    configured: true,
    provider: "google-calendar",
    eventId: data.id || "",
    htmlLink: data.htmlLink || "",
    event: data,
  };
}

async function getAccessToken() {
  const assertion = createServiceAccountJwt();
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    const error = new Error(data?.error_description || data?.error || "Google Calendar token request failed.");
    error.status = response.status;
    error.detail = data;
    throw error;
  }

  return data.access_token;
}

function createServiceAccountJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: calendarScope,
    aud: tokenEndpoint,
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY));
  return `${unsigned}.${base64url(signature)}`;
}

function normalizeCalendarEvent(input, timeZone) {
  const start = new Date(input.start || Date.now() + 60 * 60 * 1000);
  const durationMinutes = Number(input.durationMinutes || 60);
  const planType = String(input.planType || "Solaris Plan");
  const startDateTime = toGoogleCalendarLocalDateTime(input.start || start, timeZone);
  const endDateTime = input.end
    ? toGoogleCalendarLocalDateTime(input.end, timeZone)
    : addMinutesToLocalDateTime(startDateTime, durationMinutes);

  return {
    summary: String(input.summary || input.title || planType),
    description: String(input.description || "Solaris scheduled this plan for the customer."),
    start: {
      dateTime: startDateTime,
      timeZone,
    },
    end: {
      dateTime: endDateTime,
      timeZone,
    },
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: Number(input.reminderMinutes || 30) }],
    },
    extendedProperties: {
      private: {
        source: "Solaris",
        planType,
      },
    },
  };
}

function toGoogleCalendarLocalDateTime(value, timeZone) {
  if (typeof value === "string") {
    const localMatch = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/);
    if (localMatch) {
      return `${localMatch[1]}T${localMatch[2]}:${localMatch[3] || "00"}`;
    }
  }

  return formatGoogleCalendarLocalDateTime(new Date(value), timeZone);
}

function addMinutesToLocalDateTime(value, minutes) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return value;
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]) + Number(minutes || 0),
    Number(match[6]),
  ));
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
  ].join("-") + `T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}

function formatGoogleCalendarLocalDateTime(value, timeZone) {
  const parts = getZonedDateTimeParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function createGoogleCalendarTemplateLink(event) {
  const timeZone = event.start?.timeZone || event.end?.timeZone || "Asia/Kolkata";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.summary,
    dates: `${formatCalendarInstant(event.start.dateTime, timeZone)}/${formatCalendarInstant(event.end.dateTime, timeZone)}`,
    details: event.description,
    ctz: timeZone,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function formatCalendarInstant(value, timeZone) {
  const utc = localDateTimeToUtcDate(value, timeZone);
  return [
    utc.getUTCFullYear(),
    pad2(utc.getUTCMonth() + 1),
    pad2(utc.getUTCDate()),
  ].join("") + `T${pad2(utc.getUTCHours())}${pad2(utc.getUTCMinutes())}${pad2(utc.getUTCSeconds())}Z`;
}

function localDateTimeToUtcDate(value, timeZone) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})?$/);
  if (match?.[7]) return new Date(text);
  if (!match) return new Date(value);

  const offsetMinutes = googleCalendarOffsetMinutes(timeZone);
  return new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]) - offsetMinutes,
    Number(match[6]),
  ));
}

function getZonedDateTimeParts(value, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date(value))
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function googleCalendarOffsetMinutes(timeZone) {
  if (timeZone === "Asia/Kolkata" || timeZone === "Asia/Calcutta") return 330;
  return 0;
}

function normalizePrivateKey(value) {
  return String(value || "").replace(/\\n/g, "\n");
}

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

module.exports = {
  isGoogleCalendarConfigured,
  createSolarisCalendarEvent,
};
