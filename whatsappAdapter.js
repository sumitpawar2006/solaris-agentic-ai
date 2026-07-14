function whatsappProvider() {
  return String(process.env.WHATSAPP_PROVIDER || "callmebot").trim().toLowerCase();
}

function normalizeWhatsAppNumber(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function isWhatsAppConfigured() {
  if (whatsappProvider() === "callmebot") {
    return Boolean(process.env.CALLMEBOT_APIKEY);
  }

  if (whatsappProvider() === "twilio") {
    return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  }

  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

async function sendSolarisWhatsApp({ to, text }) {
  const provider = whatsappProvider();
  if (provider === "callmebot") {
    return sendCallMeBotWhatsApp({ to, text });
  }

  if (provider === "twilio") {
    return sendTwilioWhatsApp({ to, text });
  }

  return sendMetaWhatsAppText({ to, text });
}

async function sendSolarisWhatsAppTemplate({ to, templateName, languageCode }) {
  const text = `Solaris WhatsApp test: ${templateName || "hello_world"} (${languageCode || "en_US"})`;
  return sendSolarisWhatsApp({ to, text });
}

async function sendSolarisWhatsAppContent({ to, contentSid, variables, fallbackText }) {
  const provider = whatsappProvider();
  if (provider !== "twilio") {
    return sendSolarisWhatsApp({ to, text: fallbackText });
  }

  return sendTwilioWhatsAppContent({ to, contentSid, variables, fallbackText });
}

async function sendCallMeBotWhatsApp({ to, text }) {
  const recipient = normalizeWhatsAppNumber(process.env.CALLMEBOT_PHONE || to);
  const messageText = String(text || "").trim();

  validateMessage(recipient, messageText);

  if (!process.env.CALLMEBOT_APIKEY) {
    return previewResult("callmebot", recipient, messageText, "CallMeBot API key is not configured.");
  }

  const params = new URLSearchParams({
    phone: recipient,
    text: messageText,
    apikey: process.env.CALLMEBOT_APIKEY,
  });
  const endpoint = `https://api.callmebot.com/whatsapp.php?${params.toString()}`;
  const response = await fetch(endpoint);
  const body = await response.text();

  if (!response.ok || /error|invalid|not allowed|not authorized/i.test(body)) {
    const error = new Error(body || `CallMeBot failed with HTTP ${response.status}.`);
    error.status = response.status;
    error.detail = body;
    throw error;
  }

  return {
    sent: true,
    preview: false,
    accepted: true,
    provider: "callmebot",
    mode: "text",
    to: recipient,
    messageId: "",
    messageStatus: body.trim() || "accepted by CallMeBot",
    waId: recipient,
    raw: body,
  };
}

async function sendTwilioWhatsApp({ to, text }) {
  const recipient = normalizeWhatsAppNumber(process.env.TWILIO_WHATSAPP_TO || to);
  const messageText = String(text || "").trim();

  validateMessage(recipient, messageText);

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return previewResult("twilio", recipient, messageText, "Twilio Account SID or Auth Token is not configured.");
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const from = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
  const body = new URLSearchParams({
    From: from,
    To: `whatsapp:+${recipient}`,
    Body: messageText,
  });

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || `Twilio WhatsApp failed with HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.detail = data;
    throw error;
  }

  return {
    sent: true,
    preview: false,
    accepted: true,
    provider: "twilio",
    mode: "text",
    to: recipient,
    messageId: data.sid || "",
    messageStatus: data.status || "queued",
    waId: recipient,
    raw: data,
  };
}

async function sendTwilioWhatsAppContent({ to, contentSid, variables = {}, fallbackText }) {
  const recipient = normalizeWhatsAppNumber(process.env.TWILIO_WHATSAPP_TO || to);
  const sid = String(contentSid || "").trim();

  if (!recipient) {
    const error = new Error("Customer WhatsApp phone number is missing.");
    error.status = 400;
    throw error;
  }

  if (!sid) {
    return sendTwilioWhatsApp({ to: recipient, text: fallbackText });
  }

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return previewResult("twilio", recipient, fallbackText || `Twilio Content Template ${sid}`, "Twilio Account SID or Auth Token is not configured.");
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const from = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
  const body = new URLSearchParams({
    From: from,
    To: `whatsapp:+${recipient}`,
    ContentSid: sid,
  });

  if (variables && Object.keys(variables).length) {
    body.set("ContentVariables", JSON.stringify(variables));
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || `Twilio content message failed with HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.detail = data;
    throw error;
  }

  return {
    sent: true,
    preview: false,
    accepted: true,
    provider: "twilio",
    mode: "content",
    to: recipient,
    messageId: data.sid || "",
    messageStatus: data.status || "queued",
    waId: recipient,
    raw: data,
  };
}

async function sendMetaWhatsAppText({ to, text }) {
  const recipient = normalizeWhatsAppNumber(to);
  const messageText = String(text || "").trim();

  validateMessage(recipient, messageText);

  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return previewResult("meta", recipient, messageText, "Meta WhatsApp Cloud API is not configured.");
  }

  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || "v22.0";
  const endpoint = `https://graph.facebook.com/${graphVersion}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: recipient,
      type: "text",
      text: { preview_url: false, body: messageText },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `WhatsApp Cloud API failed with HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.detail = data;
    throw error;
  }

  const message = data?.messages?.[0] || {};
  const contact = data?.contacts?.[0] || null;
  return {
    sent: true,
    preview: false,
    accepted: true,
    provider: "meta",
    mode: "text",
    to: recipient,
    messageId: message.id || "",
    messageStatus: message.message_status || "accepted",
    waId: contact?.wa_id || "",
    contact,
    raw: data,
  };
}

function previewResult(provider, recipient, text, reason) {
  return {
    sent: false,
    preview: true,
    provider,
    reason,
    mode: "text",
    message: { to: recipient, text },
  };
}

function validateMessage(recipient, text) {
  if (!recipient) {
    const error = new Error("Customer WhatsApp phone number is missing.");
    error.status = 400;
    throw error;
  }

  if (!text) {
    const error = new Error("WhatsApp message text is required.");
    error.status = 400;
    throw error;
  }
}

module.exports = {
  isWhatsAppConfigured,
  normalizeWhatsAppNumber,
  sendSolarisWhatsApp,
  sendSolarisWhatsAppContent,
  sendSolarisWhatsAppTemplate,
  whatsappProvider,
};
