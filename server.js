const http = require("node:http");
const { AsyncLocalStorage } = require("node:async_hooks");
const fs = require("node:fs");
const path = require("node:path");
const OpenAI = require("openai");
const { isEmailConfigured, sendSolarisEmail } = require("./emailAdapter");
const { isWhatsAppConfigured, normalizeWhatsAppNumber, sendSolarisWhatsApp, sendSolarisWhatsAppContent, sendSolarisWhatsAppTemplate, whatsappProvider } = require("./whatsappAdapter");
const { isGoogleCalendarConfigured, createSolarisCalendarEvent } = require("./calendarAdapter");

const port = Number(process.env.PORT || 8787);
const root = __dirname;
const sessions = new Map();
const pendingOtps = new Map();
const pendingTicketDrafts = new Map();
const pendingReportRequests = new Map();
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const openaiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const demoUser = {
  id: "user-demo",
  customerId: "CUS-DEMO-001",
  name: "Solaris Customer",
  phone: "+91 98765 43210",
  email: "customer@solaris.local",
  address: "Demo Solar Site",
  password: "Solaris@123",
};
const users = new Map([[demoUser.id, demoUser]]);
const userStates = new Map();
const stateContext = new AsyncLocalStorage();

const demoState = createInitialState({ seedDemoTicket: true });
userStates.set(demoUser.id, demoState);

const state = new Proxy(
  {},
  {
    get(_target, property) {
      return getCurrentState()[property];
    },
    set(_target, property, value) {
      getCurrentState()[property] = value;
      return true;
    },
    ownKeys() {
      return Reflect.ownKeys(getCurrentState());
    },
    getOwnPropertyDescriptor(_target, property) {
      return Object.getOwnPropertyDescriptor(getCurrentState(), property);
    },
  },
);

function createInitialState({ seedDemoTicket = false } = {}) {
  return {
  metrics: {
    healthScore: 92,
    currentLoad: 3.4,
    solarNow: 5.8,
    gridState: "Exporting",
    todayGeneration: 24.8,
    selfConsumption: 68,
    exported: 4.1,
    savingsToday: 286,
    savingsMonth: 6920,
    nightUsage: 8.2,
  },
  site: {
    systemSizeKw: 5.5,
    tariffPerKwh: 8.2,
    exportRatePerKwh: 3.1,
    expectedTodayKwh: 27.2,
    expectedMonthKwh: 720,
  },
  bill: {
    month: "June 2026",
    amount: 1840,
    gridImportKwh: 146,
    exportCredit: 382,
    fixedCharges: 280,
    previousAmount: 2160,
    currentCycle: {
      month: "July 2026",
      status: "In progress",
    },
    completedBills: [
      {
        month: "May 2026",
        amount: 2160,
        gridImportKwh: 171,
        exportCredit: 326,
        fixedCharges: 280,
      },
      {
        month: "June 2026",
        amount: 1840,
        gridImportKwh: 146,
        exportCredit: 382,
        fixedCharges: 280,
      },
    ],
  },
  weather: {
    today: "Clear",
    tomorrow: "Mostly sunny",
    rainChance: 12,
    forecastGenerationKwh: 26.5,
    bestSolarWindow: "12 PM - 3 PM",
  },
  warranty: {
    installer: "Solaris Service Partner",
    amcExpiry: "2027-03-31",
    inverterWarrantyExpiry: "2031-07-10",
    panelWarrantyExpiry: "2051-07-10",
    servicePhone: "+91 90000 11111",
  },
  peerBenchmark: {
    region: "Pune West",
    peerHomes: 42,
    systemSizeRange: "5-6 kW rooftop homes",
    roofProfile: "similar west-facing urban rooftops",
    medianDailyGenerationKwh: 27,
    topQuartileGenerationKwh: 30.5,
    medianNightUsageKwh: 6.1,
    medianSelfConsumption: 74,
    medianExportKwh: 3.2,
  },
  agentInsights: {},
  readings: {
    day: {
      labels: ["6", "8", "10", "12", "14", "16", "18", "20"],
      solar: [0.2, 2.1, 4.8, 6.4, 5.9, 3.6, 0.8, 0],
      load: [1.1, 1.8, 2.7, 3.3, 4.6, 3.9, 2.5, 2.1],
    },
    week: {
      labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      solar: [21, 24, 19, 26, 25, 23, 27],
      load: [18, 20, 22, 19, 21, 24, 20],
    },
    month: {
      labels: ["W1", "W2", "W3", "W4"],
      solar: [148, 161, 139, 172],
      load: [131, 146, 151, 143],
    },
    year: {
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      solar: [612, 648, 714, 742, 768, 702, 690, 676, 638, 604, 582, 598],
      load: [542, 556, 604, 631, 668, 646, 620, 618, 592, 574, 563, 571],
    },
  },
  appliances: [
    { id: "appl-ac", name: "Air Conditioner", type: "AC", kwh: 7.4, cost: 89, source: "Smart plug", confidence: 99 },
    { id: "appl-ev", name: "EV Charger", type: "EV Charger", kwh: 5.6, cost: 67, source: "Smart plug", confidence: 98 },
    { id: "appl-geyser", name: "Geyser", type: "Geyser", kwh: 3.8, cost: 46, source: "NILM", confidence: 82 },
    { id: "appl-fridge", name: "Refrigerator", type: "Fridge", kwh: 2.4, cost: 29, source: "NILM", confidence: 76 },
    { id: "appl-pump", name: "Water Pump", type: "Pump", kwh: 1.9, cost: 23, source: "Smart plug", confidence: 98 },
    { id: "appl-washer", name: "Washing Machine", type: "Washing Machine", kwh: 1.2, cost: 14, source: "Smart plug", confidence: 97 },
    { id: "appl-lighting", name: "Lighting", type: "Lighting", kwh: 1.1, cost: 13, source: "NILM", confidence: 70 },
    { id: "appl-kitchen", name: "Kitchen Loads", type: "Kitchen", kwh: 0.9, cost: 11, source: "NILM", confidence: 68 },
  ],
  suggestions: [
    {
      title: "Use flexible loads between 12 PM and 3 PM",
      body: "Solaris expects 5.5 kW+ generation. Prioritize EV charging between 12 PM and 3 PM to reduce grid import.",
    },
    {
      title: "Night load is trending high",
      body: "AC and geyser account for most night consumption. Shift water heating to daytime solar where possible.",
    },
    {
      title: "Cleaning watch enabled",
      body: "Production is 9% below clean-panel expectation. Solaris will suggest cleaning if the drop reaches 15%.",
    },
  ],
  cleaner: {
    state: "Ready",
    mode: "Auto optimized",
    nextSchedule: "",
    active: true,
    suspended: false,
    statusMessage: "Auto optimized cleaning is active. Solaris will choose the next cleaning window from dust, weather, rainfall, and production drop.",
    approval: null,
    lastCleaning: "Jul 03, 2026",
    dustRisk: "Medium",
    rainForecast: "Low",
    productionImpact: "-9%",
  },
  tickets: seedDemoTicket
    ? [
        {
          id: "SOL-2381",
          type: "Underproduction",
          title: "Production 22% below expected",
          subject: "Production 22% below expected",
          status: "Awaiting user approval",
          body: "Solaris detected production 22% below expected and is waiting for user approval before company escalation.",
          description: "Solaris detected production 22% below expected and is waiting for user approval before company escalation.",
          source: "Agent",
          createdAt: new Date().toISOString(),
        },
      ]
    : [],
  ticketApproval: seedDemoTicket
    ? {
        id: "APR-UNDERPRODUCTION-1",
        ticketId: "SOL-2381",
        code: "",
        type: "Underproduction",
        subject: "Solar production is below expected",
        description:
          "Solaris detected production 22% below expected for multiple clear periods. Recommended ticket includes generation comparison, weather context, inverter status, and cleaning history.",
        status: "Awaiting user approval",
        severity: "Medium",
        whatsappSent: false,
        createdAt: new Date().toISOString(),
      }
    : null,
  preferences: {
    whatsapp: true,
    email: true,
    calendar: true,
    autoTicket: false,
    quietHours: true,
  },
  agentMemory: [
    {
      key: "surplus-preference",
      label: "Prefer EV charging during 12 PM - 3 PM solar surplus.",
      evidence: "EV charger is a flexible load and geyser is lower priority unless hot water is needed.",
      updatedAt: new Date().toISOString(),
    },
    {
      key: "notification-preference",
      label: "Use WhatsApp/email only when the customer has opted in.",
      evidence: "Notification controls are enabled per customer.",
      updatedAt: new Date().toISOString(),
    },
  ],
  agentRuns: [
    {
      id: "RUN-DEMO-SURPLUS",
      title: "Solar surplus automation",
      status: "Ready",
      confidence: 86,
      startedAt: new Date().toISOString(),
      steps: [
        { name: "Observed", detail: "Solar generation is higher than current load and the 12 PM - 3 PM window is strong.", status: "done" },
        { name: "Reasoned", detail: "EV charging creates better value than geyser because hot water is not normally needed during this window.", status: "done" },
        { name: "Decision", detail: "Prioritize EV Charger, then Water Pump, then Washing Machine.", status: "done" },
        { name: "Action", detail: "Ready to send suggestion or create a calendar reminder when requested.", status: "ready" },
        { name: "Verification", detail: "Watch whether load shifts into solar window and grid import reduces.", status: "ready" },
        { name: "Outcome", detail: "Expected improvement: higher self-consumption and lower grid import.", status: "ready" },
        { name: "Learning", detail: "Remember EV-first preference for future surplus recommendations.", status: "done" },
      ],
    },
  ],
  agentApprovals: [],
  agentDemo: null,
  events: [
    event("Solaris backend started monitoring solar, appliances, cleaning, and service tickets."),
  ],
};
}

const server = http.createServer(async (req, res) => {
  try {
    setCommonHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/auth/status" && req.method === "GET") {
      const session = getSession(req);
      const user = getSessionUser(req);
      sendJson(res, {
        authenticated: Boolean(user && session?.level === "dashboard"),
        chatAuthenticated: Boolean(user && (session?.level === "chat" || session?.level === "dashboard")),
        level: session?.level || "guest",
        user: sanitizeUser(user),
      });
      return;
    }

    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      const body = await readBody(req);
      const user = findUserByEmail(body.email);
      if (!user || body.password !== user.password) {
        sendJson(res, { error: "Invalid email or password." }, 401);
        return;
      }

      const token = cryptoRandomToken();
      sessions.set(token, { userId: user.id, level: "dashboard", createdAt: Date.now() });
      res.setHeader("Set-Cookie", cookie("solaris_session", token, { httpOnly: true, sameSite: "Lax", maxAge: 60 * 60 * 8 }));
      sendJson(res, { authenticated: true, user: sanitizeUser(user) });
      return;
    }

    if (url.pathname === "/api/auth/signup" && req.method === "POST") {
      const body = await readBody(req);
      const user = createUser(body);
      users.set(user.id, user);

      const token = cryptoRandomToken();
      sessions.set(token, { userId: user.id, level: "dashboard", createdAt: Date.now() });
      res.setHeader("Set-Cookie", cookie("solaris_session", token, { httpOnly: true, sameSite: "Lax", maxAge: 60 * 60 * 8 }));
      stateContext.run(getStateForUser(user), () => addEvent(`New customer registered: ${user.customerId}.`));
      sendJson(res, { authenticated: true, user: sanitizeUser(user) }, 201);
      return;
    }

    if (url.pathname === "/api/auth/identify" && req.method === "POST") {
      const body = await readBody(req);
      const user = findUserByIdentifier(body.identifier);
      if (!user) {
        sendJson(res, { authenticated: false, error: "Customer not found." }, 404);
        return;
      }

      const otp = createOtp();
      pendingOtps.set(user.id, {
        otp,
        expiresAt: Date.now() + 10 * 60 * 1000,
        attempts: 0,
      });

      const result = await sendOtpEmail(user, otp);
      addEvent(result.sent ? `OTP sent to ${user.email}.` : `OTP preview generated for ${user.email}; Gmail is not configured.`);
      sendJson(res, {
        authenticated: false,
        otpRequired: true,
        emailHint: maskEmail(user.email),
        result,
      });
      return;
    }

    if (url.pathname === "/api/auth/verify-otp" && req.method === "POST") {
      const body = await readBody(req);
      const user = findUserByIdentifier(body.identifier);
      if (!user) {
        sendJson(res, { authenticated: false, error: "Customer not found." }, 404);
        return;
      }

      const pending = pendingOtps.get(user.id);
      if (!pending || pending.expiresAt < Date.now()) {
        pendingOtps.delete(user.id);
        sendJson(res, { authenticated: false, error: "OTP expired. Request a new OTP." }, 401);
        return;
      }

      pending.attempts += 1;
      if (pending.attempts > 5) {
        pendingOtps.delete(user.id);
        sendJson(res, { authenticated: false, error: "Too many OTP attempts. Request a new OTP." }, 429);
        return;
      }

      if (String(body.otp || "").trim() !== pending.otp) {
        sendJson(res, { authenticated: false, error: "Invalid OTP." }, 401);
        return;
      }

      pendingOtps.delete(user.id);
      const token = cryptoRandomToken();
      sessions.set(token, { userId: user.id, level: "chat", createdAt: Date.now() });
      res.setHeader("Set-Cookie", cookie("solaris_session", token, { httpOnly: true, sameSite: "Lax", maxAge: 60 * 60 * 8 }));
      sendJson(res, { authenticated: false, chatAuthenticated: true, user: sanitizeUser(user) });
      return;
    }

    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      const token = getCookie(req, "solaris_session");
      if (token) sessions.delete(token);
      res.setHeader("Set-Cookie", cookie("solaris_session", "", { httpOnly: true, sameSite: "Lax", maxAge: 0 }));
      sendJson(res, { authenticated: false });
      return;
    }

    if (url.pathname === "/api/whatsapp/webhook" && req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(challenge || "");
        return;
      }
      sendJson(res, { error: "WhatsApp webhook verification failed." }, 403);
      return;
    }

    if (url.pathname === "/api/whatsapp/webhook" && req.method === "POST") {
      const body = await readBody(req);
      const entries = Array.isArray(body.entry) ? body.entry.length : 0;
      const statusEvents = extractWhatsAppStatusEvents(body);
      if (statusEvents.length) {
        statusEvents.forEach((item) => addEvent(item));
      } else {
        addEvent(`WhatsApp webhook received ${entries} entr${entries === 1 ? "y" : "ies"}.`);
      }
      sendJson(res, { received: true });
      return;
    }

    if (isWhatsAppInboundPost(url.pathname, req)) {
      const body = await readBody(req);
      const result = await handleWhatsAppInbound(body);
      sendXml(res, twimlMessage(result.message));
      return;
    }

    if (url.pathname.startsWith("/api/") && !canAccessApi(req, url.pathname)) {
      sendJson(res, { error: "Authentication required." }, 401);
      return;
    }

    if (url.pathname === "/api/state" && req.method === "GET") {
      const user = getSessionUser(req);
      await ensureTicketApprovalWhatsApp(user);
      refreshAgentInsights(user);
      ensureAutoAgentApprovals(user);
      sendJson(res, state);
      return;
    }

    if (url.pathname === "/api/suggestions/refresh" && req.method === "POST") {
      const surplus = analyzeSolarSurplus();
      const item = {
        title: "Solar surplus window checked",
        body: `${surplus.status}: use ${surplus.recommendedLoads[0]} during ${surplus.bestWindow}. Estimated value Rs ${surplus.savings}.`,
      };
      state.suggestions.unshift(item);
      addEvent("Suggestions refreshed using Solar Surplus Automation Agent.");
      sendJson(res, { suggestions: state.suggestions, events: state.events });
      return;
    }

    if (url.pathname === "/api/agent/chat" && req.method === "POST") {
      const user = getSessionUser(req);
      const session = getSession(req);
      const body = await readBody(req);
      const message = String(body.message || "").trim();
      if (!message) return sendJson(res, { error: "Message is required." }, 400);

      const reply = await handleAgentMessageWithAi(message, user, session);
      addEvent(`Agent answered: ${reply.intent}`);
      sendJson(res, { reply, events: state.events });
      return;
    }

    if (url.pathname === "/api/appliances" && req.method === "POST") {
      const body = await readBody(req);
      const appliance = createAppliance(body);
      state.appliances.push(appliance);
      addEvent(`Added appliance ${appliance.name} using ${appliance.source} tracking.`);
      sendJson(res, { appliance, appliances: state.appliances, events: state.events });
      return;
    }

    if (url.pathname.startsWith("/api/appliances/") && req.method === "DELETE") {
      const id = decodeURIComponent(url.pathname.replace("/api/appliances/", ""));
      const appliance = state.appliances.find((item) => item.id === id);
      if (!appliance) return sendJson(res, { error: "Appliance not found." }, 404);

      state.appliances = state.appliances.filter((item) => item.id !== id);
      addEvent(`Removed appliance ${appliance.name}.`);
      sendJson(res, { appliances: state.appliances, events: state.events });
      return;
    }

    if (url.pathname === "/api/bill/payment-link" && req.method === "POST") {
      const body = await readBody(req);
      const method = String(body.method || "").trim();
      const invoiceNumber = String(body.invoiceNumber || "").trim();
      const amount = Number(body.amount || 0);
      const result = buildPaymentLink({ method, invoiceNumber, amount });
      if (result.error) return sendJson(res, result, 409);
      addEvent(`Payment link created for ${invoiceNumber} using ${method}.`);
      sendJson(res, { ...result, events: state.events });
      return;
    }

    if (url.pathname === "/api/cleaner/command" && req.method === "POST") {
      const user = getSessionUser(req);
      const body = await readBody(req);
      const command = String(body.command || "").toLowerCase();
      const states = { start: "Running", pause: "Paused", stop: "Ready" };
      if (!states[command]) return sendJson(res, { error: "Unsupported cleaner command." }, 400);
      if (state.cleaner.mode !== "Manual only") {
        return sendJson(res, { error: "Start, Pause, and Stop are available only when Cleaning Mode is saved as Manual only." }, 409);
      }

      await applyCleanerCommand(command, user, "Dashboard");
      sendJson(res, { cleaner: state.cleaner, events: state.events });
      return;
    }

    if (url.pathname === "/api/cleaner/schedule" && req.method === "POST") {
      const user = getSessionUser(req);
      const body = await readBody(req);
      if (isCleanerLocked()) {
        return sendJson(res, { error: cleanerLockedMessage("change the cleaning schedule") }, 409);
      }
      state.cleaner.mode = String(body.mode || state.cleaner.mode);
      const requiresSchedule = state.cleaner.mode === "Scheduled";
      const requestedSchedule = String(body.nextSchedule || "").trim();
      if (requiresSchedule && !requestedSchedule) {
        return sendJson(res, { error: "Scheduled mode requires a date and time before saving." }, 400);
      }
      state.cleaner.nextSchedule = requiresSchedule ? requestedSchedule : "";
      state.cleaner.active = state.cleaner.mode !== "Manual only";
      state.cleaner.suspended = false;
      state.cleaner.state = "Ready";
      state.cleaner.statusMessage =
        state.cleaner.mode === "Auto optimized"
          ? "Auto optimized cleaning is active. Solaris will choose the next cleaning window from dust, weather, rainfall, and production drop."
          : state.cleaner.mode === "Scheduled"
            ? `Cleaning schedule active for ${formatDateTime(state.cleaner.nextSchedule)}.`
            : "Manual cleaner control is active. Use Start, Pause, and Stop from the Manual cleaner control section.";
      addEvent(`Cleaning schedule saved: ${state.cleaner.mode}, ${formatDateTime(state.cleaner.nextSchedule)}.`);
      const calendarResult =
        state.cleaner.mode !== "Scheduled" || !state.cleaner.nextSchedule
          ? null
          : await createCalendarPlan(user, {
              planType: "Cleaning",
              title: "Solar panel cleaning",
              description: "Solaris scheduled solar panel cleaning with safety checks for weather, water level, and maintenance status.",
              start: state.cleaner.nextSchedule,
              durationMinutes: 60,
              source: "Dashboard",
            });
      sendJson(res, { cleaner: state.cleaner, events: state.events, calendarResult });
      return;
    }

    if (url.pathname === "/api/calendar/plan" && req.method === "POST") {
      const user = getSessionUser(req);
      const body = await readBody(req);
      const plan = normalizeCalendarPlan(body);
      const calendarResult = await createCalendarPlan(user, { ...plan, source: "Dashboard" });
      if (!calendarResult.ok) return sendJson(res, { error: calendarResult.error, calendarResult, events: state.events }, calendarResult.status || 400);
      sendJson(res, { calendarResult, events: state.events });
      return;
    }

    if (url.pathname === "/api/judge-demo/run" && req.method === "POST") {
      const user = getSessionUser(req);
      const agentDemo = runJudgeDemo(user);
      sendJson(res, {
        agentDemo,
        agentRuns: state.agentRuns,
        agentMemory: state.agentMemory,
        agentApprovals: state.agentApprovals,
        events: state.events,
      });
      return;
    }

    if (url.pathname.startsWith("/api/agent-approvals/") && req.method === "POST") {
      const user = getSessionUser(req);
      const parts = url.pathname.split("/").filter(Boolean);
      const id = decodeURIComponent(parts[2] || "");
      const action = parts[3] || "";
      const result = action === "approve" ? await approveAgentApproval(id, user) : action === "reject" ? rejectAgentApproval(id) : { error: "Unsupported approval action.", status: 400 };
      if (result.error) return sendJson(res, { error: result.error, approvals: state.agentApprovals, events: state.events }, result.status || 400);
      sendJson(res, { ...result, approvals: state.agentApprovals, agentRuns: state.agentRuns, agentMemory: state.agentMemory, events: state.events });
      return;
    }

    if (url.pathname === "/api/cleaner/suspend" && req.method === "POST") {
      state.cleaner.active = false;
      state.cleaner.suspended = true;
      state.cleaner.state = "Suspended";
      state.cleaner.statusMessage = "Current cleaning schedule/activity is suspended. New settings are now allowed.";
      addEvent("Current cleaning schedule/activity was suspended.");
      sendJson(res, { cleaner: state.cleaner, events: state.events });
      return;
    }

    if (url.pathname === "/api/tickets" && req.method === "POST") {
      const body = await readBody(req);
      const ticket = createServiceTicket({
        type: body.type,
        subject: body.subject,
        description: body.description,
        source: "Manual",
      });
      const duplicate = findOpenTicketByType(ticket.type);
      if (duplicate) {
        sendJson(res, { error: `An open ${ticket.type} ticket already exists: ${duplicate.id}. Close it before creating another.` }, 409);
        return;
      }
      state.tickets.unshift(ticket);
      addEvent(`Created ${ticket.type} ticket ${ticket.id}.`);
      addAgentRun({
        title: `Ticket created: ${ticket.type}`,
        status: "Completed",
        confidence: 84,
        steps: [
          { name: "Observed", detail: `Customer reported ${ticket.type}: ${ticket.subject}.`, status: "done" },
          { name: "Reasoned", detail: "Solaris checked for duplicate open ticket types before creating a new one.", status: "done" },
          { name: "Decision", detail: `Create service ticket ${ticket.id}.`, status: "done" },
          { name: "Action", detail: "Ticket added to maintenance tracker.", status: "done" },
          { name: "Verification", detail: `Ticket status is ${ticket.status}.`, status: "done" },
          { name: "Outcome", detail: "Solaris can track status and remind the company if SLA follow-up is missed.", status: "ready" },
          { name: "Learning", detail: "Block duplicate open tickets for the same type except Other.", status: "done" },
        ],
      });
      sendJson(res, { ticket, tickets: state.tickets, events: state.events });
      return;
    }

    if (url.pathname === "/api/tickets/approve-underproduction" && req.method === "POST") {
      const user = getSessionUser(req);
      const result = await approveUnderproductionTicket(user, "Dashboard");
      if (result.error) return sendJson(res, { error: result.error }, result.status || 400);
      sendJson(res, { ticket: result.ticket, tickets: state.tickets, ticketApproval: state.ticketApproval, agentRuns: state.agentRuns, events: state.events, notificationStatus: result.notificationStatus });
      return;
    }

    if (url.pathname === "/api/tickets/reject-underproduction" && req.method === "POST") {
      const user = getSessionUser(req);
      const result = await rejectUnderproductionTicket(user, "Dashboard");
      if (result.error) return sendJson(res, { error: result.error }, result.status || 400);
      sendJson(res, { ticket: result.ticket, tickets: state.tickets, ticketApproval: state.ticketApproval, agentRuns: state.agentRuns, events: state.events, notificationStatus: result.notificationStatus });
      return;
    }

    if (url.pathname === "/api/preferences" && req.method === "POST") {
      const body = await readBody(req);
      state.preferences = { ...state.preferences, ...body };
      addEvent("Notification and automation preferences updated.");
      sendJson(res, { preferences: state.preferences, events: state.events });
      return;
    }

    if (url.pathname === "/api/email/report" && req.method === "POST") {
      const user = getSessionUser(req);
      if (!state.preferences.email) {
        sendJson(res, { error: "Email reports are disabled for this customer." }, 403);
        return;
      }

      const body = await readBody(req);
      const report = buildEmailReport(user, body.reportType || "daily");
      try {
        const result = await sendSolarisEmail(report);
        addEvent(result.sent ? `Email report sent to ${user.email}.` : `Email report preview generated for ${user.email}; Gmail is not configured.`);
        const whatsappResult = await sendReportWhatsApp(user, report, body.reportType || "daily");
        sendJson(res, { result, whatsappResult, events: state.events, configured: isEmailConfigured(), whatsappConfigured: isWhatsAppConfigured() });
      } catch (error) {
        const message = friendlyEmailError(error);
        addEvent(`Email report failed for ${user.email}: ${message}`);
        const whatsappResult = await sendReportWhatsApp(user, report, body.reportType || "daily");
        sendJson(res, { error: message, detail: error.message, whatsappResult, events: state.events, configured: isEmailConfigured(), whatsappConfigured: isWhatsAppConfigured() }, 502);
      }
      return;
    }

    if (url.pathname === "/api/whatsapp/test" && req.method === "POST") {
      const user = getSessionUser(req);
      if (!state.preferences.whatsapp) {
        sendJson(res, { error: "WhatsApp alerts are disabled for this customer." }, 403);
        return;
      }

      const body = await readBody(req);
      const message = String(body.message || "").trim();
      try {
        const result = message
          ? await sendWhatsAppAlert(user, message)
          : await sendWhatsAppTemplateTest(user, body.templateName, body.languageCode);
        sendJson(res, { result, events: state.events, configured: isWhatsAppConfigured() });
      } catch (error) {
        const messageText = friendlyWhatsAppError(error);
        addEvent(`WhatsApp alert failed for ${user.phone}: ${messageText}`);
        sendJson(res, { error: messageText, detail: error.detail || error.message, events: state.events, configured: isWhatsAppConfigured() }, 502);
      }
      return;
    }

    if (url.pathname === "/api/whatsapp/report" && req.method === "POST") {
      const user = getSessionUser(req);
      if (!state.preferences.whatsapp) {
        sendJson(res, { error: "WhatsApp reports are disabled for this customer." }, 403);
        return;
      }

      const body = await readBody(req);
      const reportType = body.reportType || "daily";
      const report = buildEmailReport(user, reportType);
      const result = await sendReportWhatsApp(user, report, reportType);
      if (result.error) {
        sendJson(res, { error: result.error, result, events: state.events, configured: isWhatsAppConfigured() }, 502);
        return;
      }
      sendJson(res, { result, events: state.events, configured: isWhatsAppConfigured() });
      return;
    }

    serveStatic(req, res, url.pathname);
  } catch (error) {
    sendJson(res, { error: error.message }, error.status || 500);
  }
});

server.listen(port, () => {
  console.log(`Solaris running at http://localhost:${port}`);
});

function setCommonHeaders(req, res) {
  const origin = req.headers.origin || `http://localhost:${port}`;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendXml(res, xml, status = 200) {
  res.writeHead(status, { "Content-Type": "application/xml; charset=utf-8" });
  res.end(xml);
}

function twimlMessage(message) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeHtml(message)}</Message></Response>`;
}

function serveStatic(req, res, pathname) {
  const cleanPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(root, cleanPath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const type = contentType(path.extname(filePath));
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

function contentType(extension) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  }[extension] || "application/octet-stream";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    const contentType = String(req.headers["content-type"] || "");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        if (contentType.includes("application/x-www-form-urlencoded")) {
          return resolve(Object.fromEntries(new URLSearchParams(raw)));
        }
        if (contentType.includes("text/plain")) {
          return resolve({ Body: raw });
        }
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function isWhatsAppInboundPost(pathname, req) {
  if (req.method !== "POST") return false;
  if (pathname === "/api/whatsapp/inbound") return true;
  if (pathname !== "/") return false;

  const userAgent = String(req.headers["user-agent"] || "").toLowerCase();
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  return userAgent.includes("twilioproxy") && contentType.includes("application/x-www-form-urlencoded");
}

function addEvent(message) {
  state.events.unshift(event(message));
  state.events = state.events.slice(0, 30);
}

function addAgentRun({ title, status = "Completed", confidence = 80, steps = [], approvalId = "", approvalType = "" }) {
  const run = {
    id: `RUN-${Date.now().toString(36).toUpperCase()}`,
    title,
    status,
    confidence,
    approvalId,
    approvalType,
    startedAt: new Date().toISOString(),
    steps,
  };
  state.agentRuns = [run, ...(state.agentRuns || [])].slice(0, 8);
  return run;
}

function rememberAgentPreference(key, label, evidence) {
  const memory = {
    key,
    label,
    evidence,
    updatedAt: new Date().toISOString(),
  };
  state.agentMemory = [memory, ...(state.agentMemory || []).filter((item) => item.key !== key)].slice(0, 8);
  return memory;
}

function summarizeAgentActivity() {
  const runs = state.agentRuns || [];
  return {
    totalRuns: runs.length,
    latestTitle: runs[0]?.title || "No agent runs yet",
    completed: runs.filter((run) => ["Completed", "Ready"].includes(run.status)).length,
    memories: (state.agentMemory || []).length,
  };
}

function runJudgeDemo(user) {
  const surplus = analyzeSolarSurplus();
  const expected = Number(state.site.expectedTodayKwh || state.metrics.expectedGeneration || 0);
  const actual = Number(state.metrics.todayGeneration || 0);
  const productionGap = expected ? Math.max(0, ((expected - actual) / expected) * 100) : 0;
  const topAppliance = [...(state.appliances || [])].sort((a, b) => b.kwh - a.kwh)[0];
  const customerLabel = user ? `${user.name} (${user.customerId})` : "Solaris customer";
  const demo = {
    title: "Agentic Decision Replay: Solar Surplus + Underperformance",
    autonomyLevel: "Level 4: Ask Approval + Act",
    summary: `Solaris used live site data for ${customerLabel}, selected the safest customer action, exposed the approval gate, and verified the expected outcome.`,
    evidence: [
      `Solar now ${state.metrics.solarNow.toFixed(1)} kW vs load ${state.metrics.currentLoad.toFixed(1)} kW.`,
      `Current surplus ${surplus.currentSurplusKw.toFixed(1)} kW; best window ${surplus.bestWindow}.`,
      `Expected generation ${expected.toFixed(1)} kWh vs actual ${actual.toFixed(1)} kWh; gap ${productionGap.toFixed(1)}%.`,
      topAppliance ? `Highest appliance load: ${topAppliance.name} at ${topAppliance.kwh.toFixed(1)} kWh.` : "Appliance data available from NILM and smart plugs.",
    ],
    tools: [
      "Solar monitoring tool read generation, load, grid export, and expected production.",
      "Hybrid appliance tool compared NILM and smart plug consumption.",
      "Calendar tool prepared EV charging reminder for the solar surplus window.",
      "Ticket tool prepared underproduction escalation only after customer approval.",
      "Notification tool can send the result through opted-in Email or WhatsApp.",
    ],
    approvals: [
      "Surplus reminder: safe action, customer can approve before saving reminder.",
      "Underproduction ticket: blocked until customer approval because company escalation is external.",
      "Cleaner hardware: not started because hardware actions require explicit command or enabled auto mode.",
    ],
    outcomes: [
      `Recommended ${surplus.recommendedLoads[0]} during ${surplus.bestWindow}.`,
      `Estimated solar value captured: Rs ${surplus.savings}.`,
      "Expected result: higher self-consumption, lower grid import, and clearer service evidence.",
      "Learning stored: prefer EV charging during 12 PM - 3 PM surplus.",
    ],
    roi: [
      { value: "30 min -> 2 min", label: "service triage turnaround" },
      { value: "20-40%", label: "less manual follow-up" },
      { value: "5-15%", label: "higher solar self-consumption" },
      { value: "24/7", label: "customer action assistant" },
    ],
    timeline: [
      { step: "Detect", detail: "Production gap and solar surplus found from live site metrics.", status: "done" },
      { step: "Diagnose", detail: "Weather, appliance load, cleaning impact, and expected generation are compared.", status: "done" },
      { step: "Approval Gate", detail: "External actions are paused until the customer approves.", status: "active" },
      { step: "Tool Action", detail: "Solaris can create reminder, ticket, WhatsApp, email, or cleaner command.", status: "ready" },
      { step: "Verify", detail: "Event log, ticket state, delivery status, and customer memory are updated.", status: "ready" },
      { step: "Learn", detail: "EV-first surplus preference and approval-safe escalation are stored.", status: "done" },
    ],
    generatedAt: new Date().toISOString(),
  };

  addAgentRun({
    title: "Agentic solar mission replay",
    status: "Completed",
    confidence: 92,
    steps: [
      { name: "Observed", detail: demo.evidence.join(" "), status: "done" },
      { name: "Reasoned", detail: "Solaris compared flexible loads, production gap, appliance priority, opt-ins, and safety rules before acting.", status: "done" },
      { name: "Decision", detail: `Recommend ${surplus.recommendedLoads[0]} in the solar surplus window and prepare underproduction escalation evidence.`, status: "done" },
      { name: "Approval Gate", detail: "Customer approval is required before ticket escalation or external calendar action.", status: "ready" },
      { name: "Tool Actions", detail: demo.tools.join(" "), status: "done" },
      { name: "Verification", detail: "Solaris checks reminder creation, ticket state, notification result, and event log after acting.", status: "done" },
      { name: "Learning", detail: "Stored EV-first surplus preference and approval-safe escalation behavior for future runs.", status: "done" },
    ],
  });
  rememberAgentPreference("mission-replay-ev-surplus", "Prefer EV charging in the 12 PM - 3 PM surplus window.", "Solaris selected EV-first surplus automation with customer approval.");
  rememberAgentPreference("mission-replay-approval-gate", "Ask before external actions like ticket escalation and calendar saves.", "Solaris keeps human approval before company escalation or external calendar actions.");
  state.agentDemo = demo;
  addEvent("Agentic replay ran with evidence, tools, approval gate, verification, and learning.");
  return demo;
}

function approvalDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function ensureAutoAgentApprovals(user) {
  const surplus = analyzeSolarSurplus();
  const dateKey = approvalDateKey();
  const existing = (state.agentApprovals || []).find((approval) => approval.type === "surplus-reminder" && approval.dateKey === dateKey);
  if (existing || !surplus.shouldActNow) return;

  const approval = {
    id: `APR-SURPLUS-${Date.now().toString(36).toUpperCase()}`,
    type: "surplus-reminder",
    title: "Create EV charging surplus reminder",
    status: "Pending",
    confidence: 88,
    dateKey,
    createdAt: new Date().toISOString(),
    recommendation: `Use EV Charger during ${surplus.bestWindow} to absorb ${surplus.currentSurplusKw.toFixed(1)} kW solar surplus.`,
    evidence: [
      `Solar output: ${state.metrics.solarNow.toFixed(1)} kW.`,
      `Current load: ${state.metrics.currentLoad.toFixed(1)} kW.`,
      `Best window: ${surplus.bestWindow}.`,
      `Estimated value: Rs ${surplus.savings}.`,
    ],
    action: "Approve to generate a Google Calendar reminder link.",
    plan: {
      planType: "Appliance Usage",
      title: `Solar surplus window: ${surplus.recommendedLoads[0]}`,
      description: `Solaris recommends ${surplus.recommendedLoads[0]} during ${surplus.bestWindow}. EV charging is prioritized over geyser unless hot water is needed.`,
      start: surplusReminderStart(),
      durationMinutes: 180,
      source: "Approval Center",
    },
  };
  state.agentApprovals = [approval, ...(state.agentApprovals || [])].slice(0, 8);
  addAgentRun({
    title: "Auto-run: surplus opportunity",
    status: "Waiting for Approval",
    confidence: approval.confidence,
    approvalId: approval.id,
    approvalType: approval.type,
    steps: [
      { name: "Observed", detail: approval.evidence.join(" "), status: "done" },
      { name: "Reasoned", detail: "EV charging is the best flexible load for 12 PM - 3 PM; geyser is lower priority.", status: "done" },
      { name: "Decision", detail: approval.recommendation, status: "done" },
      { name: "Action", detail: "Waiting for customer approval before creating a reminder.", status: "ready" },
      { name: "Verification", detail: "After approval, Solaris will check that the reminder was generated.", status: "ready" },
      { name: "Outcome", detail: "Expected higher self-consumption and lower grid import.", status: "ready" },
      { name: "Learning", detail: "Keep EV-first surplus preference in memory.", status: "done" },
    ],
  });
  rememberAgentPreference("surplus-preference", "Prefer EV charging during 12 PM - 3 PM solar surplus.", "Auto-run created a safe approval instead of acting silently.");
  addEvent(`Auto-run prepared approval: ${approval.title}${user ? ` for ${user.customerId}` : ""}.`);
}

async function approveAgentApproval(id, user) {
  const approval = (state.agentApprovals || []).find((item) => item.id === id);
  if (!approval) return { error: "Agent approval not found.", status: 404 };
  if (approval.status !== "Pending") return { error: `Approval is already ${approval.status}.`, status: 409 };

  if (approval.type === "surplus-reminder") {
    approval.plan = {
      ...approval.plan,
      start: surplusReminderStart(),
      durationMinutes: 180,
    };
    const calendarResult = await createCalendarPlan(user, approval.plan);
    if (!calendarResult.ok) return { error: calendarResult.error, status: calendarResult.status || 400 };
    approval.status = "Approved";
    approval.respondedAt = new Date().toISOString();
    approval.result = calendarResult;
    addAgentRun({
      title: "Approved: surplus reminder",
      status: "Completed",
      confidence: approval.confidence,
      approvalId: approval.id,
      approvalType: approval.type,
      steps: [
        { name: "Observed", detail: approval.recommendation, status: "done" },
        { name: "Reasoned", detail: "Customer approved the proposed action, so Solaris can proceed safely.", status: "done" },
        { name: "Decision", detail: "Create Google Calendar reminder link.", status: "done" },
        { name: "Action", detail: calendarResult.statusText, status: "done" },
        { name: "Verification", detail: calendarResult.result?.htmlLink ? "Calendar reminder link generated." : "Calendar result recorded.", status: "done" },
        { name: "Outcome", detail: "Customer can save the reminder and shift EV charging into solar surplus.", status: "done" },
        { name: "Learning", detail: "EV-first surplus automation approved by customer.", status: "done" },
      ],
    });
    addEvent(`Approval Center approved: ${approval.title}.`);
    return { approval, calendarResult };
  }

  return { error: `Unsupported approval type ${approval.type}.`, status: 400 };
}

function rejectAgentApproval(id) {
  const approval = (state.agentApprovals || []).find((item) => item.id === id);
  if (!approval) return { error: "Agent approval not found.", status: 404 };
  if (approval.status !== "Pending") return { error: `Approval is already ${approval.status}.`, status: 409 };
  approval.status = "Rejected";
  approval.respondedAt = new Date().toISOString();
  addAgentRun({
    title: `Rejected: ${approval.title}`,
    status: "Completed",
    confidence: approval.confidence,
    approvalId: approval.id,
    approvalType: approval.type,
    steps: [
      { name: "Observed", detail: approval.recommendation, status: "done" },
      { name: "Reasoned", detail: "Customer rejected the action, so Solaris stopped before acting.", status: "done" },
      { name: "Decision", detail: "Do not create reminder or send action.", status: "done" },
      { name: "Action", detail: "Approval rejected and logged.", status: "done" },
      { name: "Verification", detail: "No external action was taken.", status: "done" },
      { name: "Outcome", detail: "User control preserved.", status: "done" },
      { name: "Learning", detail: "Keep this decision in run history for future explanation.", status: "done" },
    ],
  });
  addEvent(`Approval Center rejected: ${approval.title}.`);
  return { approval };
}

function event(message) {
  return {
    at: new Date().toISOString(),
    message,
  };
}

function cleanerMessage(command) {
  return {
    start: "Solaris started panel cleaning after safety checks.",
    pause: "Solaris paused the cleaner. Schedule remains active.",
    stop: "Solaris stopped the cleaner and logged the action.",
  }[command];
}

async function applyCleanerCommand(command, user, source) {
  const states = { start: "Running", pause: "Paused", stop: "Ready" };
  state.cleaner.state = states[command];
  state.cleaner.active = command !== "stop";
  state.cleaner.suspended = false;
  state.cleaner.approval = null;
  state.cleaner.statusMessage = cleanerMessage(command);
  addEvent(`${cleanerMessage(command)} Source: ${source}.`);
  addAgentRun({
    title: `Cleaner ${command}`,
    status: "Completed",
    confidence: 82,
    steps: [
      { name: "Observed", detail: `Cleaner command requested from ${source} in ${state.cleaner.mode} mode.`, status: "done" },
      { name: "Reasoned", detail: "Manual control is allowed only after the customer selected Manual only mode.", status: "done" },
      { name: "Decision", detail: `Apply cleaner command: ${command}.`, status: "done" },
      { name: "Action", detail: cleanerMessage(command), status: "done" },
      { name: "Verification", detail: `Cleaner state is now ${state.cleaner.state}.`, status: "done" },
      { name: "Outcome", detail: command === "stop" ? "Cleaning activity ended and was logged." : "Cleaner lifecycle action completed.", status: "done" },
      { name: "Learning", detail: "Keep manual cleaner actions separate from scheduled and auto optimized modes.", status: "done" },
    ],
  });

  if (command === "start") {
    await sendCleanerLifecycleWhatsApp(user, "started", source);
  }
  if (command === "stop") {
    state.cleaner.approval = null;
    await sendCleanerLifecycleWhatsApp(user, "ended", source);
  }
}

async function sendCleanerLifecycleWhatsApp(user, status, source) {
  if (!user || !state.preferences.whatsapp) return;

  const text = [
    `Solaris panel cleaning ${status}`,
    "",
    `Customer: ${user.customerId}`,
    `Cleaner status: ${state.cleaner.state}`,
    `Mode: ${state.cleaner.mode}`,
    `Source: ${source}`,
    `Time: ${new Date().toLocaleString()}`,
  ].join("\n");

  try {
    await sendWhatsAppAlert(user, text);
  } catch (error) {
    addEvent(`Cleaner ${status} WhatsApp failed for ${user.phone}: ${friendlyWhatsAppError(error)}`);
  }
}

async function handleWhatsAppInbound(body) {
  const message = String(body.ButtonText || body.ButtonPayload || body.Body || body.body || "").trim();
  const from = normalizeWhatsAppNumber(body.From || body.from || "");
  const ticketIntent = ticketApprovalIntent(message);
  const ticketMatch = ticketIntent ? findPendingTicketApprovalMatch(from, body, message) : null;
  const inboundUser = ticketMatch?.user || findUserByPhone(from) || demoUser;
  stateContext.enterWith(ticketMatch?.customerState || getStateForUser(inboundUser));
  addEvent(`WhatsApp inbound received from ${from || "unknown"}: ${message || "empty message"}.`);

  if (ticketIntent) {
    if (!ticketMatch) {
      return { ok: false, message: "No Solaris ticket approval matched this WhatsApp reply. Open the dashboard and resend the approval request." };
    }
    return handleTicketApprovalInbound(message, from, body);
  }

  const upper = message.toUpperCase();
  if (upper.includes("APPROVE CLEAN") || upper.includes("CANCEL CLEAN")) {
    return { ok: false, message: "Solaris cleaner approval is no longer required. Use Manual only mode and Start/Stop from the dashboard." };
  }

  if (!message) return { ok: false, message: "Solaris did not receive a WhatsApp command." };
  return { ok: false, message: "Solaris did not find an active WhatsApp action for this message." };
}

async function handleTicketApprovalInbound(message, from, body = {}) {
  const approval = state.ticketApproval;
  if (!approval || approval.status !== "Awaiting user approval") return null;

  const upper = String(message || "").toUpperCase();
  const intent = ticketApprovalIntent(message);
  const hasApproveIntent = intent === "approve";
  const hasRejectIntent = intent === "reject";
  const hasTicketIntent = Boolean(intent);
  if (!hasTicketIntent) return null;

  if (!approval.code) approval.code = createShortCode();
  const user = (approval.userId ? users.get(approval.userId) : null) || findUserByPhone(from) || demoUser;
  const trustedButtonReply = Boolean(
    (from && approval.phone && normalizeWhatsAppNumber(approval.phone) === from) ||
      (from && (body.ButtonText || body.ButtonPayload) && body.OriginalRepliedMessageSid)
  );
  if (!upper.includes(approval.code) && !trustedButtonReply) {
    return { ok: false, message: "This ticket approval could not be matched. Please use the Approve or Reject button from the latest Solaris WhatsApp approval message, or approve it from the dashboard." };
  }

  if (hasRejectIntent) {
    const result = await rejectUnderproductionTicket(user, "WhatsApp");
    return { ok: !result.error, message: result.error || `Rejected. Ticket ${approval.ticketId} will not be created.` };
  }

  const result = await approveUnderproductionTicket(user, "WhatsApp");
  return { ok: !result.error, message: result.error || `Approved. Ticket ${result.ticket.id} has been created.` };
}

function ticketApprovalIntent(message) {
  const upper = String(message || "").trim().toUpperCase();
  if (upper.includes("APPROVE TICKET") || upper === "APPROVE" || upper === "APPROVED") return "approve";
  if (upper.includes("REJECT TICKET") || upper === "REJECT" || upper === "REJECTED") return "reject";
  return "";
}

function findPendingTicketApprovalMatch(from, body = {}, message = "") {
  const normalizedFrom = normalizeWhatsAppNumber(from);
  const originalMessageId = String(body.OriginalRepliedMessageSid || "").trim();
  const hasButtonReply = Boolean(body.ButtonText || body.ButtonPayload);
  const upper = String(message || "").toUpperCase();
  let best = null;

  for (const user of users.values()) {
    const customerState = getStateForUser(user);
    const approval = customerState.ticketApproval;
    if (!approval || approval.status !== "Awaiting user approval") continue;

    let score = 0;
    if (approval.code && upper.includes(approval.code)) score += 1000;
    if (originalMessageId && approval.whatsappMessageId && approval.whatsappMessageId === originalMessageId) score += 900;
    if (hasButtonReply && normalizedFrom && approval.phone && normalizeWhatsAppNumber(approval.phone) === normalizedFrom) score += 600;
    if (normalizedFrom && approval.phone && normalizeWhatsAppNumber(approval.phone) === normalizedFrom) score += 300;
    if (normalizedFrom && normalizeWhatsAppNumber(user.phone) === normalizedFrom) score += 100;
    if (hasButtonReply && approval.whatsappSent) score += 50;
    if (!score) continue;

    const sentAt = Date.parse(approval.whatsappSentAt || approval.createdAt || "") || 0;
    if (!best || score > best.score || (score === best.score && sentAt > best.sentAt)) {
      best = { user, customerState, approval, score, sentAt };
    }
  }

  return best;
}

async function approveUnderproductionTicket(user, source) {
  if (!state.ticketApproval || state.ticketApproval.status !== "Awaiting user approval") {
    return { error: "No underproduction approval is pending.", status: 404 };
  }

  const approval = state.ticketApproval;
  const relatedTicket = findTicketById(approval.ticketId);
  const duplicate = findOpenTicketByType(approval.type, approval.ticketId);
  if (duplicate) {
    return { error: `An open ${approval.type} ticket already exists: ${duplicate.id}. Close it before creating another.`, status: 409 };
  }

  const ticket =
    relatedTicket ||
    createServiceTicket({
      id: approval.ticketId,
      type: approval.type,
      subject: approval.subject,
      description: approval.description,
      source: `Agent approved by ${source}`,
    });

  Object.assign(ticket, {
    type: approval.type,
    title: approval.subject,
    subject: approval.subject,
    status: "Created",
    body: approval.description,
    description: approval.description,
    source: `Agent approved by ${source}`,
    approvedAt: new Date().toISOString(),
  });

  approval.status = "Approved";
  approval.respondedAt = new Date().toISOString();
  approval.respondedBy = source;
  if (!relatedTicket) state.tickets.unshift(ticket);
  addAgentRun({
    title: `Approved: ${ticket.id} underproduction ticket`,
    status: "Completed",
    confidence: 84,
    approvalId: approval.id,
    approvalType: "ticket-underproduction",
    steps: [
      { name: "Observed", detail: `${approval.subject}: ${approval.description}`, status: "done" },
      { name: "Reasoned", detail: "Customer approved escalation, so Solaris can create the company-facing ticket.", status: "done" },
      { name: "Decision", detail: `Create service ticket ${ticket.id}.`, status: "done" },
      { name: "Action", detail: `Ticket ${ticket.id} status changed to ${ticket.status}.`, status: "done" },
      { name: "Verification", detail: "Ticket is visible in maintenance tracker for SLA follow-up.", status: "done" },
      { name: "Outcome", detail: "Solaris can track the issue and remind the company if follow-up is missed.", status: "done" },
      { name: "Learning", detail: "Underproduction escalation should include generation, weather, inverter, and cleaning context.", status: "done" },
    ],
  });
  addEvent(`${source} approved underproduction ticket ${ticket.id}.`);
  const notificationStatus = await sendTicketDecisionWhatsApp(user, ticket, "approved");
  return { ticket, notificationStatus };
}

async function rejectUnderproductionTicket(user, source) {
  if (!state.ticketApproval || state.ticketApproval.status !== "Awaiting user approval") {
    return { error: "No underproduction approval is pending.", status: 404 };
  }

  const approval = state.ticketApproval;
  const ticket = findTicketById(approval.ticketId);
  approval.status = "Rejected";
  approval.respondedAt = new Date().toISOString();
  approval.respondedBy = source;

  if (ticket) {
    ticket.status = "Rejected";
    ticket.body = `${ticket.body} User rejected this underproduction ticket.`;
    ticket.description = ticket.body;
    ticket.rejectedAt = approval.respondedAt;
  }

  addAgentRun({
    title: `Rejected: ${approval.ticketId} underproduction ticket`,
    status: "Completed",
    confidence: 84,
    approvalId: approval.id,
    approvalType: "ticket-underproduction",
    steps: [
      { name: "Observed", detail: `${approval.subject}: ${approval.description}`, status: "done" },
      { name: "Reasoned", detail: "Customer rejected escalation, so Solaris stopped before creating an external service action.", status: "done" },
      { name: "Decision", detail: `Do not create ticket ${approval.ticketId}.`, status: "done" },
      { name: "Action", detail: "Approval rejected and logged.", status: "done" },
      { name: "Verification", detail: "No new external ticket action was taken.", status: "done" },
      { name: "Outcome", detail: "Customer control preserved.", status: "done" },
      { name: "Learning", detail: "Keep this decision available in Mission Control history.", status: "done" },
    ],
  });
  addEvent(`${source} rejected underproduction ticket ${approval.ticketId}.`);
  const notificationStatus = await sendTicketDecisionWhatsApp(user, ticket || approval, "rejected");
  return { ticket: ticket || { id: approval.ticketId, type: approval.type, subject: approval.subject, status: "Rejected" }, notificationStatus };
}

async function sendTicketDecisionWhatsApp(user, ticket, decision) {
  if (!user || !state.preferences.whatsapp) return "WhatsApp alerts are disabled.";
  const text = [
    `Solaris underproduction ticket ${decision}`,
    `Ticket: ${ticket.id || state.ticketApproval.ticketId}`,
    `Subject: ${ticket.subject || ticket.title || state.ticketApproval.subject}`,
    `Status: ${decision === "approved" ? "Created" : "Rejected"}`,
    "",
    decision === "approved"
      ? "Solaris will track this ticket and remind the service company when follow-up is due."
      : "Solaris will not create this underproduction ticket.",
  ].join("\n");

  try {
    const result = await sendWhatsAppAlert(user, text);
    return result.sent ? `WhatsApp ${decision} confirmation sent.` : `WhatsApp ${decision} confirmation preview generated.`;
  } catch (error) {
    return `WhatsApp ${decision} confirmation failed: ${friendlyWhatsAppError(error)}`;
  }
}

function isCleanerLocked() {
  return state.cleaner.active && !state.cleaner.suspended;
}

function cleanerLockedMessage(requestedAction) {
  const scheduleText = state.cleaner.nextSchedule ? `next schedule is ${formatDateTime(state.cleaner.nextSchedule)}` : "next schedule is AI managed";
  return `Panel cleaning already has an active schedule/activity: ${state.cleaner.statusMessage} Current status is ${state.cleaner.state}, mode is ${state.cleaner.mode}, ${scheduleText}. Suspend the current activity first, then ${requestedAction}.`;
}

function toDateTimeLocal(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(value) {
  if (!value) return "not scheduled";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createAppliance(body) {
  const name = String(body.name || "").trim();
  const type = String(body.type || "Other").trim();
  const source = String(body.source || "NILM").trim();

  if (!name) {
    const error = new Error("Appliance name is required.");
    error.status = 400;
    throw error;
  }

  const confidence = source === "Smart plug" ? 98 : source === "Both" ? 90 : 65;
  return {
    id: `appl-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name,
    type,
    kwh: 0,
    cost: 0,
    source,
    confidence,
  };
}

function createServiceTicket(input = {}) {
  const type = String(input.type || "Underproduction").trim();
  const subject = String(input.subject || input.title || "Critical underproduction investigation").trim();
  const description = String(
    input.description ||
      input.body ||
      "Ticket includes expected vs actual production, weather checks, inverter status, and cleaning history.",
  ).trim();

  if (!subject || !description) {
    const error = new Error("Ticket subject and description are required.");
    error.status = 400;
    throw error;
  }

  return {
    id: input.id || generateTicketId(),
    type,
    title: subject,
    subject,
    status: "Created",
    body: description,
    description,
    source: input.source || "Manual",
    createdAt: new Date().toISOString(),
  };
}

function generateTicketId() {
  let id = "";
  do {
    id = `SOL-${Math.floor(3000 + Math.random() * 6000)}`;
  } while (findTicketById(id));
  return id;
}

function findOpenTicketByType(type, ignoreTicketId = "") {
  const normalized = String(type || "").trim().toLowerCase();
  if (!normalized || normalized === "other") return null;
  return state.tickets.find(
    (ticket) =>
      ticket.id !== ignoreTicketId &&
      ticket.type?.toLowerCase() === normalized &&
      !["Closed", "Resolved"].includes(ticket.status),
  );
}

function findTicketById(id) {
  return state.tickets.find((ticket) => ticket.id === id);
}

function ticketDraftKey(user, session) {
  return `${user.id}:${session?.level || "chat"}`;
}

function ticketTypes() {
  return ["Underproduction", "Inverter Fault", "Battery Issue", "Communication Failure", "Cleaning", "Billing", "Other"];
}

function parseTicketDraft(message, existing = {}) {
  const text = message.trim();
  const lower = text.toLowerCase();
  const draft = { ...existing };
  const matchedType = ticketTypes().find((type) => lower.includes(type.toLowerCase()));
  const isTypeOnlyReply = matchedType && lower === matchedType.toLowerCase();

  if (matchedType) draft.type = matchedType;
  else if (lower.includes("low production") || lower.includes("under production")) draft.type = "Underproduction";
  else if (lower.includes("inverter")) draft.type = "Inverter Fault";
  else if (lower.includes("battery")) draft.type = "Battery Issue";
  else if (lower.includes("communication") || lower.includes("offline")) draft.type = "Communication Failure";
  else if (lower.includes("clean")) draft.type = "Cleaning";
  else if (lower.includes("bill")) draft.type = "Billing";

  const subjectMatch = text.match(/subject\s*[:\-]\s*([^|]+?)(?:\s+description\s*[:\-]|$)/i);
  const descriptionMatch = text.match(/description\s*[:\-]\s*(.+)$/i);
  if (subjectMatch) draft.subject = subjectMatch[1].trim();
  if (descriptionMatch) draft.description = descriptionMatch[1].trim();

  if (!draft.subject && !isTypeOnlyReply && !/^(create|raise|open)\b/i.test(text) && text.length <= 90 && !descriptionMatch) {
    draft.subject = text;
  } else if (!draft.description && existing.subject && !descriptionMatch && text.length > 8) {
    draft.description = text;
  }

  return draft;
}

function missingTicketField(draft) {
  if (!draft.type) return "type";
  if (!draft.subject) return "subject";
  if (!draft.description) return "description";
  return "";
}

function ticketFieldPrompt(field, draft = {}) {
  if (field === "type") {
    return agentReply(
      "ticket-input-needed",
      "What type of ticket should I create?",
      [`Choose one: ${ticketTypes().join(", ")}.`],
      false,
    );
  }
  if (field === "subject") {
    return agentReply("ticket-input-needed", `Got the type: ${draft.type}. What should be the ticket subject?`, ["Example: Inverter offline since morning."], false);
  }
  return agentReply(
    "ticket-input-needed",
    `Got the type and subject. Please provide a short description for the ${draft.type} ticket.`,
    ["Include when it started, what you observed, and any error message if available."],
    false,
  );
}

async function ensureTicketApprovalWhatsApp(user) {
  ensureUnderproductionApproval(user);

  const approval = state.ticketApproval;
  if (!user || !approval || approval.status !== "Awaiting user approval") return;
  if (findOpenTicketByType(approval.type, approval.ticketId)) return;

  if (!approval.code) approval.code = createShortCode();
  approval.userId = user.id;
  approval.phone = whatsappApprovalRecipient(user);

  const text = [
    "Solaris ticket approval needed",
    `Customer: ${user.customerId}`,
    "",
    "Solaris detected an underproduction issue and needs your approval before creating a service ticket.",
    `Ticket: ${approval.ticketId}`,
    `Subject: ${approval.subject}`,
    `Severity: ${approval.severity}`,
    approval.description,
    "",
    "This ticket is waiting for your approval.",
    "Use the Approve or Reject button in the next WhatsApp message.",
  ].join("\n");

  if (state.preferences.whatsapp && !approval.whatsappSent) {
    try {
      const result = await sendTicketApprovalWhatsApp(user, approval, text);
      approval.whatsappSent = true;
      approval.whatsappSentAt = new Date().toISOString();
      approval.whatsappMessageId = result.messageId || "";
      approval.whatsappProvider = result.provider || whatsappProvider();
      addEvent(result.sent ? `Underproduction approval WhatsApp sent to ${user.phone}.` : `Underproduction approval WhatsApp preview generated for ${user.phone}.`);
    } catch (error) {
      addEvent(`Underproduction approval WhatsApp failed for ${user.phone}: ${friendlyWhatsAppError(error)}`);
    }
  }
}

function ensureUnderproductionApproval(user) {
  if (!user) return;
  if (state.ticketApproval) return;
  if (findOpenTicketByType("Underproduction")) return;
  if (!isUnderproductionDetected()) return;

  const ticketId = generateTicketId();
  const createdAt = new Date().toISOString();
  const subject = "Solar production is below expected";
  const description =
    "Solaris detected production below expected for multiple clear periods. Recommended ticket includes generation comparison, weather context, inverter status, and cleaning history.";

  state.ticketApproval = {
    id: `APR-${ticketId}`,
    ticketId,
    code: "",
    type: "Underproduction",
    subject,
    description,
    status: "Awaiting user approval",
    severity: "Medium",
    whatsappSent: false,
    createdAt,
    userId: user.id,
  };

  state.tickets.unshift({
    id: ticketId,
    type: "Underproduction",
    title: subject,
    subject,
    status: "Awaiting user approval",
    body: description,
    description,
    source: "Agent",
    createdAt,
  });

  addAgentRun({
    title: `Auto-run: ${ticketId} approval needed`,
    status: "Waiting for Approval",
    confidence: 84,
    approvalId: state.ticketApproval.id,
    approvalType: "ticket-underproduction",
    steps: [
      { name: "Observed", detail: "Solaris detected production below expected for multiple clear periods.", status: "done" },
      { name: "Reasoned", detail: "The issue may need company investigation, so Solaris prepared evidence instead of creating a ticket silently.", status: "done" },
      { name: "Decision", detail: `Ask customer approval before creating underproduction ticket ${ticketId}.`, status: "done" },
      { name: "Action", detail: "Waiting for customer approval in Mission Control and WhatsApp.", status: "ready" },
      { name: "Verification", detail: "After approval, Solaris will create the ticket and track the ticket status.", status: "ready" },
      { name: "Outcome", detail: "Expected result: faster service escalation with generation evidence.", status: "ready" },
      { name: "Learning", detail: "Keep external escalation behind customer approval.", status: "done" },
    ],
  });
  addEvent(`Solaris detected underproduction and prepared ticket ${ticketId} for user approval.`);
}

function isUnderproductionDetected() {
  const impact = Number(String(state.cleaner.productionImpact || "0").replace(/[^0-9.-]/g, ""));
  return impact <= -8 || state.metrics.healthScore < 95;
}

function refreshAgentInsights(user) {
  state.agentInsights = {
    peerBenchmark: buildPeerBenchmarkInsight(),
    bill: buildBillExplainerInsight(),
    weather: buildWeatherForecastInsight(),
    diagnosis: buildUnderperformanceDiagnosisInsight(),
    warranty: buildWarrantyInsight(),
    cleaningRoi: buildCleaningRoiInsight(),
    surplus: buildSurplusAutomationInsight(),
  };
  if (user) state.agentInsights.customerId = user.customerId;
  return state.agentInsights;
}

function buildBillExplainerInsight() {
  const { latestBill, previousBill } = getCompletedBillComparison();
  const importCost = Math.round(latestBill.gridImportKwh * state.site.tariffPerKwh);
  const exportCredit = latestBill.exportCredit || 0;
  const netVariable = Math.max(0, importCost - exportCredit);
  const nightShare = Math.round((state.metrics.nightUsage / Math.max(1, state.metrics.todayGeneration)) * 100);
  const change = latestBill.amount - previousBill.amount;
  const trend = change <= 0 ? "lower" : "higher";
  const currentCycle = state.bill.currentCycle?.month ? `${state.bill.currentCycle.month} is still ${String(state.bill.currentCycle.status || "in progress").toLowerCase()}, so Solaris is using the last generated bill.` : "Solaris is using the last generated bill.";
  return {
    title: "Solar Bill Explainer",
    status: trend === "lower" ? "Bill improving" : "Bill attention needed",
    summary: `${latestBill.month} bill is Rs ${latestBill.amount}, ${trend} than ${previousBill.month} by Rs ${Math.abs(change)}.`,
    evidence: [
      currentCycle,
      `Grid import: ${latestBill.gridImportKwh} kWh, about Rs ${importCost}.`,
      `Export credit: Rs ${exportCredit}; net energy charge estimate is Rs ${netVariable}.`,
      `Night usage is ${state.metrics.nightUsage.toFixed(1)} kWh, about ${nightShare}% of today's generation.`,
    ],
    action: "Shift geyser, pump, washing machine, and EV charging to the solar window to reduce grid import.",
  };
}

function buildBillUsageControlOverview() {
  const days = 30;
  const projectedGridImportKwh = Number((Number(state.metrics.nightUsage || 0) * days).toFixed(1));
  const importCost = Math.round(projectedGridImportKwh * Number(state.site.tariffPerKwh || 0));
  const exportCredit = Math.round(Number(state.metrics.exported || 0) * days * Number(state.site.exportRatePerKwh || 0));
  const fixedCharges = Number(state.bill.fixedCharges || 0);
  const projectedPayable = Math.max(0, importCost + fixedCharges - exportCredit);
  const rankedAppliances = [...(state.appliances || [])]
    .sort((a, b) => Number(b.cost || 0) - Number(a.cost || 0))
    .slice(0, 5);
  const totalTrackedCost = rankedAppliances.reduce((sum, item) => sum + Number(item.cost || 0), 0) || 1;
  return {
    month: state.bill.currentCycle?.month || state.bill.month || "Current cycle",
    projectedPayable,
    projectedGridImportKwh,
    importCost,
    exportCredit,
    fixedCharges,
    appliances: rankedAppliances.map((item, index) => ({
      ...item,
      share: Math.round((Number(item.cost || 0) / totalTrackedCost) * 100),
      action: applianceLimitAdvice(item, index),
    })),
  };
}

function applianceLimitAdvice(item, index) {
  const type = String(item.type || item.name || "").toLowerCase();
  if (type.includes("ac")) return "Limit night runtime, use timer, and keep setpoint near 25-26 C.";
  if (type.includes("ev")) return "Charge between 12 PM - 3 PM when solar surplus is strongest.";
  if (type.includes("geyser")) return "Heat water during daylight and avoid repeated night heating.";
  if (type.includes("pump") || type.includes("washing") || type.includes("dishwasher")) return "Schedule this flexible load in solar hours instead of evening.";
  if (type.includes("fridge")) return "Do not switch off; check door seal and temperature setting.";
  return index === 0 ? "Limit runtime or shift this load to solar hours where practical." : "Monitor trend and shift flexible usage to solar hours.";
}

function buildPaymentLink({ method, invoiceNumber, amount }) {
  if (!method || !invoiceNumber || !Number.isFinite(amount) || amount <= 0) {
    return { error: "Payment method, invoice number, and amount are required." };
  }
  const paymentUrl = process.env.PAYMENT_URL || "";
  const upiId = process.env.UPI_ID || "";
  const upiName = process.env.UPI_NAME || "Solaris";
  if (method === "UPI" && upiId) {
    const params = new URLSearchParams({
      pa: upiId,
      pn: upiName,
      am: String(amount),
      cu: "INR",
      tn: invoiceNumber,
    });
    return {
      configured: true,
      provider: "UPI",
      paymentUrl: `upi://pay?${params.toString()}`,
      message: "UPI payment link generated. Open it on a device with a UPI app installed.",
    };
  }
  if (paymentUrl) {
    const separator = paymentUrl.includes("?") ? "&" : "?";
    return {
      configured: true,
      provider: method,
      paymentUrl: `${paymentUrl}${separator}invoice=${encodeURIComponent(invoiceNumber)}&amount=${encodeURIComponent(amount)}&method=${encodeURIComponent(method)}`,
      message: "Payment gateway link generated. Payment confirmation must come from the gateway/webhook.",
    };
  }
  return {
    configured: false,
    error: "Payment gateway is not configured. Set PAYMENT_URL or UPI_ID in the hosting environment.",
  };
}

function getCompletedBillComparison() {
  const completedBills = Array.isArray(state.bill.completedBills) ? state.bill.completedBills : [];
  const fallbackLatest = {
    month: state.bill.month || "Latest completed month",
    amount: state.bill.amount || 0,
    gridImportKwh: state.bill.gridImportKwh || 0,
    exportCredit: state.bill.exportCredit || 0,
    fixedCharges: state.bill.fixedCharges || 0,
  };
  const fallbackPrevious = {
    ...fallbackLatest,
    month: "Previous month",
    amount: state.bill.previousAmount || fallbackLatest.amount,
  };
  const sortedBills = completedBills.slice().sort((a, b) => monthSortValue(a.month) - monthSortValue(b.month));
  return {
    latestBill: sortedBills.at(-1) || fallbackLatest,
    previousBill: sortedBills.at(-2) || fallbackPrevious,
  };
}

function monthSortValue(monthLabel = "") {
  const parsed = new Date(`${monthLabel} 01`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function analyzePeerBenchmark() {
  const peer = state.peerBenchmark || {};
  const actualGeneration = Number(state.metrics.todayGeneration || 0);
  const peerGeneration = Number(peer.medianDailyGenerationKwh || state.site.expectedTodayKwh || 1);
  const generationGapPercent = Math.round(((actualGeneration - peerGeneration) / Math.max(1, peerGeneration)) * 100);
  const nightUsageGapPercent = Math.round(((state.metrics.nightUsage - (peer.medianNightUsageKwh || 1)) / Math.max(1, peer.medianNightUsageKwh || 1)) * 100);
  const selfConsumptionGap = Math.round(state.metrics.selfConsumption - (peer.medianSelfConsumption || state.metrics.selfConsumption));
  const exportGapPercent = Math.round(((state.metrics.exported - (peer.medianExportKwh || 1)) / Math.max(1, peer.medianExportKwh || 1)) * 100);
  const performancePercentile = Math.max(8, Math.min(96, Math.round(50 + generationGapPercent * 1.6 + selfConsumptionGap * 0.7 - Math.max(0, nightUsageGapPercent) * 0.15)));
  const rankLabel = performancePercentile >= 75 ? "Top performer" : performancePercentile >= 50 ? "Above peer median" : performancePercentile >= 35 ? "Improvement opportunity" : "Needs attention";
  const priority =
    generationGapPercent <= -8
      ? "Review underproduction and cleaning signals"
      : nightUsageGapPercent >= 20
        ? "Reduce night import by shifting flexible loads"
        : selfConsumptionGap < -5
          ? "Increase self-consumption during solar hours"
          : "Maintain current operating pattern";

  return {
    region: peer.region || "similar solar homes",
    peerHomes: peer.peerHomes || 0,
    systemSizeRange: peer.systemSizeRange || "similar rooftop systems",
    roofProfile: peer.roofProfile || "similar roof profile",
    performancePercentile,
    rankLabel,
    generationGapPercent,
    nightUsageGapPercent,
    selfConsumptionGap,
    exportGapPercent,
    priority,
  };
}

function buildPeerBenchmarkInsight() {
  const benchmark = analyzePeerBenchmark();
  return {
    title: "Solar Peer Benchmark Agent",
    status: benchmark.rankLabel,
    summary: `Your solar site is performing better than about ${benchmark.performancePercentile}% of ${benchmark.systemSizeRange} in ${benchmark.region}.`,
    evidence: [
      `Compared with ${benchmark.peerHomes} similar homes and ${benchmark.roofProfile}.`,
      `Generation is ${formatSignedPercent(benchmark.generationGapPercent)} vs peer median.`,
      `Night usage is ${formatSignedPercent(benchmark.nightUsageGapPercent)} vs peer median.`,
      `Self-consumption is ${formatSignedNumber(benchmark.selfConsumptionGap)} points vs peer median.`,
    ],
    action: benchmark.priority,
  };
}

function formatSignedPercent(value) {
  return `${value > 0 ? "+" : ""}${value}%`;
}

function formatSignedNumber(value) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function buildWeatherForecastInsight() {
  const expected = state.weather.forecastGenerationKwh;
  const plan = expected >= state.site.expectedTodayKwh * 0.9 ? "Run flexible appliances during solar hours." : "Keep heavy loads light and expect more grid support.";
  return {
    title: "Weather-Aware Solar Forecast",
    status: state.weather.tomorrow,
    summary: `Tomorrow forecast is ${state.weather.tomorrow.toLowerCase()} with about ${expected.toFixed(1)} kWh expected generation.`,
    evidence: [
      `Best solar window: ${state.weather.bestSolarWindow}.`,
      `Rain chance: ${state.weather.rainChance}%.`,
      `Expected vs clean-day target: ${expected.toFixed(1)} / ${state.site.expectedTodayKwh.toFixed(1)} kWh.`,
    ],
    action: plan,
  };
}

function buildUnderperformanceDiagnosisInsight() {
  const gap = Math.round(((state.site.expectedTodayKwh - state.metrics.todayGeneration) / state.site.expectedTodayKwh) * 100);
  const impact = Number(String(state.cleaner.productionImpact || "0").replace(/[^0-9.-]/g, ""));
  const likelyCause = gap >= 15 ? "Service investigation recommended" : impact <= -8 ? "Dust or soiling likely" : "Within watch range";
  return {
    title: "Underperformance Diagnosis",
    status: likelyCause,
    summary: `Today generation is ${Math.max(0, gap)}% below the expected clean-day target.`,
    evidence: [
      `Actual: ${state.metrics.todayGeneration.toFixed(1)} kWh.`,
      `Expected: ${state.site.expectedTodayKwh.toFixed(1)} kWh.`,
      `Cleaning impact signal: ${state.cleaner.productionImpact}.`,
    ],
    action: gap >= 15 ? "Approve an underproduction ticket so Solaris can escalate with evidence." : "Keep monitoring; clean if the loss persists and no rain is expected.",
  };
}

function buildWarrantyInsight() {
  const amcDays = daysUntil(state.warranty.amcExpiry);
  const inverterDays = daysUntil(state.warranty.inverterWarrantyExpiry);
  const status = amcDays <= 60 ? "AMC renewal due soon" : "Coverage active";
  return {
    title: "Warranty & AMC Tracker",
    status,
    summary: `AMC is valid until ${formatDateOnly(state.warranty.amcExpiry)} with ${amcDays} days remaining.`,
    evidence: [
      `Inverter warranty: ${formatDateOnly(state.warranty.inverterWarrantyExpiry)} (${inverterDays} days remaining).`,
      `Panel warranty: ${formatDateOnly(state.warranty.panelWarrantyExpiry)}.`,
      `Service contact: ${state.warranty.installer}, ${state.warranty.servicePhone}.`,
    ],
    action: amcDays <= 60 ? "Renew AMC before expiry and include warranty details in service tickets." : "Warranty details are ready to attach when Solaris raises a ticket.",
  };
}

function buildCleaningRoiInsight() {
  const lossPercent = Math.abs(Number(String(state.cleaner.productionImpact || "0").replace(/[^0-9.-]/g, "")) || 0);
  const recoveredKwh = Number((state.metrics.todayGeneration * (lossPercent / 100)).toFixed(1));
  const valuePerDay = Math.round(recoveredKwh * state.site.tariffPerKwh);
  const rainSoon = state.weather.rainChance >= 45;
  return {
    title: "Cleaning ROI Agent",
    status: rainSoon ? "Wait for weather" : lossPercent >= 8 ? "Cleaning worth considering" : "Cleaning not urgent",
    summary: `Current dust signal suggests about ${lossPercent}% production loss, roughly ${recoveredKwh.toFixed(1)} kWh/day recoverable.`,
    evidence: [
      `Estimated value: Rs ${valuePerDay}/day at Rs ${state.site.tariffPerKwh.toFixed(1)}/kWh.`,
      `Rain chance: ${state.weather.rainChance}%.`,
      `Last cleaning: ${state.cleaner.lastCleaning}.`,
    ],
    action: rainSoon ? "Wait before cleaning because rain may reduce dust naturally." : "Schedule cleaning if panels are visibly dusty or loss continues tomorrow.",
  };
}

function analyzeSolarSurplus() {
  const currentSurplusKw = Number(Math.max(0, state.metrics.solarNow - state.metrics.currentLoad).toFixed(1));
  const forecastSurplusKwh = Number(Math.max(0, state.weather.forecastGenerationKwh - state.metrics.nightUsage - state.metrics.exported).toFixed(1));
  const usableSurplusKwh = Number(Math.max(currentSurplusKw * 2, forecastSurplusKwh * 0.35).toFixed(1));
  const exportLoss = Math.max(0, state.site.tariffPerKwh - state.site.exportRatePerKwh);
  const savings = Math.round(usableSurplusKwh * exportLoss);
  const flexibleLoads = state.appliances
    .filter((item) => ["EV Charger", "Pump", "Washing Machine", "Dishwasher", "Geyser"].includes(item.type) || /ev|pump|washing|dishwasher|geyser/i.test(item.name))
    .sort((a, b) => surplusLoadPriority(b) - surplusLoadPriority(a) || b.kwh - a.kwh)
    .slice(0, 3);
  const fallbackLoads = ["EV charging", "Water pump", "Washing machine"];
  const recommendedLoads = flexibleLoads.length ? flexibleLoads.map((item) => item.name) : fallbackLoads;
  const shouldActNow = currentSurplusKw >= 1.5 && state.weather.rainChance < 40;
  const status = shouldActNow ? "Surplus available now" : usableSurplusKwh >= 3 ? "Plan solar window" : "Low surplus watch";

  return {
    currentSurplusKw,
    usableSurplusKwh,
    savings,
    recommendedLoads,
    bestWindow: state.weather.bestSolarWindow,
    shouldActNow,
    status,
  };
}

function surplusLoadPriority(item) {
  const text = `${item.type || ""} ${item.name || ""}`.toLowerCase();
  if (text.includes("ev")) return 100;
  if (text.includes("battery")) return 90;
  if (text.includes("pump")) return 75;
  if (text.includes("dishwasher")) return 70;
  if (text.includes("washing")) return 65;
  if (text.includes("geyser")) return 30;
  return 50;
}

function buildSurplusAutomationInsight() {
  const surplus = analyzeSolarSurplus();
  return {
    title: "Solar Surplus Automation",
    status: surplus.status,
    summary: surplus.shouldActNow
      ? `Solaris sees about ${surplus.currentSurplusKw.toFixed(1)} kW surplus now and can shift flexible loads into the solar window.`
      : `Solaris is tracking about ${surplus.usableSurplusKwh.toFixed(1)} kWh usable surplus for ${surplus.bestWindow}.`,
    evidence: [
      `Current solar: ${state.metrics.solarNow.toFixed(1)} kW; current load: ${state.metrics.currentLoad.toFixed(1)} kW.`,
      `Best window: ${surplus.bestWindow}.`,
      `Suggested loads: ${surplus.recommendedLoads.join(", ")}.`,
      "EV charging is prioritized for 12 PM - 3 PM; geyser is lower priority unless hot water is actually needed.",
      `Estimated value: Rs ${surplus.savings} by using solar instead of exporting or importing later.`,
    ],
    action: surplus.shouldActNow
      ? `Start ${surplus.recommendedLoads[0]} during the solar window or ask Solaris to add a reminder.`
      : `Ask Solaris to create a reminder for ${surplus.bestWindow} before running heavy appliances.`,
  };
}

function buildPeerBenchmarkReply() {
  const insight = buildPeerBenchmarkInsight();
  const benchmark = analyzePeerBenchmark();
  addAgentRun({
    title: "Solar peer benchmark analysis",
    status: "Completed",
    confidence: 87,
    steps: [
      { name: "Observed", detail: `Compared generation, night usage, export, and self-consumption against ${benchmark.peerHomes} similar ${benchmark.systemSizeRange} in ${benchmark.region}.`, status: "done" },
      { name: "Reasoned", detail: `Peer percentile is ${benchmark.performancePercentile}%. Generation gap ${formatSignedPercent(benchmark.generationGapPercent)}, night usage gap ${formatSignedPercent(benchmark.nightUsageGapPercent)}, self-consumption gap ${formatSignedNumber(benchmark.selfConsumptionGap)} points.`, status: "done" },
      { name: "Decision", detail: benchmark.priority, status: "done" },
      { name: "Action", detail: "Prepared a customer-safe improvement path without exposing personal customer data.", status: "done" },
      { name: "Verification", detail: "Solaris will compare the next billing and generation cycle against peer median again.", status: "ready" },
      { name: "Learning", detail: "Store peer benchmark as a recurring weekly coaching signal.", status: "done" },
    ],
  });
  rememberAgentPreference(
    "peer-benchmark-coaching",
    `Use ${benchmark.region} peer benchmark as a weekly improvement coach.`,
    `Latest rank: ${benchmark.performancePercentile}th percentile; priority: ${benchmark.priority}.`,
  );
  addEvent(`Solaris ran Solar Peer Benchmark Agent: ${benchmark.performancePercentile}th percentile in ${benchmark.region}.`);
  return insightAgentReply("solar-peer-benchmark", insight, true);
}

function daysUntil(dateText) {
  const target = new Date(`${dateText}T00:00:00`);
  return Math.ceil((target.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function formatDateOnly(dateText) {
  return new Date(`${dateText}T00:00:00`).toLocaleDateString([], { year: "numeric", month: "short", day: "2-digit" });
}

async function sendTicketApprovalWhatsApp(user, approval, fallbackText) {
  const contentSid = process.env.TWILIO_TICKET_APPROVAL_CONTENT_SID || "HX184176c08a28304b008fdc2559d7d60a";
  const variables = {
    1: user.customerId,
    2: approval.ticketId,
    3: approval.subject,
    4: approval.severity,
    5: approval.description,
    6: approval.code,
  };

  try {
    if (whatsappProvider() === "twilio" && contentSid) {
      await sendWhatsAppAlert(user, fallbackText);
      const buttonText = [
        "Solaris approval action",
        `Ticket: ${approval.ticketId}`,
        "Tap Approve to create this underproduction service ticket, or Reject to cancel it.",
      ].join("\n");
      return await sendSolarisWhatsAppContent({
        to: user.phone,
        contentSid,
        variables,
        fallbackText: buttonText,
      });
    }

    return await sendSolarisWhatsAppContent({
      to: user.phone,
      contentSid,
      variables,
      fallbackText,
    });
  } catch (error) {
    addEvent(`Twilio ticket approval template failed, using text fallback: ${friendlyWhatsAppError(error)}`);
    return await sendWhatsAppAlert(user, fallbackText);
  }
}

function whatsappApprovalRecipient(user) {
  if (whatsappProvider() === "twilio" && process.env.TWILIO_WHATSAPP_TO) {
    return `+${normalizeWhatsAppNumber(process.env.TWILIO_WHATSAPP_TO)}`;
  }
  if (whatsappProvider() === "callmebot" && process.env.CALLMEBOT_PHONE) {
    return `+${normalizeWhatsAppNumber(process.env.CALLMEBOT_PHONE)}`;
  }
  return user.phone;
}

function parseApplianceCommand(message) {
  const text = message.trim();
  const lower = text.toLowerCase();
  const match = text.match(/add\s+(?:new\s+)?appliance\s+(.+?)(?:\s+using\s+|\s+with\s+|\s+as\s+|$)/i);
  const rawName = match?.[1]?.trim() || "";
  const name = rawName || text.replace(/add|new|appliance/gi, "").trim();
  const source = lower.includes("smart plug") && lower.includes("nilm") ? "Both" : lower.includes("smart plug") ? "Smart plug" : lower.includes("both") ? "Both" : "NILM";
  const knownTypes = ["AC", "Fridge", "Geyser", "Pump", "Washing Machine", "Dishwasher", "EV Charger", "Kitchen", "Other"];
  const type = knownTypes.find((item) => lower.includes(item.toLowerCase())) || "Other";
  return { name, type, source };
}

function parseCleaningSchedule(message) {
  const now = new Date();
  const text = message.toLowerCase();
  const date = new Date(now);

  if (text.includes("tomorrow")) date.setDate(date.getDate() + 1);
  else if (text.includes("today")) date.setDate(date.getDate());
  else date.setDate(date.getDate() + 1);

  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] || 0);
    const meridiem = timeMatch[3];
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    date.setHours(hour, minute, 0, 0);
  } else {
    date.setHours(6, 0, 0, 0);
  }

  return toDateTimeLocal(date);
}

function hasSuspendCleaningIntent(text) {
  return includesAny(text, ["suspend cleaning", "suspend current cleaning", "suspend cleaner", "suspend current activity", "pause schedule"]);
}

function hasScheduleCleaningIntent(text) {
  return includesAny(text, ["schedule cleaning", "set cleaning", "cleaning schedule"]) || (text.includes("schedule") && text.includes("clean"));
}

function hasReportSendIntent(text) {
  return (
    includesAny(text, ["send report", "send me report", "send the report", "send detail", "send details", "send me details", "share report", "share details"]) ||
    (text.includes("send") && includesAny(text, ["report", "details", "detail", "data", "summary"]))
  );
}

function hasCalendarPlanIntent(text) {
  return (
    includesAny(text, ["calendar", "google calendar", "future trigger", "reminder", "add plan"]) &&
    includesAny(text, ["clean", "cleaning", "ev", "charging", "charge", "battery", "appliance", "schedule", "plan"])
  );
}

function hasSurplusAutomationIntent(text) {
  return (
    includesAny(text, ["solar surplus", "surplus automation", "surplus optimizer", "optimize surplus", "extra solar", "excess solar"]) ||
    (includesAny(text, ["ev", "charging", "dishwasher", "washing", "pump", "geyser", "battery", "appliance"]) &&
      includesAny(text, ["surplus", "solar window", "best window", "solar hours", "optimize"]))
  );
}

function parseReportChannel(text) {
  const normalized = String(text || "").toLowerCase();
  const wantsEmail = includesAny(normalized, ["email", "mail", "gmail"]);
  const wantsWhatsApp = includesAny(normalized, ["whatsapp", "whats app", "wa"]);
  if (includesAny(normalized, ["both", "all channels"]) || (wantsEmail && wantsWhatsApp)) return "both";
  if (wantsWhatsApp) return "whatsapp";
  if (wantsEmail) return "email";
  return "";
}

function parseReportType(text) {
  const normalized = String(text || "").toLowerCase();
  if (normalized.includes("month")) return "monthly";
  if (normalized.includes("week")) return "weekly";
  return "daily";
}

function applyCleaningSchedule(message) {
  const nextSchedule = parseCleaningSchedule(message);
  state.cleaner.mode = "Scheduled";
  state.cleaner.nextSchedule = nextSchedule;
  state.cleaner.active = true;
  state.cleaner.suspended = false;
  state.cleaner.state = "Ready";
  state.cleaner.statusMessage = `Cleaning schedule active for ${formatDateTime(nextSchedule)}.`;
  return nextSchedule;
}

function normalizeCalendarPlan(body = {}) {
  const planType = String(body.planType || body.type || "Solaris Plan").trim();
  const title = String(body.title || body.summary || planType).trim();
  const start = body.start || body.nextSchedule || defaultPlanStart(planType);
  return {
    planType,
    title,
    description: String(body.description || `Solaris planned ${title}.`).trim(),
    start,
    durationMinutes: Number(body.durationMinutes || defaultPlanDuration(planType)),
  };
}

function parseCalendarPlan(message) {
  const text = String(message || "").toLowerCase();
  let planType = "Solaris Plan";
  let title = "Solaris plan";
  let description = "Solaris scheduled this plan for the customer.";

  if (includesAny(text, ["clean", "cleaning", "panel wash", "washer"])) {
    planType = "Cleaning";
    title = "Solar panel cleaning";
    description = "Solaris scheduled solar panel cleaning with weather, water, and maintenance safety checks.";
  } else if (includesAny(text, ["ev", "vehicle", "car"]) && includesAny(text, ["charge", "charging"])) {
    planType = "EV Charging";
    title = "EV charging during solar window";
    description = "Solaris planned EV charging during a solar-friendly time window to reduce grid import.";
  } else if (includesAny(text, ["battery", "bess"])) {
    planType = "Battery Charging";
    title = "Battery charging plan";
    description = "Solaris planned battery charging based on expected solar generation and load.";
  } else if (includesAny(text, ["appliance", "washing", "dishwasher", "pump", "geyser"])) {
    planType = "Appliance Usage";
    title = "Solar appliance usage plan";
    description = "Solaris planned appliance usage for a better solar self-consumption window.";
  }

  return {
    planType,
    title,
    description,
    start: parsePlanSchedule(message, planType),
    durationMinutes: defaultPlanDuration(planType),
  };
}

function parsePlanSchedule(message, planType) {
  if (String(planType).toLowerCase().includes("clean")) return parseCleaningSchedule(message);

  const now = new Date();
  const text = String(message || "").toLowerCase();
  const date = new Date(now);
  const isoDate = text.match(/(\d{4}-\d{2}-\d{2})/);

  if (isoDate) {
    const [year, month, day] = isoDate[1].split("-").map(Number);
    date.setFullYear(year, month - 1, day);
  } else if (text.includes("tomorrow")) {
    date.setDate(date.getDate() + 1);
  } else if (!text.includes("today")) {
    date.setDate(date.getDate() + 1);
  }

  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] || 0);
    const meridiem = timeMatch[3];
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    date.setHours(hour, minute, 0, 0);
  } else {
    date.setHours(defaultPlanHour(planType), 0, 0, 0);
  }

  return toDateTimeLocal(date);
}

function defaultPlanStart(planType) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(defaultPlanHour(planType), 0, 0, 0);
  return toDateTimeLocal(date);
}

function defaultPlanHour(planType) {
  const normalized = String(planType || "").toLowerCase();
  if (normalized.includes("clean")) return 6;
  if (normalized.includes("ev") || normalized.includes("battery") || normalized.includes("appliance")) return 12;
  return 10;
}

function defaultPlanDuration(planType) {
  const normalized = String(planType || "").toLowerCase();
  if (normalized.includes("ev")) return 120;
  if (normalized.includes("battery")) return 90;
  return 60;
}

async function createCalendarPlan(user, plan) {
  if (!user) return { ok: false, status: 401, error: "Customer session is required to add a Google Calendar plan." };
  if (!state.preferences.calendar) return { ok: false, status: 403, error: "Google Calendar plans are disabled for this customer." };

  const normalized = normalizeCalendarPlan(plan);
  const description = [
    normalized.description,
    "",
    `Customer: ${user.name} (${user.customerId})`,
    `Site: ${user.address}`,
    `Source: ${plan.source || "Solaris Agent"}`,
  ].join("\n");

  try {
    const result = await createSolarisCalendarEvent({
      planType: normalized.planType,
      summary: normalized.title,
      description,
      start: normalized.start,
      durationMinutes: normalized.durationMinutes,
    });
    const statusText = result.sent
      ? `Google Calendar plan created for ${formatDateTime(normalized.start)}.`
      : `Google Calendar reminder link ready for ${formatDateTime(normalized.start)}. Open the link and save it to your calendar.`;
    addEvent(result.sent ? `Google Calendar plan created: ${normalized.title}.` : `Google Calendar reminder link generated: ${normalized.title}.`);
    return { ok: true, plan: normalized, result, statusText };
  } catch (error) {
    const message = friendlyCalendarError(error);
    addEvent(`Google Calendar plan failed: ${message}`);
    return { ok: false, status: 502, plan: normalized, error: message };
  }
}

function surplusReminderStart() {
  const windowText = String(state.weather.bestSolarWindow || "12 PM - 3 PM");
  const match = windowText.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  const date = new Date();
  let hour = 12;
  let minute = 0;
  if (match) {
    hour = Number(match[1]);
    minute = Number(match[2] || 0);
    const meridiem = String(match[3] || "").toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() < Date.now()) date.setDate(date.getDate() + 1);
  return toDateTimeLocal(date);
}

async function buildSurplusAutomationReply(user, options = {}) {
  const surplus = analyzeSolarSurplus();
  rememberAgentPreference(
    "surplus-preference",
    "Prefer EV charging during 12 PM - 3 PM solar surplus.",
    "Solaris prioritizes flexible EV charging over geyser unless hot water is needed.",
  );
  const details = [
    `Current surplus: ${surplus.currentSurplusKw.toFixed(1)} kW.`,
    `Best solar window: ${surplus.bestWindow}.`,
    `Recommended flexible loads: ${surplus.recommendedLoads.join(", ")}.`,
    "Priority logic: EV charging first for 12 PM - 3 PM; geyser only if hot water is needed.",
    `Estimated value: Rs ${surplus.savings} if shifted into solar hours.`,
    surplus.shouldActNow ? "Action: start the top flexible load now if it is safe and convenient." : "Action: prepare a reminder for the next solar window.",
  ];

  if (options.createReminder) {
    const calendarResult = await createCalendarPlan(user, {
      planType: "Appliance Usage",
      title: `Solar surplus window: ${surplus.recommendedLoads[0]}`,
      description: `Solaris recommends using ${surplus.recommendedLoads.join(", ")} during ${surplus.bestWindow}. EV charging is prioritized; geyser is lower priority unless hot water is needed. Current surplus is ${surplus.currentSurplusKw.toFixed(1)} kW and estimated value is Rs ${surplus.savings}.`,
      start: surplusReminderStart(),
      durationMinutes: 180,
      source: "Solar Surplus Automation Agent",
    });
    details.push(calendarResult.statusText || calendarResult.error);
    if (calendarResult.result?.htmlLink) details.push(`Calendar reminder link: ${calendarResult.result.htmlLink}`);
  }

  addAgentRun({
    title: "Solar surplus automation",
    status: options.createReminder ? "Completed" : "Ready",
    confidence: surplus.shouldActNow ? 88 : 78,
    steps: [
      { name: "Observed", detail: `${surplus.currentSurplusKw.toFixed(1)} kW current surplus and best window ${surplus.bestWindow}.`, status: "done" },
      { name: "Reasoned", detail: "EV charging is a better 12 PM - 3 PM use case than geyser unless hot water is needed.", status: "done" },
      { name: "Decision", detail: `Recommend ${surplus.recommendedLoads[0]} first, then ${surplus.recommendedLoads.slice(1).join(", ")}.`, status: "done" },
      { name: "Action", detail: options.createReminder ? "Created Google Calendar reminder link for the surplus window." : "Prepared recommendation and waiting for customer action.", status: options.createReminder ? "done" : "ready" },
      { name: "Verification", detail: "Check whether load moves into solar window and grid import drops.", status: "ready" },
      { name: "Outcome", detail: `Estimated value: Rs ${surplus.savings}; expected higher self-consumption.`, status: "ready" },
      { name: "Learning", detail: "Stored EV-first preference for future surplus recommendations.", status: "done" },
    ],
  });

  return agentReply(
    "solar-surplus-automation",
    surplus.shouldActNow
      ? `Solaris found ${surplus.currentSurplusKw.toFixed(1)} kW solar surplus now. Best action is ${surplus.recommendedLoads[0]} between 12 PM and 3 PM.`
      : `Solaris found the best surplus window as ${surplus.bestWindow}. Best action is ${surplus.recommendedLoads[0]}.`,
    details,
    true,
  );
}

async function sendActivityEmail(user, title, details) {
  const subject = `Solaris Activity Completed: ${title}`;
  const text = [
    `Hello ${user.name},`,
    "",
    `Solaris completed this activity for customer ${user.customerId}:`,
    title,
    "",
    details,
    "",
    "This email was sent automatically after your on-demand Agent activity completed.",
  ].join("\n");

  const html = `
    <h2>Solaris Activity Completed</h2>
    <p>Hello ${escapeHtml(user.name)},</p>
    <p>Solaris completed this activity for customer <strong>${escapeHtml(user.customerId)}</strong>:</p>
    <p><strong>${escapeHtml(title)}</strong></p>
    <p>${escapeHtml(details)}</p>
    <p>This email was sent automatically after your on-demand Agent activity completed.</p>
  `;

  const statuses = [];
  try {
    const result = await sendSolarisEmail({ to: user.email, subject, text, html });
    addEvent(result.sent ? `Activity email sent to ${user.email}.` : `Activity email preview generated for ${user.email}; Gmail is not configured.`);
    statuses.push(result.sent ? "Activity email sent to your registered email." : "Activity email preview generated because Gmail is not configured.");
  } catch (error) {
    const message = friendlyEmailError(error);
    addEvent(`Activity email failed for ${user.email}: ${message}`);
    statuses.push(`Activity completed, but email failed: ${message}`);
  }

  if (state.preferences.whatsapp) {
    try {
      const result = await sendWhatsAppAlert(user, text);
      statuses.push(result.sent ? "Activity details sent on WhatsApp." : "Activity WhatsApp preview generated because WhatsApp is not configured.");
    } catch (error) {
      const message = friendlyWhatsAppError(error);
      addEvent(`Activity WhatsApp failed for ${user.phone}: ${message}`);
      statuses.push(`WhatsApp failed: ${message}`);
    }
  }

  return statuses.join(" ");
}

async function sendOtpEmail(user, otp) {
  const subject = "Solaris verification code";
  const text = [
    `Hello ${user.name},`,
    "",
    "Use this OTP to unlock full Solaris Agent access:",
    otp,
    "",
    "This code expires in 10 minutes.",
    "If you did not request this, you can ignore this email.",
  ].join("\n");

  const html = `
    <h2>Solaris verification code</h2>
    <p>Hello ${escapeHtml(user.name)},</p>
    <p>Use this OTP to unlock full Solaris Agent access:</p>
    <p style="font-size:24px;font-weight:700;letter-spacing:4px">${escapeHtml(otp)}</p>
    <p>This code expires in 10 minutes.</p>
    <p>If you did not request this, you can ignore this email.</p>
  `;

  try {
    return await sendSolarisEmail({ to: user.email, subject, text, html });
  } catch (error) {
    const message = friendlyEmailError(error);
    const wrapped = new Error(message);
    wrapped.status = 502;
    throw wrapped;
  }
}

function createOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createShortCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function maskEmail(email) {
  const [name, domain] = String(email).split("@");
  if (!name || !domain) return "registered email";
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(2, name.length - 2))}@${domain}`;
}

function buildEmailReport(user, reportType) {
  const topAppliances = [...state.appliances]
    .sort((a, b) => b.kwh - a.kwh)
    .slice(0, 3)
    .map((item) => `${item.name}: ${item.kwh.toFixed(1)} kWh (${item.source}, ${item.confidence}% confidence)`);

  const subject = `Solaris ${capitalize(reportType)} Solar Report`;
  const lines = [
    `Hello ${user.name},`,
    "",
    `Solaris ${reportType} report for customer ${user.customerId}:`,
    `Solar generated today: ${state.metrics.todayGeneration.toFixed(1)} kWh`,
    `Current solar output: ${state.metrics.solarNow.toFixed(1)} kW`,
    `Current load: ${state.metrics.currentLoad.toFixed(1)} kW`,
    `Grid status: ${state.metrics.gridState}`,
    `Self-consumption: ${state.metrics.selfConsumption}%`,
    `Estimated saving today: Rs ${state.metrics.savingsToday}`,
    `Night usage: ${state.metrics.nightUsage.toFixed(1)} kWh`,
    "",
    "Top appliances:",
    ...topAppliances.map((item) => `- ${item}`),
    "",
    `Cleaner status: ${state.cleaner.state}, mode: ${state.cleaner.mode}`,
    `Open tickets: ${state.tickets.length}`,
    "",
    "Solaris will continue monitoring generation, appliance usage, cleaning, and service follow-up.",
  ];

  const html = `
    <h2>Solaris ${escapeHtml(capitalize(reportType))} Solar Report</h2>
    <p>Hello ${escapeHtml(user.name)},</p>
    <ul>
      <li><strong>Customer ID:</strong> ${escapeHtml(user.customerId)}</li>
      <li><strong>Solar generated today:</strong> ${state.metrics.todayGeneration.toFixed(1)} kWh</li>
      <li><strong>Current solar output:</strong> ${state.metrics.solarNow.toFixed(1)} kW</li>
      <li><strong>Current load:</strong> ${state.metrics.currentLoad.toFixed(1)} kW</li>
      <li><strong>Grid status:</strong> ${escapeHtml(state.metrics.gridState)}</li>
      <li><strong>Self-consumption:</strong> ${state.metrics.selfConsumption}%</li>
      <li><strong>Estimated saving today:</strong> Rs ${state.metrics.savingsToday}</li>
      <li><strong>Night usage:</strong> ${state.metrics.nightUsage.toFixed(1)} kWh</li>
    </ul>
    <h3>Top appliances</h3>
    <ul>${topAppliances.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <p><strong>Cleaner:</strong> ${escapeHtml(state.cleaner.state)} (${escapeHtml(state.cleaner.mode)})</p>
    <p><strong>Open tickets:</strong> ${state.tickets.length}</p>
  `;

  return {
    to: user.email,
    subject,
    text: lines.join("\n"),
    html,
  };
}

function buildWhatsAppAlertText(user, title, details) {
  return [
    `Solaris Alert - ${title}`,
    `Customer: ${user.customerId}`,
    "",
    details,
    "",
    `Solar now: ${state.metrics.solarNow.toFixed(1)} kW`,
    `Load: ${state.metrics.currentLoad.toFixed(1)} kW`,
    `Grid: ${state.metrics.gridState}`,
  ].join("\n");
}

async function sendReportWhatsApp(user, report, reportType) {
  if (!state.preferences.whatsapp) {
    return { sent: false, skipped: true, reason: "WhatsApp alerts are disabled for this customer." };
  }

  try {
    const result = await sendWhatsAppAlert(user, report.text);
    addEvent(result.sent ? `WhatsApp ${reportType} report sent to ${user.phone}.` : `WhatsApp ${reportType} report preview generated for ${user.phone}.`);
    return result;
  } catch (error) {
    const message = friendlyWhatsAppError(error);
    addEvent(`WhatsApp ${reportType} report failed for ${user.phone}: ${message}`);
    return { sent: false, error: message };
  }
}

async function sendReportByChannel(user, reportType, channel) {
  const normalized = String(channel || "").toLowerCase();
  const report = buildEmailReport(user, reportType || "daily");
  const details = [];

  if (normalized === "email" || normalized === "both") {
    if (!state.preferences.email) {
      details.push("Email reports are disabled in notification controls.");
    } else {
      try {
        const result = await sendSolarisEmail(report);
        addEvent(result.sent ? `Agent sent ${reportType} report by email to ${user.email}.` : `Agent generated ${reportType} email report preview for ${user.email}.`);
        details.push(result.sent ? "Email report sent." : "Email report preview generated because Gmail is not configured.");
      } catch (error) {
        const message = friendlyEmailError(error);
        addEvent(`Agent email report failed for ${user.email}: ${message}`);
        details.push(`Email failed: ${message}`);
      }
    }
  }

  if (normalized === "whatsapp" || normalized === "both") {
    const result = await sendReportWhatsApp(user, report, reportType || "daily");
    if (result.sent) details.push("WhatsApp report sent.");
    else if (result.preview) details.push("WhatsApp report preview generated because WhatsApp is not configured.");
    else if (result.skipped) details.push(result.reason);
    else if (result.error) details.push(`WhatsApp failed: ${result.error}`);
  }

  return details;
}

function friendlyEmailError(error) {
  const message = String(error.message || "");
  if (message.includes("Application-specific password required") || message.includes("InvalidSecondFactor")) {
    return "Gmail rejected the login. Use a Google App Password, not your normal Gmail password.";
  }
  if (message.includes("Username and Password not accepted")) {
    return "Gmail username or app password was not accepted.";
  }
  if (message.includes("Invalid login")) {
    return "Gmail login failed. Check GMAIL_USER and GMAIL_APP_PASSWORD.";
  }
  return "Email could not be sent through Gmail SMTP.";
}

function friendlyCalendarError(error) {
  const message = String(error.message || "");
  if (message.includes("invalid_grant") || message.includes("Invalid JWT")) {
    return "Google Calendar rejected the service account credentials. Check GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.";
  }
  if (message.includes("Not Found")) {
    return "Google Calendar could not find the calendar. Check GOOGLE_CALENDAR_ID and share the calendar with the service account email.";
  }
  if (message.includes("insufficient") || message.includes("forbidden") || error.status === 403) {
    return "Google Calendar permission is missing. Share the target calendar with the service account as Make changes to events.";
  }
  return message || "Google Calendar event could not be created.";
}

function friendlyWhatsAppError(error) {
  const message = String(error.message || "");
  if (whatsappProvider() === "callmebot") {
    if (message.includes("apikey") || message.includes("API")) {
      return "CallMeBot rejected the API key. Activate CallMeBot from WhatsApp and set CALLMEBOT_APIKEY again.";
    }
    if (message.includes("not allowed") || message.includes("not authorized")) {
      return "CallMeBot has not been activated for this phone number. Send the activation message to CallMeBot from WhatsApp.";
    }
    return message || "WhatsApp message could not be sent through CallMeBot.";
  }
  if (whatsappProvider() === "twilio") {
    if (message.includes("not a valid phone number") || message.includes("is not a valid")) {
      return "Twilio rejected the WhatsApp recipient number. Use country code format like 919960587532.";
    }
    if (message.includes("not joined") || message.includes("Sandbox") || message.includes("not be reached")) {
      return "Twilio sandbox is not joined from this phone. Send the sandbox join code from WhatsApp first.";
    }
    if (message.includes("Authenticate") || message.includes("authenticate") || message.includes("Authentication")) {
      return "Twilio rejected the Account SID/Auth Token. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.";
    }
    return message || "WhatsApp message could not be sent through Twilio.";
  }
  if (message.includes("Invalid OAuth access token") || message.includes("Error validating access token")) {
    return "Meta rejected the WhatsApp access token. Copy a fresh temporary token or configure a System User token.";
  }
  if (message.includes("Unsupported post request") || message.includes("does not exist")) {
    return "Meta could not find the WhatsApp phone number ID. Check WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_GRAPH_VERSION.";
  }
  if (message.includes("recipient") || message.includes("phone number")) {
    return "Meta rejected the recipient phone number. In test mode, add and verify this customer number as a test recipient.";
  }
  return message || "WhatsApp message could not be sent through Meta Cloud API.";
}

async function sendWhatsAppAlert(user, text) {
  const result = await sendSolarisWhatsApp({ to: user.phone, text });
  addEvent(
    result.sent
      ? `WhatsApp alert accepted by ${result.provider || whatsappProvider()} for ${result.to || user.phone}. Status: ${result.messageStatus || "accepted"}.`
      : `WhatsApp alert preview generated for ${user.phone}; ${whatsappProvider()} is not configured.`,
  );
  return result;
}

async function sendWhatsAppTemplateTest(user, templateName, languageCode) {
  const result = await sendSolarisWhatsAppTemplate({ to: user.phone, templateName, languageCode });
  addEvent(
    result.sent
      ? `WhatsApp test accepted by ${result.provider || whatsappProvider()} for ${result.to || user.phone}. Status: ${result.messageStatus || "accepted"}.`
      : `WhatsApp test preview generated for ${user.phone}; ${whatsappProvider()} is not configured.`,
  );
  return result;
}

function extractWhatsAppStatusEvents(payload) {
  const events = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      for (const status of change?.value?.statuses || []) {
        const messageId = status.id || "unknown-message";
        const recipient = status.recipient_id || "unknown-recipient";
        const state = status.status || "unknown";
        const errors = (status.errors || []).map((item) => item.title || item.message || item.code).filter(Boolean);
        events.push(
          errors.length
            ? `WhatsApp delivery ${state} for ${recipient}. Message ID: ${messageId}. Error: ${errors.join("; ")}.`
            : `WhatsApp delivery ${state} for ${recipient}. Message ID: ${messageId}.`,
        );
      }
    }
  }
  return events;
}

async function handleAgentMessageWithAi(message, user, session) {
  const lowerMessage = String(message || "").toLowerCase();
  refreshAgentInsights(user);
  if (hasReportSendIntent(lowerMessage) || hasCalendarPlanIntent(lowerMessage) || hasSurplusAutomationIntent(lowerMessage) || pendingReportRequests.has(ticketDraftKey(user, session))) {
    return handleAgentMessage(message, user, session);
  }

  if (!openai) {
    return handleAgentMessage(message, user, session);
  }

  try {
    const first = await openai.responses.create({
      model: openaiModel,
      input: [
        {
          role: "system",
          content:
            "You are Solaris, an Agentic AI Solar Assistant. Answer from the provided Solaris data and use tools for actions. Be concise, operational, and clear. If a ticket needs missing fields, ask for type, subject, and description before creating it. If the user asks to send a report, data, summary, or details, ask whether they want Email, WhatsApp, or both before sending. OTP chat access is full chat access only; dashboard access is separate.",
        },
        {
          role: "user",
          content: `Customer: ${user.name} (${user.customerId})\nCurrent Solaris data:\n${JSON.stringify(solarisStateForAi(), null, 2)}\n\nUser message: ${message}`,
        },
      ],
      tools: solarisAiTools(),
    });

    const calls = (first.output || []).filter((item) => item.type === "function_call");
    if (!calls.length) {
      return agentReply("ai-answer", responseText(first) || "I could not generate an answer from the current data.", [], true);
    }

    const toolOutputs = [];
    for (const call of calls) {
      const args = JSON.parse(call.arguments || "{}");
      const result = await runSolarisAiTool(call.name, args, user, session);
      toolOutputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }

    const second = await openai.responses.create({
      model: openaiModel,
      previous_response_id: first.id,
      input: toolOutputs,
    });

    const toolSummary = toolOutputs.map((item) => JSON.parse(item.output));
    return agentReply("ai-tool-answer", responseText(second) || "Done.", summarizeToolResults(toolSummary), true);
  } catch (error) {
    addEvent(`OpenAI Agent fallback used: ${error.message}`);
    return handleAgentMessage(message, user, session);
  }
}

function solarisStateForAi() {
  return {
    metrics: state.metrics,
    appliances: state.appliances,
    cleaner: state.cleaner,
    tickets: state.tickets,
    pendingTicketApproval: state.ticketApproval,
    preferences: state.preferences,
    agentInsights: state.agentInsights,
    agentRuns: state.agentRuns,
    agentMemory: state.agentMemory,
  };
}

function solarisAiTools() {
  return [
    {
      type: "function",
      name: "get_solaris_state",
      description: "Get the latest Solaris dashboard data including generation, consumption, appliances, cleaning, tickets, peer benchmark, bill explanation, weather forecast, warranty, and cleaning ROI insights.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "add_appliance",
      description: "Add a customer appliance to Solaris tracking.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["AC", "Fridge", "Geyser", "Pump", "Washing Machine", "Dishwasher", "EV Charger", "Kitchen", "Other"] },
          source: { type: "string", enum: ["NILM", "Smart plug", "Both"] },
        },
        required: ["name", "type", "source"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "create_ticket",
      description: "Create a maintenance ticket after type, subject, and description are available.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["Underproduction", "Inverter Fault", "Battery Issue", "Communication Failure", "Cleaning", "Billing", "Other"] },
          subject: { type: "string" },
          description: { type: "string" },
        },
        required: ["type", "subject", "description"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "schedule_cleaning",
      description: "Schedule panel cleaning from the user's natural-language request. If active cleaning is locked, the tool reports that suspension is required.",
      parameters: {
        type: "object",
        properties: {
          request_text: { type: "string" },
        },
        required: ["request_text"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "suspend_cleaning",
      description: "Suspend the current cleaning schedule or activity so new cleaning settings can be applied.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "send_email_report",
      description: "Send the latest Solaris report only to the registered customer email address. Do not use this when the user has not chosen a channel.",
      parameters: {
        type: "object",
        properties: {
          reportType: { type: "string" },
        },
        required: ["reportType"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "send_whatsapp_alert",
      description: "Send a short Solaris alert to the customer's registered WhatsApp number when WhatsApp opt-in is enabled.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          message: { type: "string" },
        },
        required: ["title", "message"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "create_calendar_plan",
      description: "Add a future Solaris plan to the customer's Google Calendar, such as cleaning, EV charging, battery charging, or appliance usage.",
      parameters: {
        type: "object",
        properties: {
          planType: { type: "string", enum: ["Cleaning", "EV Charging", "Battery Charging", "Appliance Usage", "Solaris Plan"] },
          title: { type: "string" },
          description: { type: "string" },
          start: { type: "string", description: "ISO date-time or datetime-local value for the event start." },
          durationMinutes: { type: "number" },
        },
        required: ["planType", "title", "description", "start"],
        additionalProperties: false,
      },
    },
  ];
}

async function runSolarisAiTool(name, args, user, session) {
  if (name === "get_solaris_state") {
    return { ok: true, state: solarisStateForAi() };
  }

  if (name === "add_appliance") {
    const appliance = createAppliance(args);
    state.appliances.push(appliance);
    addEvent(`OpenAI Agent added appliance ${appliance.name}.`);
    const emailStatus = await sendActivityEmail(user, `Added appliance: ${appliance.name}`, `${appliance.name} was added with ${appliance.source} tracking.`);
    return { ok: true, appliance, emailStatus };
  }

  if (name === "create_ticket") {
    const duplicate = findOpenTicketByType(args.type);
    if (duplicate) return { ok: false, error: `An open ${args.type} ticket already exists: ${duplicate.id}.` };
    const ticket = createServiceTicket({ ...args, source: "OpenAI Agent" });
    state.tickets.unshift(ticket);
    addEvent(`OpenAI Agent created ${ticket.type} ticket ${ticket.id}.`);
    const emailStatus = await sendActivityEmail(user, `Created maintenance ticket ${ticket.id}`, `${ticket.subject}. Status: ${ticket.status}.`);
    return { ok: true, ticket, emailStatus };
  }

  if (name === "schedule_cleaning") {
    if (isCleanerLocked()) return { ok: false, error: cleanerLockedMessage("schedule cleaning") };
    const nextSchedule = applyCleaningSchedule(args.request_text);
    addEvent(`OpenAI Agent scheduled cleaning for ${formatDateTime(nextSchedule)}.`);
    const calendarResult = await createCalendarPlan(user, {
      planType: "Cleaning",
      title: "Solar panel cleaning",
      description: "Solaris scheduled solar panel cleaning with safety checks for weather, water, and maintenance status.",
      start: nextSchedule,
      durationMinutes: 60,
      source: "OpenAI Agent",
    });
    const emailStatus = await sendActivityEmail(user, "Scheduled solar panel cleaning", `Cleaning is scheduled for ${formatDateTime(nextSchedule)}.`);
    return { ok: true, cleaner: state.cleaner, calendarResult, emailStatus };
  }

  if (name === "suspend_cleaning") {
    state.cleaner.active = false;
    state.cleaner.suspended = true;
    state.cleaner.state = "Suspended";
    state.cleaner.statusMessage = "Current cleaning schedule/activity is suspended. New settings are now allowed.";
    addEvent("OpenAI Agent suspended current cleaning schedule/activity.");
    const emailStatus = await sendActivityEmail(user, "Suspended panel cleaning activity", "The active panel cleaning schedule/activity was suspended.");
    return { ok: true, cleaner: state.cleaner, emailStatus };
  }

  if (name === "send_email_report") {
    if (!state.preferences.email) return { ok: false, error: "Email reports are disabled for this customer." };
    const report = buildEmailReport(user, args.reportType || "daily");
    const result = await sendSolarisEmail(report);
    addEvent(result.sent ? `OpenAI Agent sent email report to ${user.email}.` : `OpenAI Agent generated email preview for ${user.email}.`);
    return { ok: true, result };
  }

  if (name === "send_whatsapp_alert") {
    if (!state.preferences.whatsapp) return { ok: false, error: "WhatsApp alerts are disabled for this customer." };
    const text = buildWhatsAppAlertText(user, args.title || "Solaris alert", args.message);
    const result = await sendWhatsAppAlert(user, text);
    return { ok: true, result };
  }

  if (name === "create_calendar_plan") {
    const calendarResult = await createCalendarPlan(user, { ...args, source: "OpenAI Agent" });
    return calendarResult.ok ? { ok: true, calendarResult } : { ok: false, error: calendarResult.error };
  }

  return { ok: false, error: `Unknown tool ${name}.` };
}

function responseText(response) {
  if (response.output_text) return response.output_text;
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" || content.type === "text")
    .map((content) => content.text)
    .join("\n")
    .trim();
}

function summarizeToolResults(results) {
  return results
    .filter((result) => result && (result.ticket || result.appliance || result.cleaner || result.calendarResult || result.emailStatus || result.result || result.whatsappResult || result.error))
    .map((result) => {
      if (result.error) return result.error;
      if (result.ticket) return `Ticket ${result.ticket.id} (${result.ticket.type}) is ${result.ticket.status}.`;
      if (result.appliance) return `Appliance ${result.appliance.name} added.`;
      if (result.cleaner) return `Cleaner status: ${result.cleaner.state}, mode: ${result.cleaner.mode}.`;
      if (result.calendarResult?.statusText) return result.calendarResult.statusText;
      if (result.emailStatus) return result.emailStatus;
      if (result.whatsappResult?.sent) return "Report details also sent on WhatsApp.";
      if (result.whatsappResult?.preview) return "Report WhatsApp preview generated because WhatsApp is not configured.";
      if (result.whatsappResult?.error) return `WhatsApp report failed: ${result.whatsappResult.error}`;
      if (result.result?.sent) return "WhatsApp alert sent to the registered customer phone.";
      if (result.result?.preview) return "WhatsApp alert preview generated because the WhatsApp provider is not configured.";
      return "";
    })
    .filter(Boolean);
}

async function handleAgentMessage(message, user, session) {
  const text = message.toLowerCase();
  const draftKey = ticketDraftKey(user, session);
  const activeTicketDraft = pendingTicketDrafts.get(draftKey);
  const pendingReport = pendingReportRequests.get(draftKey);

  if (pendingReport) {
    if (includesAny(text, ["cancel", "stop", "never mind", "discard"])) {
      pendingReportRequests.delete(draftKey);
      return agentReply("report-channel-cancelled", "I cancelled the report send request.", [], false);
    }

    const channel = parseReportChannel(text);
    if (!channel) {
      return agentReply(
        "report-channel-needed",
        "How should I send the report?",
        ["Reply: Email, WhatsApp, or Both.", "You can also say Cancel."],
        false,
      );
    }

    pendingReportRequests.delete(draftKey);
    const details = await sendReportByChannel(user, pendingReport.reportType, channel);
    return agentReply(
      "report-sent",
      `Done. I handled the ${pendingReport.reportType} report by ${channel}.`,
      details,
      false,
    );
  }

  if (activeTicketDraft && !includesAny(text, ["cancel ticket", "stop ticket", "discard ticket"])) {
    const draft = parseTicketDraft(message, activeTicketDraft);
    const missing = missingTicketField(draft);
    if (missing) {
      pendingTicketDrafts.set(draftKey, draft);
      return ticketFieldPrompt(missing, draft);
    }

    const duplicate = findOpenTicketByType(draft.type);
    if (duplicate) {
      pendingTicketDrafts.delete(draftKey);
      return agentReply(
        "ticket-duplicate-blocked",
        `I cannot create another ${draft.type} ticket because ${duplicate.id} is still open.`,
        ["Close the existing ticket before opening a similar ticket.", "Ticket type Other can be created multiple times."],
        true,
      );
    }

    const ticket = createServiceTicket({ ...draft, source: "Agent guided" });
    state.tickets.unshift(ticket);
    pendingTicketDrafts.delete(draftKey);
    addEvent(`Agent created guided ${ticket.type} ticket ${ticket.id}.`);
    const emailStatus = await sendActivityEmail(
      user,
      `Created maintenance ticket ${ticket.id}`,
      `${ticket.subject}. Status: ${ticket.status}. Solaris will track status and reminders with the service company.`,
    );
    return agentReply("guided-ticket-created", `Done. I created ticket ${ticket.id}.`, [`Type: ${ticket.type}.`, `Subject: ${ticket.subject}.`, emailStatus], true);
  }

  if (activeTicketDraft && includesAny(text, ["cancel ticket", "stop ticket", "discard ticket"])) {
    pendingTicketDrafts.delete(draftKey);
    return agentReply("ticket-draft-cancelled", "I cancelled the ticket draft. No ticket was created.", [], false);
  }

  if (hasCalendarPlanIntent(text)) {
    const calendarResult = await createCalendarPlan(user, { ...parseCalendarPlan(message), source: "Agent" });
    if (!calendarResult.ok) {
      return agentReply("calendar-plan-failed", calendarResult.error, ["Enable Google Calendar plans in Notification Controls and check Google Calendar configuration."], false);
    }

    return agentReply(
      "calendar-plan",
      calendarResult.result.sent
        ? `Done. I added ${calendarResult.plan.title} to Google Calendar.`
        : `Done. I prepared a Google Calendar reminder link for ${calendarResult.plan.title}.`,
      [
        `Plan type: ${calendarResult.plan.planType}.`,
        `Start: ${formatDateTime(calendarResult.plan.start)}.`,
        calendarResult.statusText,
        calendarResult.result.htmlLink ? `Calendar reminder link: ${calendarResult.result.htmlLink}` : "",
      ].filter(Boolean),
      false,
    );
  }

  if (includesAny(text, ["add appliance", "add new appliance"])) {
    const input = parseApplianceCommand(message);
    const appliance = createAppliance(input);
    state.appliances.push(appliance);
    addEvent(`Agent added appliance ${appliance.name} using ${appliance.source} tracking.`);
    const emailStatus = await sendActivityEmail(
      user,
      `Added appliance: ${appliance.name}`,
      `${appliance.name} was added as ${appliance.type} with ${appliance.source} tracking and ${appliance.confidence}% starting confidence.`,
    );
    return agentReply(
      "add-appliance",
      `Done. I added ${appliance.name} with ${appliance.source} tracking.`,
      [
        `Type: ${appliance.type}.`,
        `Starting confidence: ${appliance.confidence}%.`,
        emailStatus,
      ],
      true,
    );
  }

  if (hasSuspendCleaningIntent(text) && hasScheduleCleaningIntent(text)) {
    const previousSchedule = state.cleaner.nextSchedule;
    state.cleaner.active = false;
    state.cleaner.suspended = true;
    state.cleaner.state = "Suspended";
    state.cleaner.statusMessage = "Current cleaning schedule/activity is suspended. Applying requested schedule.";
    addEvent("Agent suspended current cleaning schedule/activity.");

    const nextSchedule = applyCleaningSchedule(message);
    addEvent(`Agent scheduled cleaning for ${formatDateTime(nextSchedule)} after suspension.`);
    const calendarResult = await createCalendarPlan(user, {
      planType: "Cleaning",
      title: "Solar panel cleaning",
      description: "Solaris scheduled solar panel cleaning after suspending the previous activity.",
      start: nextSchedule,
      durationMinutes: 60,
      source: "Agent",
    });
    const emailStatus = await sendActivityEmail(
      user,
      "Suspended and rescheduled panel cleaning",
      `Previous schedule was ${formatDateTime(previousSchedule)}. New cleaning is scheduled for ${formatDateTime(nextSchedule)} in ${state.cleaner.mode} mode. Solaris will skip unsafe weather, low water, or maintenance conditions.`,
    );
    return agentReply(
      "suspend-and-schedule-cleaning",
      `Done. I suspended the current cleaning activity and scheduled panel cleaning for ${formatDateTime(nextSchedule)}.`,
      [
        `Previous schedule: ${formatDateTime(previousSchedule)}.`,
        `Mode: ${state.cleaner.mode}.`,
        "Panel Cleaning UI has been updated with the new active schedule.",
        calendarResult.statusText || calendarResult.error,
        emailStatus,
      ],
      true,
    );
  }

  if (hasScheduleCleaningIntent(text)) {
    if (isCleanerLocked()) {
      return agentReply(
        "cleaning-active-blocked",
        cleanerLockedMessage("activate the requested cleaning command"),
        [
          "Say: Suspend cleaning activity",
          "Or use the Suspend Current Activity button in Panel Cleaning.",
          "After suspension, send your schedule command again.",
        ],
        false,
      );
    }
    const nextSchedule = applyCleaningSchedule(message);
    addEvent(`Agent scheduled cleaning for ${formatDateTime(nextSchedule)}.`);
    const calendarResult = await createCalendarPlan(user, {
      planType: "Cleaning",
      title: "Solar panel cleaning",
      description: "Solaris scheduled solar panel cleaning with safety checks for weather, water, and maintenance status.",
      start: nextSchedule,
      durationMinutes: 60,
      source: "Agent",
    });
    const emailStatus = await sendActivityEmail(
      user,
      "Scheduled solar panel cleaning",
      `Cleaning is scheduled for ${formatDateTime(nextSchedule)} in ${state.cleaner.mode} mode. Solaris will skip unsafe weather, low water, or maintenance conditions.`,
    );
    return agentReply(
      "schedule-cleaning",
      `Done. I scheduled panel cleaning for ${formatDateTime(nextSchedule)}.`,
      [
        `Mode: ${state.cleaner.mode}.`,
        "Safety checks remain active before cleaner start.",
        calendarResult.statusText || calendarResult.error,
        emailStatus,
      ],
      true,
    );
  }

  if (hasSuspendCleaningIntent(text)) {
    state.cleaner.active = false;
    state.cleaner.suspended = true;
    state.cleaner.state = "Suspended";
    state.cleaner.statusMessage = "Current cleaning schedule/activity is suspended. New settings are now allowed.";
    addEvent("Agent suspended current cleaning schedule/activity.");
    const emailStatus = await sendActivityEmail(
      user,
      "Suspended panel cleaning activity",
      "The active panel cleaning schedule/activity was suspended. New cleaning settings are now allowed.",
    );
    return agentReply(
      "suspend-cleaning",
      "Done. I suspended the current cleaning schedule/activity. You can now activate the requested cleaning command.",
      [
        `Previous schedule shown in UI: ${formatDateTime(state.cleaner.nextSchedule)}.`,
        emailStatus,
      ],
      true,
    );
  }

  if (includesAny(text, ["raise ticket", "create ticket", "open ticket", "maintenance ticket", "service ticket"])) {
    const draft = parseTicketDraft(message);
    const missing = missingTicketField(draft);
    if (missing) {
      pendingTicketDrafts.set(draftKey, draft);
      return ticketFieldPrompt(missing, draft);
    }

    const duplicate = findOpenTicketByType(draft.type);
    if (duplicate) {
      return agentReply(
        "ticket-duplicate-blocked",
        `I cannot create another ${draft.type} ticket because ${duplicate.id} is still open.`,
        ["Close the existing ticket before opening a similar ticket.", "Ticket type Other can be created multiple times."],
        true,
      );
    }

    const ticket = createServiceTicket({ ...draft, source: "Agent guided" });
    state.tickets.unshift(ticket);
    addEvent(`Agent created guided ${ticket.type} ticket ${ticket.id}.`);
    const emailStatus = await sendActivityEmail(
      user,
      `Created maintenance ticket ${ticket.id}`,
      `${ticket.subject}. Status: ${ticket.status}. Solaris will track this ticket and remind the company when SLA follow-up is due.`,
    );
    return agentReply(
      "guided-ticket-created",
      `Done. I created ticket ${ticket.id}.`,
      [
        `Type: ${ticket.type}.`,
        `Subject: ${ticket.subject}.`,
        "Solaris will track status and reminders.",
        emailStatus,
      ],
      true,
    );
  }

  if (hasReportSendIntent(text)) {
    const channel = parseReportChannel(text);
    const reportType = parseReportType(text);
    if (channel) {
      const details = await sendReportByChannel(user, reportType, channel);
      return agentReply("report-sent", `Done. I handled the ${reportType} report by ${channel}.`, details, false);
    }

    pendingReportRequests.set(draftKey, { reportType, requestedAt: new Date().toISOString() });
    return agentReply(
      "report-channel-needed",
      "How should I send the report or details?",
      [
        "Reply: Email, WhatsApp, or Both.",
        `Report type: ${reportType}.`,
        "You can also say Cancel.",
      ],
      false,
    );
  }

  refreshAgentInsights(user);

  if (includesAny(text, ["bill explainer", "explain my bill", "solar bill", "why bill", "bill explanation"])) {
    return insightAgentReply("bill-explainer", state.agentInsights.bill, true);
  }

  if (includesAny(text, ["bill generation", "generate bill", "electricity bill overview", "bill overview", "appliance bill", "which appliances should i limit", "which appliances i should limit", "limit appliance", "reduce electricity bill"])) {
    const overview = buildBillUsageControlOverview();
    const top = overview.appliances[0];
    return agentReply(
      "bill-usage-control",
      `${overview.month} projected payable bill is about Rs ${overview.projectedPayable}. ${top ? `${top.name} is the biggest tracked bill driver today.` : "Add appliances to see device-level bill drivers."}`,
      [
        `Projected grid import: ${overview.projectedGridImportKwh.toFixed(0)} kWh, about Rs ${overview.importCost}.`,
        `Solar export credit estimate: Rs ${overview.exportCredit}; fixed charges: Rs ${overview.fixedCharges}.`,
        ...overview.appliances.map((item) => `${item.name}: ${item.kwh.toFixed(1)} kWh today, Rs ${item.cost}/day, ${item.share}% of tracked cost. ${item.action}`),
        "Main rule: do not stop essential appliances; limit long runtime and shift flexible loads to 12 PM - 3 PM solar surplus.",
      ],
      true,
    );
  }

  if (includesAny(text, ["peer benchmark", "benchmark my solar", "compare my solar", "compare with similar homes", "compare solar", "community benchmark", "solar ranking", "solar peer"])) {
    return buildPeerBenchmarkReply();
  }

  if (includesAny(text, ["solar forecast", "weather forecast", "tomorrow solar", "forecast generation", "weather-aware"])) {
    return insightAgentReply("weather-forecast", state.agentInsights.weather, false);
  }

  if (includesAny(text, ["underperformance diagnosis", "diagnose underperformance", "low production reason", "why production low", "production diagnosis"])) {
    return insightAgentReply("underperformance-diagnosis", state.agentInsights.diagnosis, true);
  }

  if (includesAny(text, ["warranty", "amc", "service contract", "coverage"])) {
    return insightAgentReply("warranty-amc", state.agentInsights.warranty, false);
  }

  if (includesAny(text, ["cleaning roi", "cleaning worth", "cleaning value", "roi cleaning", "worth cleaning"])) {
    return insightAgentReply("cleaning-roi", state.agentInsights.cleaningRoi, true);
  }

  if (hasSurplusAutomationIntent(text)) {
    const createReminder = includesAny(text, ["remind", "reminder", "calendar", "schedule", "plan"]);
    return buildSurplusAutomationReply(user, { createReminder });
  }

  if (includesAny(text, ["generate", "generation", "solar today", "produced", "production"])) {
    return agentReply(
      "solar-status",
      `Today your system generated ${state.metrics.todayGeneration.toFixed(1)} kWh. Current solar output is ${state.metrics.solarNow.toFixed(1)} kW and the site is ${state.metrics.gridState.toLowerCase()} power.`,
      [
        `Self-consumption is ${state.metrics.selfConsumption}%.`,
        `${state.metrics.exported.toFixed(1)} kWh has been exported today.`,
        `Estimated saving today is Rs ${state.metrics.savingsToday}.`,
      ],
      true,
    );
  }

  if (includesAny(text, ["appliance", "used most", "highest", "consumption", "power use"])) {
    const top = [...state.appliances].sort((a, b) => b.kwh - a.kwh).slice(0, 3);
    return agentReply(
      "appliance-usage",
      `${top[0].name} is the highest consumer today at ${top[0].kwh.toFixed(1)} kWh.`,
      top.map((item) => `${item.name}: ${item.kwh.toFixed(1)} kWh, Rs ${item.cost}, source ${item.source}, confidence ${item.confidence}%.`),
      true,
    );
  }

  if (includesAny(text, ["when should", "best time", "run washing", "run appliance", "optimize", "suggest"])) {
    const surplus = analyzeSolarSurplus();
    return agentReply(
      "usage-suggestion",
      `Best usage window is ${surplus.bestWindow} because Solaris expects usable solar surplus during that period.`,
      [
        `Run ${surplus.recommendedLoads.join(", ")} in that window.`,
        "Prioritize EV charging between 12 PM and 3 PM; do not run geyser unless hot water is needed.",
        `Current surplus is ${surplus.currentSurplusKw.toFixed(1)} kW; estimated value is Rs ${surplus.savings}.`,
        "Avoid shifting essential loads; focus on flexible appliances.",
        "This should reduce grid import and improve self-consumption.",
      ],
      true,
    );
  }

  if (includesAny(text, ["night", "bill high", "grid import", "bill"])) {
    return agentReply(
      "night-usage",
      `Night usage is ${state.metrics.nightUsage.toFixed(1)} kWh. AC and geyser are the likely reasons your bill can increase even with good solar production.`,
      [
        "Shift water heating to solar hours if possible.",
        "Use AC pre-cooling before evening peak where comfort allows.",
        "Check if any appliance is running longer than usual at night.",
      ],
      true,
    );
  }

  if (includesAny(text, ["clean", "cleaning", "dust", "panel cleaner"])) {
    const nextText = state.cleaner.nextSchedule ? formatDateTime(state.cleaner.nextSchedule) : "AI managed";
    return agentReply(
      "cleaning",
      `Cleaner is currently ${state.cleaner.state.toLowerCase()} in ${state.cleaner.mode} mode. Next schedule is ${nextText}.`,
      [
        `Dust risk is ${state.cleaner.dustRisk}.`,
        `Recent production impact is ${state.cleaner.productionImpact}.`,
        "Solaris will skip cleaning during unsafe weather, rain, low water, or maintenance mode.",
      ],
      true,
    );
  }

  if (includesAny(text, ["ticket", "service", "company", "complaint", "fault", "issue"])) {
    const open = state.tickets[0];
    return agentReply(
      "service-ticket",
      open ? `Latest ticket ${open.id} is ${open.status.toLowerCase()}.` : "There are no open service tickets.",
      open
        ? [open.title, open.body, "Solaris will remind the company if the SLA is missed."]
        : ["If production becomes critically low, Solaris can create a ticket after your confirmation."],
      true,
    );
  }

  if (includesAny(text, ["send whatsapp", "whatsapp test", "test whatsapp", "whatsapp alert"])) {
    if (!state.preferences.whatsapp) {
      return agentReply("whatsapp-disabled", "WhatsApp alerts are disabled for this customer.", ["Enable WhatsApp alerts in Notification Controls first."]);
    }

    const details = await sendReportByChannel(user, "daily", "whatsapp");
    return agentReply("whatsapp-report", "Done. I handled the daily report by WhatsApp.", details, false);
  }

  if (includesAny(text, ["whatsapp", "email", "notification", "alert"])) {
    return agentReply(
      "notifications",
      `WhatsApp alerts are ${state.preferences.whatsapp ? "enabled" : "disabled"} and ${capitalize(whatsappProvider())} is ${isWhatsAppConfigured() ? "configured" : "not configured"}. Email reports are ${state.preferences.email ? "enabled" : "disabled"}. Google Calendar plans are ${state.preferences.calendar ? "enabled" : "disabled"} and ${isGoogleCalendarConfigured() ? "configured" : "not configured"}.`,
      [
        "Say: Send WhatsApp report",
        "Say: Add EV charging to calendar tomorrow at 12 PM",
        `Auto-ticket creation is ${state.preferences.autoTicket ? "enabled" : "disabled"}.`,
        `Quiet hours are ${state.preferences.quietHours ? "enabled" : "disabled"}.`,
      ],
    );
  }

  return agentReply(
    "general-help",
    "I can help with solar generation, appliance consumption, best usage time, night usage, cleaning, service tickets, and WhatsApp or email alerts.",
    [
      "Try: How much did I generate today?",
      "Try: Which appliance used the most power?",
      "Try: Should I clean my panels?",
      "Try: What is my ticket status?",
    ],
  );
}

function agentReply(intent, answer, details = [], canEmail = false) {
  return {
    intent,
    answer,
    details,
    canEmail,
    at: new Date().toISOString(),
  };
}

function insightAgentReply(intent, insight, canEmail = false) {
  return agentReply(
    intent,
    insight.summary,
    [
      `Status: ${insight.status}.`,
      ...(insight.evidence || []),
      `Action: ${insight.action}`,
    ],
    canEmail,
  );
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cryptoRandomToken() {
  return require("node:crypto").randomBytes(32).toString("hex");
}

function getCurrentState() {
  return stateContext.getStore() || demoState;
}

function getStateForUser(user) {
  if (!user) return demoState;
  if (!userStates.has(user.id)) {
    userStates.set(user.id, createInitialState({ seedDemoTicket: user.id === demoUser.id }));
  }
  return userStates.get(user.id);
}

function getSessionUser(req) {
  const session = getSession(req);
  if (!session) return null;
  const user = users.get(session.userId) || null;
  if (user) stateContext.enterWith(getStateForUser(user));
  return user;
}

function getSession(req) {
  const token = getCookie(req, "solaris_session");
  if (!token || !sessions.has(token)) return null;
  return sessions.get(token);
}

function canAccessApi(req, pathname) {
  const user = getSessionUser(req);
  const session = getSession(req);
  if (!user || !session) return false;

  const chatAllowed = ["/api/agent/chat", "/api/email/report", "/api/whatsapp/test", "/api/whatsapp/report", "/api/calendar/plan"];
  if (chatAllowed.includes(pathname)) {
    return session.level === "chat" || session.level === "dashboard";
  }

  return session.level === "dashboard";
}

function findUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return [...users.values()].find((user) => user.email.toLowerCase() === normalized);
}

function findUserByCustomerId(customerId) {
  const normalized = String(customerId || "").trim().toLowerCase();
  return [...users.values()].find((user) => user.customerId.toLowerCase() === normalized);
}

function findUserByPhone(phone) {
  const normalized = normalizeWhatsAppNumber(phone);
  if (!normalized) return null;
  return [...users.values()].find((user) => normalizeWhatsAppNumber(user.phone) === normalized);
}

function findUserByIdentifier(identifier) {
  const normalized = String(identifier || "").trim().toLowerCase();
  if (!normalized) return null;

  return [...users.values()].find((user) => {
    const phone = user.phone.replace(/\s+/g, "").toLowerCase();
    const inputPhone = normalized.replace(/\s+/g, "");
    return (
      user.customerId.toLowerCase() === normalized ||
      user.email.toLowerCase() === normalized ||
      phone === inputPhone
    );
  });
}

function createUser(body) {
  const customerId = String(body.customerId || "").trim();
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const address = String(body.address || "").trim();
  const password = String(body.password || "").trim();

  if (!customerId || !name || !phone || !email || !address || !password) {
    const error = new Error("Customer ID, name, phone, email, address, and password are required.");
    error.status = 400;
    throw error;
  }

  if (findUserByEmail(email)) {
    const error = new Error("Email is already registered.");
    error.status = 409;
    throw error;
  }

  if (findUserByCustomerId(customerId)) {
    const error = new Error("Customer ID is already registered.");
    error.status = 409;
    throw error;
  }

  return {
    id: `user-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    customerId,
    name,
    phone,
    email,
    address,
    password,
  };
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    customerId: user.customerId,
    name: user.name,
    phone: user.phone,
    email: user.email,
    address: user.address,
  };
}

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const cookies = Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
  return cookies[name];
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/"];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (typeof options.maxAge === "number") parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}
