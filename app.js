const apiBase = window.location.origin;

const solaris = {
  chartMode: "day",
  readings: {},
  appliances: [],
  tickets: [],
  suggestions: [],
  cleaner: {},
  ticketApproval: null,
  agentInsights: {},
  agentRuns: [],
  agentMemory: [],
  agentApprovals: [],
  agentDemo: null,
  agentDemoVisible: false,
  agentInsightsRevealed: false,
  agentInsightsAnimating: false,
  missionControlRevealed: false,
  missionControlAnimating: false,
  selectedApprovalId: "",
  currentUser: null,
  generatedBill: null,
  selectedPaymentMethod: "",
  billPaid: false,
  preferences: {},
  events: [],
  authenticated: false,
  chatAuthenticated: false,
  pendingOtpIdentifier: "",
  chatSessionActive: false,
  refreshTimer: null,
  cleanerFormDirty: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

async function init() {
  bindNavigation();
  bindAiAgentViews();
  bindChartTabs();
  bindFloatingChat();
  bindControls();
  bindAuth();
  await checkAuth();
  startDashboardRefresh();
}

function startDashboardRefresh() {
  if (solaris.refreshTimer) return;
  solaris.refreshTimer = setInterval(async () => {
    if (!solaris.authenticated || document.hidden) return;
    await loadState({ silent: true });
  }, 5000);
}

function bindNavigation() {
  $$(".nav button").forEach((button) => {
    button.addEventListener("click", () => {
      const targetSection = $(`#${button.dataset.section}`);
      if (!targetSection) return;
      $$(".nav button").forEach((item) => item.classList.remove("active"));
      $$(".section").forEach((section) => section.classList.remove("active"));
      button.classList.add("active");
      targetSection.classList.add("active");
      renderChart();
      if (button.dataset.section === "ai-agents") startAgentInsightsReveal();
    });
  });
}

function bindAiAgentViews() {
  $$("[data-ai-agent-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.aiAgentView;
      $$("[data-ai-agent-view]").forEach((item) => item.classList.toggle("active", item === button));
      $$("[data-ai-agent-panel]").forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.aiAgentPanel === view);
      });
      if (view === "mission") startMissionControlReveal();
    });
  });
}

function bindChartTabs() {
  $$(".segmented button").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".segmented button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      solaris.chartMode = button.dataset.chart;
      if (solaris.chartMode === "year" && !solaris.readings.year) solaris.readings.year = buildYearReadings();
      renderChart();
    });
  });
}

function bindFloatingChat() {
  $("#chat-launcher").addEventListener("click", () => openFloatingChat());
  $("#chat-close").addEventListener("click", closeFloatingChat);
}

function bindControls() {
  $("#refresh-suggestions").addEventListener("click", async () => {
    const data = await apiPost("/api/suggestions/refresh");
    solaris.suggestions = data.suggestions;
    solaris.events = data.events;
    renderSuggestions();
    renderEvents();
  });

  $("#start-cleaning").addEventListener("click", () => sendCleanerCommand("start"));
  $("#pause-cleaning").addEventListener("click", () => sendCleanerCommand("pause"));
  $("#stop-cleaning").addEventListener("click", () => sendCleanerCommand("stop"));
  $("#suspend-cleaning").addEventListener("click", suspendCleaning);
  $("#cleaner-mode").addEventListener("change", () => {
    solaris.cleanerFormDirty = true;
    const hideSchedule = updateCleanerScheduleVisibility();
    if (hideSchedule) $("#cleaner-schedule").value = "";
  });
  $("#cleaner-schedule").addEventListener("input", () => {
    solaris.cleanerFormDirty = true;
  });
  $("#cleaner-schedule").addEventListener("focus", () => {
    solaris.cleanerFormDirty = true;
  });

  $("#save-schedule").addEventListener("click", async () => {
    const mode = $("#cleaner-mode").value;
    const nextSchedule = mode === "Scheduled" ? $("#cleaner-schedule").value : "";
    if (mode === "Scheduled" && !nextSchedule) {
      $("#cleaning-note").textContent = "Scheduled mode requires a date and time before saving.";
      $("#cleaner-schedule").focus();
      return;
    }
    try {
      const data = await apiPost("/api/cleaner/schedule", { mode, nextSchedule });
      solaris.cleaner = data.cleaner;
      solaris.events = data.events;
      solaris.cleanerFormDirty = false;
      renderCleaner();
      if (data.calendarResult?.statusText) renderCalendarStatus("#cleaning-note", data.calendarResult);
      if (data.calendarResult?.error) $("#cleaning-note").textContent = data.calendarResult.error;
      renderEvents();
    } catch (error) {
      $("#cleaning-note").textContent = error.message;
    }
  });

  $("#ticket-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#ticket-status-note").textContent = "Creating ticket...";
    try {
      const data = await apiPost("/api/tickets", {
        type: $("#ticket-type").value,
        subject: $("#ticket-subject").value,
        description: $("#ticket-description").value,
      });
      solaris.tickets = data.tickets;
      solaris.events = data.events;
      $("#ticket-subject").value = "";
      $("#ticket-description").value = "";
      $("#ticket-status-note").textContent = `Ticket ${data.ticket.id} created.`;
      renderTickets();
      renderEvents();
    } catch (error) {
      $("#ticket-status-note").textContent = error.message;
    }
  });

  ["whatsapp-opt", "email-opt", "calendar-opt", "auto-ticket-opt", "quiet-opt"].forEach((id) => {
    $(`#${id}`).addEventListener("change", savePreferences);
  });

  $("#send-email-report").addEventListener("click", sendEmailReport);
  $("#send-whatsapp-report").addEventListener("click", sendWhatsAppReport);
  $("#run-judge-demo")?.addEventListener("click", runJudgeDemo);
  $("#agent-memory-link")?.addEventListener("click", openAgentMemoryModal);
  $("#timeline-modal-close")?.addEventListener("click", closeTimelineModal);
  $("#timeline-modal-backdrop")?.addEventListener("click", closeTimelineModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTimelineModal();
  });

  $("#chat-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#chat-input");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    addChatMessage("user", message);
    await sendAgentMessage(message);
  });

  $("#chat-help").addEventListener("click", () => {
    $("#chat-command-menu").classList.toggle("open");
  });

  $$("[data-agent-command]").forEach((button) => {
    button.addEventListener("click", async () => {
      const message = button.dataset.agentCommand;
      $("#chat-command-menu").classList.remove("open");
      openFloatingChat();
      addChatMessage("user", message);
      await sendAgentMessage(message);
    });
  });

  $$(".quick-prompts button").forEach((button) => {
    button.addEventListener("click", async () => {
      const message = button.dataset.prompt;
      openFloatingChat();
      addChatMessage("user", message);
      await sendAgentMessage(message);
    });
  });

  $("#appliance-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("#appliance-name").value.trim();
    if (!name) return;

    const data = await apiPost("/api/appliances", {
      name,
      type: $("#appliance-type").value,
      source: $("#appliance-source").value,
    });

    solaris.appliances = data.appliances;
    solaris.events = data.events;
    $("#appliance-name").value = "";
    renderBillUsageOverview();
    renderAppliances();
    renderEvents();
  });

  $("#generate-bill-overview")?.addEventListener("click", generateBill);
  $$("[data-payment-method]").forEach((button) => {
    button.addEventListener("click", () => selectPaymentMethod(button.dataset.paymentMethod));
  });
  $("#pay-bill")?.addEventListener("click", payGeneratedBill);
}

function bindAuth() {
  $("#show-signup").addEventListener("click", () => showAuthPanel("signup"));
  $("#show-login").addEventListener("click", () => showAuthPanel("login"));
  $("#switch-to-signup").addEventListener("click", () => showAuthPanel("signup"));
  $("#switch-to-login").addEventListener("click", () => showAuthPanel("login"));

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#login-error").textContent = "";
    try {
      const data = await apiPost("/api/auth/login", {
        email: $("#login-email").value,
        password: $("#login-password").value,
      });
      showApp(data.user);
      await loadState();
    } catch {
      $("#login-error").textContent = "Invalid email or password.";
    }
  });

  $("#signup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#signup-error").textContent = "";
    try {
      const data = await apiPost("/api/auth/signup", {
        customerId: $("#signup-customer-id").value,
        name: $("#signup-name").value,
        phone: $("#signup-phone").value,
        email: $("#signup-email").value,
        address: $("#signup-address").value,
        password: $("#signup-password").value,
      });
      showApp(data.user);
      await loadState();
    } catch (error) {
      $("#signup-error").textContent = "Unable to create account. Check details or use a different email/customer ID.";
    }
  });

  $("#logout-button").addEventListener("click", async () => {
    await apiPost("/api/auth/logout");
    solaris.events = [];
    solaris.authenticated = false;
    solaris.chatAuthenticated = false;
    solaris.pendingOtpIdentifier = "";
    document.body.classList.add("locked");
    showAuthPanel("login");
    addChatMessage("agent", "You are signed out. Send your customer ID, email, or phone number to unlock full Solaris access.");
  });
}

function showAuthPanel(mode) {
  $("#login-form").classList.toggle("active", mode === "login");
  $("#signup-form").classList.toggle("active", mode === "signup");
  $("#login-error").textContent = "";
  $("#signup-error").textContent = "";
}

async function checkAuth() {
  const data = await apiGet("/api/auth/status");
  if (!data.authenticated) {
    solaris.authenticated = false;
    solaris.chatAuthenticated = Boolean(data.chatAuthenticated);
    solaris.pendingOtpIdentifier = "";
    document.body.classList.add("locked");
    renderWelcomeMessage();
    return;
  }
  showApp(data.user);
  await loadState();
}

function showApp(user) {
  solaris.authenticated = true;
  solaris.chatAuthenticated = true;
  solaris.currentUser = user || solaris.currentUser;
  document.body.classList.remove("locked");
  $("#user-chip").textContent = `Welcome ${user?.name || "Solaris User"}`;
}

async function loadState(options = {}) {
  try {
    const data = await apiGet("/api/state");
    Object.assign(solaris, data);
    prepareReadings();
    renderAll();
  } catch (error) {
    if (String(error.message).includes("401")) {
      document.body.classList.add("locked");
      return;
    }
    if (!options.silent) {
      $("#suggestions").innerHTML = `<article class="suggestion"><strong>Backend unavailable</strong><p>Start Solaris with npm start, then refresh this page.</p></article>`;
    }
  }
}

function prepareReadings() {
  solaris.readings ||= {};
  if (!solaris.readings.year) {
    solaris.readings.year = buildYearReadings();
  }
}

function renderAll() {
  renderMetrics();
  renderChart();
  renderSuggestions();
  renderAgentInsights();
  renderAgentMissionControl();
  renderBillUsageOverview();
  renderGeneratedBill();
  renderAppliances();
  renderCleaner();
  renderTickets();
  renderPreferences();
  renderEvents();
  renderWelcomeMessage();
}

function renderMetrics() {
  const metrics = solaris.metrics;
  $("#health-score").textContent = `${metrics.healthScore}%`;
  $("#current-load").textContent = metrics.currentLoad.toFixed(1);
  $("#solar-now").textContent = metrics.solarNow.toFixed(1);
  $("#grid-state").textContent = `Grid: ${metrics.gridState}`;
  $("#today-generation").textContent = `${metrics.todayGeneration.toFixed(1)} kWh`;
  $("#self-consumption").textContent = `${metrics.selfConsumption}%`;
  $("#savings").textContent = `₹${metrics.savingsToday}`;
  $("#night-usage").textContent = `${metrics.nightUsage.toFixed(1)} kWh`;
}

function renderChart() {
  const canvas = $("#energy-chart");
  if (!canvas) return;
  const data = solaris.readings[solaris.chartMode] || (solaris.chartMode === "year" ? buildYearReadings() : null);
  if (!data) {
    $("#chart-insight").textContent = `${periodLabel(solaris.chartMode)} data is not available yet.`;
    return;
  }
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = { top: 48, right: 28, bottom: 46, left: 58 };
  const max = Math.max(...data.solar, ...data.load) * 1.15;
  const stats = chartStats(data);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcf8";
  ctx.fillRect(0, 0, width, height);
  renderChartSummary(stats);
  drawGrid(ctx, width, height, padding, max);
  drawLine(ctx, data.solar, max, width, height, padding, "#16834f");
  drawLine(ctx, data.load, max, width, height, padding, "#2364aa");
  drawLabels(ctx, data.labels, width, height, padding, solaris.chartMode);
  drawLegend(ctx, solaris.chartMode);
  $("#chart-insight").textContent = chartInsight(stats, solaris.chartMode);
}

function drawGrid(ctx, width, height, padding, max) {
  ctx.strokeStyle = "#e4eadf";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#667064";
  ctx.font = "12px system-ui";
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + ((height - padding.top - padding.bottom) / 4) * i;
    const value = max - (max / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(`${value.toFixed(0)} ${unitForMode(solaris.chartMode)}`, 8, y + 4);
  }

  ctx.fillStyle = "#667064";
  ctx.fillText(`Period: ${periodLabel(solaris.chartMode)} · Unit: ${unitForMode(solaris.chartMode)}`, padding.left, 28);
}

function drawLine(ctx, values, max, width, height, padding, color) {
  const step = (width - padding.left - padding.right) / (values.length - 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = padding.left + step * index;
    const y = height - padding.bottom - (value / max) * (height - padding.top - padding.bottom);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  values.forEach((value, index) => {
    const x = padding.left + step * index;
    const y = height - padding.bottom - (value / max) * (height - padding.top - padding.bottom);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawLabels(ctx, labels, width, height, padding, mode) {
  const step = (width - padding.left - padding.right) / (labels.length - 1);
  ctx.fillStyle = "#667064";
  ctx.font = "13px system-ui";
  labels.forEach((label, index) => {
    ctx.fillText(label, padding.left + step * index - 8, height - 18);
  });
  const axisLabel = mode === "day" ? "Hour of day" : mode === "week" ? "Day of week" : mode === "month" ? "Week of month" : "Month of year";
  ctx.fillText(axisLabel, width / 2 - 42, height - 4);
}

function drawLegend(ctx, mode) {
  ctx.font = "14px system-ui";
  ctx.fillStyle = "#16834f";
  ctx.fillRect(520, 18, 12, 12);
  ctx.fillText("Solar", 540, 29);
  ctx.fillStyle = "#2364aa";
  ctx.fillRect(590, 18, 12, 12);
  ctx.fillText("Consumption", 610, 29);
}

function chartStats(data) {
  const energyTotals = energyTotalsForMode(solaris.chartMode, data);
  const solarTotal = energyTotals.solarTotal;
  const loadTotal = energyTotals.loadTotal;
  const balance = solarTotal - loadTotal;
  const peakSolar = Math.max(...data.solar);
  const peakLoad = Math.max(...data.load);
  const peakSolarLabel = data.labels[data.solar.indexOf(peakSolar)];
  const peakLoadLabel = data.labels[data.load.indexOf(peakLoad)];
  return { solarTotal, loadTotal, balance, peakSolar, peakLoad, peakSolarLabel, peakLoadLabel };
}

function energyTotalsForMode(mode, data) {
  if (mode === "day") {
    const solarTotal = solaris.metrics.todayGeneration;
    const selfConsumed = solarTotal * ((solaris.metrics.selfConsumption || 0) / 100);
    const gridImportEstimate = Math.max(0, solaris.metrics.nightUsage || 0);
    const loadTotal = Number((selfConsumed + gridImportEstimate).toFixed(1));
    return { solarTotal, loadTotal };
  }

  return {
    solarTotal: data.solar.reduce((sum, value) => sum + value, 0),
    loadTotal: data.load.reduce((sum, value) => sum + value, 0),
  };
}

function renderChartSummary(stats) {
  const unit = summaryUnitForMode(solaris.chartMode);
  const period = periodLabel(solaris.chartMode);
  const generationLabel = solaris.chartMode === "day" ? "Today Generation" : `${period} Chart Generation`;
  const consumptionLabel = solaris.chartMode === "day" ? "Today Consumption" : `${period} Chart Consumption`;
  $("#chart-summary").innerHTML = `
    <div><span>${generationLabel}</span><strong>${stats.solarTotal.toFixed(1)} ${unit}</strong></div>
    <div><span>${consumptionLabel}</span><strong>${stats.loadTotal.toFixed(1)} ${unit}</strong></div>
    <div><span>${stats.balance >= 0 ? "Estimated Surplus" : "Estimated Import"}</span><strong>${Math.abs(stats.balance).toFixed(1)} ${unit}</strong></div>
    <div><span>Peak Points</span><strong>Solar ${stats.peakSolarLabel} · Load ${stats.peakLoadLabel}</strong></div>
  `;
}

function chartInsight(stats, mode) {
  const period = periodLabel(mode).toLowerCase();
  const unit = summaryUnitForMode(mode);
  const balanceText =
    stats.balance >= 0
      ? `Solar production is ahead of consumption by ${stats.balance.toFixed(1)} ${unit}, so this ${period} has export or battery-charging opportunity.`
      : `Consumption is higher than generation by ${Math.abs(stats.balance).toFixed(1)} ${unit}, so this ${period} likely needs grid import or battery support.`;
  return `${balanceText} Peak solar occurs at ${stats.peakSolarLabel}; peak load occurs at ${stats.peakLoadLabel}.`;
}

function unitForMode(mode) {
  return mode === "day" ? "kW" : "kWh";
}

function summaryUnitForMode(_mode) {
  return "kWh";
}

function periodLabel(mode) {
  return { day: "Day", week: "Week", month: "Month", year: "Year" }[mode] || "Period";
}

function buildYearReadings() {
  const month = solaris.readings?.month || { solar: [148, 161, 139, 172], load: [131, 146, 151, 143] };
  const monthlySolarAverage = month.solar.reduce((sum, value) => sum + value, 0) / Math.max(1, month.solar.length);
  const monthlyLoadAverage = month.load.reduce((sum, value) => sum + value, 0) / Math.max(1, month.load.length);
  const season = [0.88, 0.94, 1.04, 1.08, 1.12, 1.02, 1, 0.98, 0.93, 0.88, 0.85, 0.87];
  const loadSeason = [0.9, 0.92, 0.98, 1.02, 1.08, 1.04, 1, 0.99, 0.96, 0.94, 0.92, 0.93];
  return {
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    solar: season.map((factor) => Number((monthlySolarAverage * factor).toFixed(1))),
    load: loadSeason.map((factor) => Number((monthlyLoadAverage * factor).toFixed(1))),
  };
}

function renderSuggestions() {
  $("#suggestions").innerHTML = solaris.suggestions
    .slice(0, 4)
    .map((item) => `<article class="suggestion"><strong>${item.title}</strong><p>${item.body}</p></article>`)
    .join("");
}

function renderAgentInsights() {
  const container = $("#agent-insights");
  if (!container) return;
  if (solaris.agentInsightsAnimating) return;

  const cards = getAgentInsightCards();
  if (!cards.length) {
    container.innerHTML = `<article class="agent-card"><strong>Agent insights loading</strong><p>Solaris will show peer benchmark, bill, forecast, diagnosis, warranty, cleaning ROI, and surplus automation intelligence here.</p></article>`;
    return;
  }

  container.innerHTML = renderAgentInsightCards(cards);
}

function getAgentInsightCards() {
  const insights = solaris.agentInsights || {};
  return [buildOrchestratorInsightCard(), insights.peerBenchmark, insights.bill, insights.surplus, insights.cleaningRoi, insights.diagnosis, insights.weather, insights.warranty].filter(Boolean);
}

function buildOrchestratorInsightCard() {
  const model = buildOrchestratorModel();
  return {
    title: "Solaris Orchestrator Agent",
    status: model.status,
    summary: `Coordinates specialist agents for the goal: ${model.goal}.`,
    evidence: [
      `Selected ${model.selectedAgents.length} specialist agents.`,
      `Current decision: ${model.steps.find((step) => step.name === "Decide")?.detail || "Decision pending."}`,
      `Tool gate: ${model.steps.find((step) => step.name === "Approval gate")?.detail || "No gate required."}`,
    ],
    action: "Open Mission Control to see orchestration, approval gates, tool execution, verification, and learning.",
  };
}

function renderAgentInsightCards(cards, reveal = false) {
  return cards
    .map(
      (card, index) => `
        <article class="agent-card ${reveal ? "agent-reveal-card" : ""}" style="${reveal ? `animation-delay: ${index * 180}ms` : ""}">
          <div class="agent-card-head">
            <strong>${escapeHtml(card.title)}</strong>
            <span class="pill ${card.status?.toLowerCase().includes("attention") || card.status?.toLowerCase().includes("recommended") ? "warning" : "good"}">${escapeHtml(card.status || "Active")}</span>
          </div>
          <p>${escapeHtml(card.summary || "")}</p>
          <ul>${(card.evidence || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <small>${escapeHtml(card.action || "")}</small>
        </article>
      `,
    )
    .join("");
}

function startAgentInsightsReveal() {
  const container = $("#agent-insights");
  if (!container || solaris.agentInsightsRevealed || solaris.agentInsightsAnimating) return;

  const cards = getAgentInsightCards();
  if (!cards.length) return;

  solaris.agentInsightsAnimating = true;
  container.innerHTML = `
    <article class="agent-processing-card">
      <div class="agent-processing-orbit" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div>
        <strong>Solaris is processing your solar intelligence</strong>
        <p>Observing generation, appliances, bill history, cleaning signal, peer benchmark, and pending actions.</p>
        <div class="agent-processing-steps">
          <span class="agent-processing-step">Observe data</span>
          <span class="agent-processing-arrow" aria-hidden="true">→</span>
          <span class="agent-processing-step">Reason on impact</span>
          <span class="agent-processing-arrow" aria-hidden="true">→</span>
          <span class="agent-processing-step">Prepare action path</span>
        </div>
      </div>
    </article>
  `;

  window.setTimeout(() => {
    container.innerHTML = renderAgentInsightCards(cards, true);
    solaris.agentInsightsAnimating = false;
    solaris.agentInsightsRevealed = true;
  }, 3600);
}

function renderAgentMissionControl() {
  const summary = $("#agent-daily-summary");
  const approvals = $("#agent-approval-list");
  if (!summary || !approvals) return;
  if (solaris.missionControlAnimating) return;

  renderJudgeDemoPanel();

  const runs = solaris.agentRuns || [];
  const memories = solaris.agentMemory || [];
  const latest = runs[0];
  const visibleApprovals = getVisibleAgentApprovals();
  selectVisibleApproval(visibleApprovals);
  summary.innerHTML = renderMissionSummaryCards(latest, visibleApprovals, memories);

  const memoryLink = $("#agent-memory-link");
  if (memoryLink) memoryLink.textContent = `Agent Memory (${memories.length})`;

  renderAgentApprovals(approvals);
}

function renderMissionSummaryCards(latest, visibleApprovals, memories, reveal = false) {
  return `
    <div class="${reveal ? "mission-reveal-card" : ""}" style="${reveal ? "animation-delay: 0ms" : ""}"><span>Latest run</span><strong>${escapeHtml(latest?.title || "Waiting for Agent action")}</strong></div>
    <div class="${reveal ? "mission-reveal-card" : ""}" style="${reveal ? "animation-delay: 160ms" : ""}"><span>Approval queues</span><strong>${visibleApprovals.length || "None"}</strong></div>
    <div class="${reveal ? "mission-reveal-card" : ""}" style="${reveal ? "animation-delay: 320ms" : ""}"><span>Confidence</span><strong>${latest?.confidence ? `${latest.confidence}%` : "N/A"}</strong></div>
    <div class="${reveal ? "mission-reveal-card" : ""}" style="${reveal ? "animation-delay: 480ms" : ""}"><span>Memory items</span><strong>${memories.length}</strong></div>
  `;
}

function startMissionControlReveal() {
  const summary = $("#agent-daily-summary");
  const approvals = $("#agent-approval-list");
  const loop = $("#mission-loop-pill");
  if (!summary || !approvals || solaris.missionControlRevealed || solaris.missionControlAnimating) return;

  const runs = solaris.agentRuns || [];
  const memories = solaris.agentMemory || [];
  const latest = runs[0];
  const visibleApprovals = getVisibleAgentApprovals();
  selectVisibleApproval(visibleApprovals);

  solaris.missionControlAnimating = true;
  loop?.classList.remove("mission-loop-animated");
  void loop?.offsetWidth;
  loop?.classList.add("mission-loop-animated");

  summary.innerHTML = `
    <article class="mission-processing-card">
      <strong>Mission Control is processing agent decisions</strong>
      <p>Solaris is checking active runs, approval queues, customer memory, and safe action gates.</p>
      <div class="mission-processing-path">
        <span class="mission-processing-step">Observe</span>
        <span class="mission-processing-arrow" aria-hidden="true">→</span>
        <span class="mission-processing-step">Act</span>
        <span class="mission-processing-arrow" aria-hidden="true">→</span>
        <span class="mission-processing-step">Learn</span>
      </div>
    </article>
  `;
  approvals.innerHTML = `<article class="agent-approval-card mission-loading-card"><strong>Preparing approval cards</strong><p>Solaris is sequencing each decision card with its timeline, replay, and approval state.</p></article>`;

  window.setTimeout(() => {
    summary.innerHTML = renderMissionSummaryCards(latest, visibleApprovals, memories, true);
    renderAgentApprovals(approvals, { reveal: true });
    solaris.missionControlAnimating = false;
    solaris.missionControlRevealed = true;
  }, 3600);
}

function buildOrchestratorModel(approval = null) {
  const surplusKw = Math.max(0, Number((solaris.metrics?.solarNow || 0) - (solaris.metrics?.currentLoad || 0)));
  const pendingApprovals = getVisibleAgentApprovals().filter((approval) => approval.status === "Pending").length;
  const latestRun = (solaris.agentRuns || [])[0];
  const topAppliance = [...(solaris.appliances || [])].sort((a, b) => (b.kwh || 0) - (a.kwh || 0))[0];
  const isTicket = approval?.source === "ticket" || /ticket|underproduction/i.test(`${approval?.type || ""} ${approval?.title || ""}`);
  const goal = approval
    ? approval.title
    : surplusKw >= 1
      ? "Reduce grid import and capture solar surplus today"
      : "Protect solar performance and prepare safe customer actions";
  const decision = approval
    ? approval.recommendation || approval.action || "Use approval gate before Solaris takes external action."
    : surplusKw >= 1
      ? "Prioritize EV charging during 12 PM - 3 PM before lower-value loads."
      : "Keep monitoring; use approval gates for tickets or cleaner actions.";
  const toolAction = pendingApprovals
    ? `${pendingApprovals} approval ${pendingApprovals === 1 ? "gate is" : "gates are"} waiting before Solaris acts.`
    : "No pending approval gate; tools are ready when the customer requests action.";
  const approvalGate = approval
    ? approval.status === "Pending"
      ? `Waiting for customer approval: ${approval.action || "approve or reject this action."}`
      : `Decision already recorded: ${approval.status}.`
    : toolAction;
  const toolExecution = approval
    ? isTicket
      ? "Create company-facing service ticket and start SLA follow-up only after approval."
      : approval.type === "surplus-reminder"
        ? "Create EV charging calendar reminder only after approval."
        : "Execute the selected Solaris tool only after approval."
    : "Use calendar, ticket, cleaner, WhatsApp, or email only when allowed.";

  return {
    goal,
    status: approval ? approval.status : pendingApprovals ? "Approval gated" : "Coordinating",
    confidence: approval?.confidence || latestRun?.confidence || 86,
    selectedAgents: approval
      ? [
          { name: "Monitoring", detail: isTicket ? "Checks expected vs actual production and system health." : `${(solaris.metrics?.solarNow || 0).toFixed(1)} kW solar vs ${(solaris.metrics?.currentLoad || 0).toFixed(1)} kW load.` },
          { name: isTicket ? "Diagnosis" : "Appliance", detail: isTicket ? "Reviews underproduction evidence, weather, cleaning, and inverter context." : topAppliance ? `${topAppliance.name} is highest at ${(topAppliance.kwh || 0).toFixed(1)} kWh.` : "Hybrid NILM and smart plug data ready." },
          { name: "Approval", detail: approvalGate },
          { name: isTicket ? "Ticket Tool" : "Action Tool", detail: toolExecution },
          { name: "Notification", detail: "Uses opted-in channels after decision or completion." },
          { name: "Memory", detail: "Stores safe approval and action preference for future runs." },
        ]
      : [
          { name: "Monitoring", detail: `${(solaris.metrics?.solarNow || 0).toFixed(1)} kW solar vs ${(solaris.metrics?.currentLoad || 0).toFixed(1)} kW load.` },
          { name: "Appliance", detail: topAppliance ? `${topAppliance.name} is highest at ${(topAppliance.kwh || 0).toFixed(1)} kWh.` : "Hybrid NILM and smart plug data ready." },
          { name: "Surplus", detail: surplusKw >= 1 ? `${surplusKw.toFixed(1)} kW surplus available.` : "Surplus is below action threshold." },
          { name: "Bill", detail: "Checks grid import, export credit, and night usage cost." },
          { name: "Approval", detail: toolAction },
          { name: "Memory", detail: "Learns customer-safe EV, cleaning, and notification preferences." },
        ],
    steps: [
      { name: "Goal", detail: goal },
      { name: "Observe", detail: approval ? (approval.evidence || []).join(" ") || "Read the approval evidence and current customer state." : "Read solar, load, appliance, ticket, cleaning, and memory state." },
      { name: "Select agents", detail: approval ? "Route this approval through only the specialist agents needed for this ticket/action." : "Route work to specialist solar agents based on the goal." },
      { name: "Decide", detail: decision },
      { name: "Approval gate", detail: approvalGate },
      { name: "Execute tool", detail: toolExecution },
      { name: "Verify", detail: "Track result in Mission Control and event history." },
      { name: "Learn", detail: "Store safe preferences for the next autonomous run." },
    ],
  };
}

function renderOrchestratorPanel(container, options = {}) {
  const approvals = getVisibleAgentApprovals();
  const models = approvals.length ? approvals.map((approval) => ({ approval, model: buildOrchestratorModel(approval) })) : [{ approval: null, model: buildOrchestratorModel() }];
  container.innerHTML = models
    .map(({ approval, model }, cardIndex) => renderOrchestratorCard(model, approval, options, cardIndex))
    .join("");
}

function renderOrchestratorCard(model, approval, options = {}, cardIndex = 0) {
  const revealClass = options.reveal ? "mission-reveal-card" : "";
  const baseDelay = 620 + cardIndex * 520;
  return `
    <article class="orchestrator-card ${revealClass}" style="${options.reveal ? `animation-delay: ${baseDelay}ms` : ""}">
      <div class="orchestrator-head">
        <div>
          <span class="label">${approval ? "Approval orchestration" : "Current orchestrated goal"}</span>
          <strong>${escapeHtml(model.goal)}</strong>
        </div>
        <span class="pill ${["Approval gated", "Pending"].includes(model.status) ? "warning" : model.status === "Rejected" ? "warning" : "good"}">${escapeHtml(model.status)}</span>
      </div>
      <div class="orchestrator-flow">
        ${model.steps
          .map(
            (step, index) => `
              <div class="orchestrator-flow-item ${options.reveal ? "orchestrator-flow-reveal" : ""}" style="${options.reveal ? `animation-delay: ${baseDelay + 280 + index * 120}ms` : ""}">
                <span>${escapeHtml(step.name)}</span>
                <p>${escapeHtml(step.detail)}</p>
              </div>
              ${index < model.steps.length - 1 ? `<span class="orchestrator-flow-arrow ${options.reveal ? "orchestrator-flow-reveal" : ""}" style="${options.reveal ? `animation-delay: ${baseDelay + 340 + index * 120}ms` : ""}" aria-hidden="true">→</span>` : ""}
            `,
          )
          .join("")}
      </div>
      <div class="orchestrator-agent-grid">
        ${model.selectedAgents
          .map(
            (agent, index) => `
              <div class="orchestrator-agent ${options.reveal ? "mission-reveal-card" : ""}" style="${options.reveal ? `animation-delay: ${baseDelay + 1360 + index * 100}ms` : ""}">
                <strong>${escapeHtml(agent.name)}</strong>
                <p>${escapeHtml(agent.detail)}</p>
              </div>
            `,
          )
          .join("")}
      </div>
      <small>Orchestration confidence: ${model.confidence}% · Solaris coordinates agents first, then uses tools only after safety and approval checks.</small>
    </article>
  `;
}

function renderAgentMemoryItems(memories = solaris.agentMemory || []) {
  return memories.length
    ? memories
        .map(
          (item) => `
            <article class="memory-item">
              <strong>${escapeHtml(item.label)}</strong>
              <p>${escapeHtml(item.evidence || "")}</p>
            </article>
          `,
        )
        .join("")
    : `<article class="memory-item"><strong>No preferences learned yet</strong><p>Solaris will remember user-safe preferences after Agent actions.</p></article>`;
}

function selectVisibleApproval(approvals) {
  if (!approvals.length) {
    solaris.selectedApprovalId = "";
    return null;
  }

  const selected = approvals.find((approval) => approval.id === solaris.selectedApprovalId);
  if (selected) return selected;

  solaris.selectedApprovalId = approvals[0].id;
  return approvals[0];
}

function getVisibleAgentApprovals() {
  const approvals = getAllMissionApprovals();
  const pending = approvals.filter((approval) => approval.status === "Pending");
  const completed = approvals.filter((approval) => approval.status !== "Pending");
  return [...pending, ...completed];
}

function getAllMissionApprovals() {
  const approvals = [...(solaris.agentApprovals || [])];
  const ticketApproval = missionTicketApproval();
  if (ticketApproval) approvals.unshift(ticketApproval);
  return approvals;
}

function missionTicketApproval() {
  const approval = solaris.ticketApproval;
  if (!approval || !["Awaiting user approval", "Approved", "Rejected"].includes(approval.status)) return null;

  return {
    id: approval.id || `APR-${approval.ticketId}`,
    source: "ticket",
    type: "ticket-underproduction",
    title: `${approval.ticketId}: ${approval.subject}`,
    status: approval.status === "Awaiting user approval" ? "Pending" : approval.status,
    confidence: 84,
    recommendation: "Solaris detected solar production below expected and needs customer approval before creating the service ticket.",
    evidence: [
      `Ticket: ${approval.ticketId}.`,
      `Type: ${approval.type || "Underproduction"}.`,
      `Severity: ${approval.severity || "Medium"}.`,
      approval.description || "Production is below expected and requires investigation.",
    ],
    action: "Approve to create the company-facing service ticket, or reject to stop escalation.",
    createdAt: approval.createdAt,
  };
}

function renderApprovalTimeline(approval, runs) {
  const matchedRuns = findRunsForApproval(approval, runs).slice(0, 2);
  const fallbackRun = buildApprovalFallbackRun(approval);
  const timelineBody = matchedRuns.length
    ? matchedRuns
        .map(
          (run) => `
            <div class="approval-run">
              <div class="approval-run-head">
                <strong>${escapeHtml(run.title || approval.title)}</strong>
                <span class="pill ${run.status === "Waiting for Approval" ? "warning" : "good"}">${escapeHtml(run.status || "Ready")}</span>
              </div>
              ${renderRunSteps(run)}
            </div>
          `,
        )
        .join("")
    : renderRunSteps(fallbackRun);

  return `
    <article class="approval-timeline-group ${approval.status === "Pending" ? "pending" : approval.status === "Rejected" ? "rejected" : "approved"}">
      <div class="approval-timeline-head">
        <div>
          <span class="label">Decision timeline</span>
          <strong>${escapeHtml(approval.title)}</strong>
        </div>
        <span class="pill approval-status ${approval.status === "Pending" ? "warning" : approval.status === "Rejected" ? "warning" : "good"}">${escapeHtml(approval.status)}</span>
      </div>
      ${timelineBody}
    </article>
  `;
}

function buildApprovalFallbackRun(approval) {
  if (approval.source === "ticket") {
    return {
      title: `${approval.title} decision flow`,
      status: approval.status === "Pending" ? "Waiting for Approval" : "Completed",
      steps: [
        { name: "Observed", detail: (approval.evidence || []).join(" "), status: "done" },
        { name: "Reasoned", detail: "Solaris found a production issue that may need company investigation.", status: "done" },
        { name: "Decision", detail: "Ask customer approval before creating the service ticket.", status: "done" },
        { name: "Action", detail: approval.status === "Pending" ? "Waiting for customer approval in Mission Control." : `Approval status is ${approval.status}.`, status: approval.status === "Pending" ? "ready" : "done" },
        { name: "Verification", detail: "After approval, Solaris will create the ticket and track status.", status: approval.status === "Pending" ? "ready" : "done" },
      ],
    };
  }

  return {
    title: `${approval.title} decision flow`,
    status: approval.status === "Pending" ? "Waiting for Approval" : "Completed",
    steps: [
      { name: "Observed", detail: (approval.evidence || []).join(" "), status: "done" },
      { name: "Decision", detail: approval.recommendation || "Approval required before action.", status: "done" },
      { name: "Action", detail: approval.action || "Waiting for approval.", status: approval.status === "Pending" ? "ready" : "done" },
    ],
  };
}

function findRunsForApproval(approval, runs) {
  const exact = runs.filter((run) => run.approvalId && run.approvalId === approval.id);
  if (exact.length) return exact;

  const approvalText = `${approval.title || ""} ${approval.type || ""}`.toLowerCase();
  return runs.filter((run) => {
    const runText = `${run.title || ""} ${run.approvalType || ""}`.toLowerCase();
    if (approval.type && run.approvalType === approval.type) return true;
    if (approval.source === "ticket" && (runText.includes("underproduction") || runText.includes("ticket"))) return true;
    if (approvalText.includes("surplus") && runText.includes("surplus")) return true;
    if (approvalText.includes("clean") && runText.includes("clean")) return true;
    if (approvalText.includes("ticket") && runText.includes("ticket")) return true;
    return false;
  });
}

function renderRunSteps(run) {
  return (run.steps || [])
    .map(
      (step) => `
        <article class="agent-run-step">
          <span class="step-status ${escapeHtml(step.status || "ready")}">${escapeHtml(step.status || "ready")}</span>
          <strong>${escapeHtml(step.name)}</strong>
          <p>${escapeHtml(step.detail)}</p>
        </article>
      `,
    )
    .join("");
}

function renderJudgeDemoPanel() {
  const container = $("#judge-demo-panel");
  if (!container) return;

  const button = $("#run-judge-demo");
  if (button) button.textContent = solaris.agentDemoVisible ? "Hide Agentic Scenario" : "Run Agentic Scenario";

  if (!solaris.agentDemoVisible) {
    container.innerHTML = "";
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const demo = solaris.agentDemo;
  if (!demo) {
    container.innerHTML = `
      <article class="judge-demo-empty">
        <strong>Agentic scenario is loading</strong>
        <p>Solaris is simulating a solar operations incident with detection, diagnosis, approval gate, tool action, verification, and learning.</p>
      </article>
    `;
    return;
  }

  container.innerHTML = `
    <article class="hackathon-scenario-card">
      <div class="scenario-hero">
        <div>
          <span class="scenario-kicker">Hackathon Demo Mode</span>
          <strong>${escapeHtml(demo.title || "Agentic Solar Incident Scenario")}</strong>
          <p>${escapeHtml(demo.summary || "")}</p>
        </div>
        <span class="scenario-level">${escapeHtml(demo.autonomyLevel || "Level 4")}</span>
      </div>

      <div class="scenario-roi-grid">
        ${(demo.roi || [])
          .map(
            (item) => `
              <div class="scenario-roi-card">
                <strong>${escapeHtml(item.value)}</strong>
                <span>${escapeHtml(item.label)}</span>
              </div>
            `,
          )
          .join("")}
      </div>

      <div class="scenario-timeline" aria-label="Agentic scenario timeline">
        ${(demo.timeline || [])
          .map(
            (item, index) => `
              <div class="scenario-step ${escapeHtml(item.status || "ready")}" style="animation-delay: ${index * 120}ms">
                <span>${escapeHtml(item.step)}</span>
                <p>${escapeHtml(item.detail)}</p>
              </div>
            `,
          )
          .join("")}
      </div>

      <div class="judge-demo-grid scenario-detail-grid">
        ${renderJudgeDemoSection("Evidence", demo.evidence)}
        ${renderJudgeDemoSection("Tool Use", demo.tools)}
        ${renderJudgeDemoSection("Approval Gate", demo.approvals)}
        ${renderJudgeDemoSection("Outcome", demo.outcomes)}
      </div>
    </article>
  `;
}

function renderJudgeDemoSection(title, items = []) {
  return `
    <div class="judge-demo-section">
      <span class="label">${escapeHtml(title)}</span>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderAgentApprovals(container, options = {}) {
  const visibleApprovals = getVisibleAgentApprovals();
  container.innerHTML = visibleApprovals.length
    ? visibleApprovals
        .map(
          (approval, index) => `
            <article class="agent-approval-card ${options.reveal ? "mission-reveal-card" : ""} ${approval.id === solaris.selectedApprovalId ? "selected" : ""} ${approval.status === "Approved" ? "approved" : approval.status === "Rejected" ? "rejected" : ""}" style="${options.reveal ? `animation-delay: ${760 + index * 220}ms` : ""}">
              <div class="agent-approval-head">
                <strong>${escapeHtml(approval.title)}</strong>
                <span class="pill approval-status ${approval.status === "Pending" ? "warning" : approval.status === "Rejected" ? "warning" : "good"}">${escapeHtml(approval.status)}</span>
              </div>
              <div class="approval-link-row">
                <button class="replay-link" data-agent-replay="${escapeHtml(approval.id)}" type="button"><span aria-hidden="true">&#128065;</span> Agentic Replay</button>
                <span class="approval-link-separator" aria-hidden="true"></span>
                <button class="timeline-button ${approval.id === solaris.selectedApprovalId ? "active" : ""}" data-agent-timeline="${escapeHtml(approval.id)}" type="button">Timeline</button>
              </div>
              ${approval.source === "ticket" ? `<span class="source">Maintenance ticket approval</span>` : ""}
              ${renderApprovalOrchestrationPath(approval)}
              <p>${escapeHtml(approval.recommendation || "")}</p>
              <ul>${(approval.evidence || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              <small>Confidence ${approval.confidence || 0}% · ${escapeHtml(approval.action || "")}</small>
              ${renderAgentApprovalResult(approval)}
            </article>
          `,
        )
        .join("")
    : `<article class="agent-approval-card"><strong>No pending approvals</strong><p>Auto-run decisions will appear here before Solaris acts.</p></article>`;

  $$("[data-agent-approval]").forEach((button) => {
    button.addEventListener("click", () => handleAgentApproval(button.dataset.agentApproval, button.dataset.agentApprovalAction, button.dataset.agentApprovalSource || "agent"));
  });
  $$("[data-agent-timeline]").forEach((button) => {
    button.addEventListener("click", () => {
      solaris.selectedApprovalId = button.dataset.agentTimeline;
      renderAgentApprovals(container);
      openTimelineModal(solaris.selectedApprovalId);
    });
  });
  $$("[data-agent-replay]").forEach((button) => {
    button.addEventListener("click", () => {
      solaris.selectedApprovalId = button.dataset.agentReplay;
      renderAgentApprovals(container);
      openApprovalReplayModal(solaris.selectedApprovalId);
    });
  });
  $$("[data-orchestration-replay]").forEach((button) => {
    button.addEventListener("click", () => {
      solaris.selectedApprovalId = button.dataset.orchestrationReplay;
      renderAgentApprovals(container);
      openOrchestrationReplayModal(solaris.selectedApprovalId);
    });
  });
}

function renderApprovalOrchestrationPath(approval) {
  const model = buildOrchestratorModel(approval);
  const status = approval.status || "Pending";
  const steps = model.steps.map((step) => ({
    ...step,
    state:
      status === "Rejected"
        ? ["Execute tool", "Verify", "Learn"].includes(step.name)
          ? "blocked"
          : "done"
        : status === "Pending"
          ? step.name === "Approval gate"
            ? "active"
            : ["Execute tool", "Verify", "Learn"].includes(step.name)
              ? "waiting"
              : "done"
          : "done",
  }));
  const goalText = status === "Pending" ? "Goal waiting at approval gate" : status === "Rejected" ? "Goal stopped by customer decision" : "Goal completed";

  return `
    <div class="approval-orchestration">
      <div class="approval-orchestration-head">
        <div class="approval-orchestration-title">
          <span class="label">Orchestration path</span>
          <button class="orchestration-replay-link" data-orchestration-replay="${escapeHtml(approval.id)}" type="button">Orchestration Replay</button>
        </div>
        <strong>${escapeHtml(goalText)}</strong>
      </div>
      <div class="approval-orchestration-path">
        ${steps
          .map(
            (step, index) => `
              <div class="approval-orchestration-step ${step.state}">
                <span>${escapeHtml(step.name)}</span>
              </div>
              ${index < steps.length - 1 ? `<span class="approval-orchestration-arrow ${step.state}" aria-hidden="true">→</span>` : ""}
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function openTimelineModal(approvalId) {
  const approvals = getVisibleAgentApprovals();
  const approval = approvals.find((item) => item.id === approvalId) || approvals[0];
  const modal = $("#timeline-modal");
  const eyebrow = $("#timeline-modal-eyebrow");
  const title = $("#timeline-modal-title");
  const body = $("#timeline-modal-body");
  if (!modal || !eyebrow || !title || !body || !approval) return;

  solaris.selectedApprovalId = approval.id;
  eyebrow.textContent = "Approval Decision Timeline";
  title.textContent = approval.title || "Decision timeline";
  body.innerHTML = renderApprovalTimeline(approval, solaris.agentRuns || []);
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function openApprovalReplayModal(approvalId) {
  const approvals = getVisibleAgentApprovals();
  const approval = approvals.find((item) => item.id === approvalId) || approvals[0];
  const modal = $("#timeline-modal");
  const eyebrow = $("#timeline-modal-eyebrow");
  const title = $("#timeline-modal-title");
  const body = $("#timeline-modal-body");
  if (!modal || !eyebrow || !title || !body || !approval) return;

  solaris.selectedApprovalId = approval.id;
  eyebrow.textContent = "Agentic Replay";
  title.textContent = approval.title || "Agentic replay";
  body.innerHTML = renderApprovalReplay(approval);
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function openOrchestrationReplayModal(approvalId) {
  const approvals = getVisibleAgentApprovals();
  const approval = approvals.find((item) => item.id === approvalId) || approvals[0];
  const modal = $("#timeline-modal");
  const eyebrow = $("#timeline-modal-eyebrow");
  const title = $("#timeline-modal-title");
  const body = $("#timeline-modal-body");
  if (!modal || !eyebrow || !title || !body || !approval) return;

  solaris.selectedApprovalId = approval.id;
  eyebrow.textContent = "Orchestration Replay";
  title.textContent = approval.title || "Approval orchestration";
  body.innerHTML = renderOrchestratorCard(buildOrchestratorModel(approval), approval, {}, 0);
  modal.classList.add("wide");
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function openAgentMemoryModal() {
  const modal = $("#timeline-modal");
  const eyebrow = $("#timeline-modal-eyebrow");
  const title = $("#timeline-modal-title");
  const body = $("#timeline-modal-body");
  if (!modal || !eyebrow || !title || !body) return;

  eyebrow.textContent = "Agent Memory";
  title.textContent = "Learned customer preferences";
  body.innerHTML = `<div class="agent-memory-list memory-modal-list">${renderAgentMemoryItems()}</div>`;
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function renderApprovalReplay(approval) {
  const toolAction =
    approval.source === "ticket"
      ? "Ticket tool prepares the service escalation; WhatsApp can carry the approval response."
      : approval.type === "surplus-reminder"
        ? "Calendar tool prepares the solar surplus reminder after approval."
        : "Solaris selects the safest available tool only after approval.";
  const outcome =
    approval.status === "Pending"
      ? "Waiting for customer decision before external action."
      : approval.status === "Approved"
        ? "Approved action completed or ready for the customer to save."
        : "Rejected action stopped before external execution.";

  return `
    <article class="judge-demo-card">
      <div class="agent-approval-head">
        <strong>${escapeHtml(approval.title || "Agentic replay")}</strong>
        <span class="pill ${approval.status === "Pending" ? "warning" : approval.status === "Rejected" ? "warning" : "good"}">${escapeHtml(approval.status)}</span>
      </div>
      <p>${escapeHtml(approval.recommendation || "")}</p>
      <div class="judge-demo-grid approval-replay-grid">
        ${renderJudgeDemoSection("Observed", approval.evidence || [])}
        ${renderJudgeDemoSection("Reasoned", [
          approval.source === "ticket"
            ? "Production issue may need company investigation, so Solaris asks before escalation."
            : "Solaris checks customer value, safety, opt-ins, and timing before action.",
          `Confidence: ${approval.confidence || 0}%.`,
        ])}
        ${renderJudgeDemoSection("Approval Gate", [
          approval.action || "Customer approval is required before Solaris acts.",
          `Current status: ${approval.status}.`,
        ])}
        ${renderJudgeDemoSection("Tool Action", [toolAction, outcome])}
        ${renderJudgeDemoSection("Verification", [
          approval.status === "Pending" ? "Solaris will verify after approval." : "Solaris records the result in Mission Control and event history.",
        ])}
        ${renderJudgeDemoSection("Learning", [
          approval.source === "ticket"
            ? "Keep service escalation behind customer approval."
            : "Remember safe customer preferences for future automation.",
        ])}
      </div>
    </article>
  `;
}

function closeTimelineModal() {
  const modal = $("#timeline-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  modal.classList.remove("wide");
  document.body.classList.remove("modal-open");
}

function renderAgentApprovalResult(approval) {
  if (approval.status === "Pending") {
    return `
      <div class="approval-actions">
        <button class="primary" data-agent-approval="${escapeHtml(approval.id)}" data-agent-approval-source="${escapeHtml(approval.source || "agent")}" data-agent-approval-action="approve" type="button">Approve</button>
        <button data-agent-approval="${escapeHtml(approval.id)}" data-agent-approval-source="${escapeHtml(approval.source || "agent")}" data-agent-approval-action="reject" type="button">Reject</button>
      </div>
    `;
  }

  const link = approval.result?.result?.htmlLink || "";
  if (approval.status === "Approved" && link) {
    return `<a class="chat-calendar-action" href="${escapeHtml(link)}" target="_blank" rel="noopener">Save Google Calendar reminder</a>`;
  }

  if (approval.source === "ticket" && approval.status === "Approved") {
    return `<p class="approval-result">Approved. Ticket escalation completed.</p>`;
  }

  if (approval.source === "ticket" && approval.status === "Rejected") {
    return `<p class="approval-result">Rejected. Ticket escalation stopped.</p>`;
  }

  if (approval.status === "Approved") {
    return `<p class="approval-result">Approved. Reminder action completed.</p>`;
  }

  return `<p class="approval-result">Rejected. No external action was taken.</p>`;
}

async function handleAgentApproval(id, action, source = "agent") {
  try {
    if (source === "ticket") {
      if (action === "approve") {
        await approveUnderproductionTicket({ fromMissionControl: true });
      } else {
        await rejectUnderproductionTicket({ fromMissionControl: true });
      }
      return;
    }
    const data = await apiPost(`/api/agent-approvals/${encodeURIComponent(id)}/${action}`);
    solaris.agentApprovals = data.approvals || solaris.agentApprovals;
    solaris.agentRuns = data.agentRuns || solaris.agentRuns;
    solaris.agentMemory = data.agentMemory || solaris.agentMemory;
    solaris.events = data.events || solaris.events;
    renderAgentMissionControl();
    renderEvents();
  } catch (error) {
    addChatMessage("agent", error.message || "Approval action failed.");
  }
}

async function runJudgeDemo() {
  const button = $("#run-judge-demo");
  const note = $("#judge-demo-note");

  if (solaris.agentDemoVisible) {
    solaris.agentDemoVisible = false;
    renderJudgeDemoPanel();
    if (note) note.textContent = "Agentic scenario hidden. Click Run Agentic Scenario to view it again.";
    return;
  }

  solaris.agentDemoVisible = true;
  renderJudgeDemoPanel();

  if (solaris.agentDemo) {
    if (note) note.textContent = "Agentic scenario visible below.";
    return;
  }

  if (button) button.disabled = true;
  if (note) note.textContent = "Preparing agentic solar incident scenario...";

  try {
    const data = await apiPost("/api/judge-demo/run");
    solaris.agentDemo = data.agentDemo || solaris.agentDemo;
    solaris.agentRuns = data.agentRuns || solaris.agentRuns;
    solaris.agentMemory = data.agentMemory || solaris.agentMemory;
    solaris.agentApprovals = data.agentApprovals || solaris.agentApprovals;
    solaris.events = data.events || solaris.events;
    renderAgentMissionControl();
    renderEvents();
    if (note) note.textContent = "Agentic scenario visible below. Click Hide Agentic Scenario to close it.";
  } catch (error) {
    solaris.agentDemoVisible = false;
    renderJudgeDemoPanel();
    if (note) note.textContent = error.message || "Full mission replay failed.";
  } finally {
    if (button) button.disabled = false;
  }
}

function renderAppliances() {
  $("#appliance-count").textContent = `${solaris.appliances.length} devices`;
  const max = Math.max(...solaris.appliances.map((item) => item.kwh), 1);
  $("#appliance-list").innerHTML = solaris.appliances
    .map(
      (item) => `
        <article class="appliance">
          <div>
            <strong>${item.name}</strong>
            <small>${item.type || "Other"} · ${item.kwh.toFixed(1)} kWh today · ₹${item.cost} estimated · ${item.confidence}% confidence</small>
            <div class="bar"><span style="width:${(item.kwh / max) * 100}%"></span></div>
          </div>
          <span class="source">${item.source}</span>
          <button class="remove-button" data-remove-appliance="${item.id}">Remove</button>
        </article>
      `,
    )
    .join("");

  $$("[data-remove-appliance]").forEach((button) => {
    button.addEventListener("click", async () => {
      const data = await apiDelete(`/api/appliances/${encodeURIComponent(button.dataset.removeAppliance)}`);
      solaris.appliances = data.appliances;
      solaris.events = data.events;
      renderBillUsageOverview();
      renderAppliances();
      renderEvents();
    });
  });
}

function renderBillUsageOverview() {
  const amount = $("#bill-estimated-amount");
  if (!amount) return;
  const overview = buildBillUsageOverview();
  $("#bill-month-label").textContent = overview.monthLabel;
  amount.textContent = `Rs ${overview.projectedPayable}`;
  $("#bill-grid-import").textContent = `${overview.projectedGridImportKwh.toFixed(0)} kWh`;
  $("#bill-top-appliance").textContent = overview.topAppliance ? overview.topAppliance.name : "--";
  $("#bill-import-cost").textContent = `Rs ${overview.importCost}`;
  $("#bill-export-credit").textContent = `-Rs ${overview.exportCredit}`;
  $("#bill-fixed-charges").textContent = `Rs ${overview.fixedCharges}`;
  $("#bill-control-advice").textContent = overview.advice;
  $("#bill-appliance-impact-list").innerHTML = overview.appliances
    .map(
      (item) => `
        <article class="appliance-impact">
          <div>
            <strong>${item.name}</strong>
            <span>${item.kwh.toFixed(1)} kWh today &middot; Rs ${item.cost}/day &middot; ${item.share}% of tracked cost</span>
          </div>
          <small>${item.action}</small>
        </article>
      `,
    )
    .join("");
}

function buildBillUsageOverview() {
  const appliances = [...(solaris.appliances || [])].sort((a, b) => (b.cost || 0) - (a.cost || 0));
  const tariff = Number(solaris.site?.tariffPerKwh || 0);
  const exportRate = Number(solaris.site?.exportRatePerKwh || 0);
  const fixedCharges = Number(solaris.bill?.fixedCharges || 0);
  const days = 30;
  const projectedGridImportKwh = Number((Number(solaris.metrics?.nightUsage || 0) * days).toFixed(1));
  const importCost = Math.round(projectedGridImportKwh * tariff);
  const exportCredit = Math.round(Number(solaris.metrics?.exported || 0) * days * exportRate);
  const projectedPayable = Math.max(0, importCost + fixedCharges - exportCredit);
  const totalCost = appliances.reduce((sum, item) => sum + Number(item.cost || 0), 0) || 1;
  const ranked = appliances.slice(0, 5).map((item, index) => ({
    ...item,
    share: Math.round((Number(item.cost || 0) / totalCost) * 100),
    action: applianceLimitAdvice(item, index),
  }));
  const topAppliance = ranked[0] || null;
  const monthLabel = solaris.bill?.currentCycle?.month || solaris.bill?.month || "Current cycle";
  const advice = topAppliance
    ? `${topAppliance.name} is the biggest bill driver. Limit long runtime, shift flexible use to 12 PM - 3 PM, and avoid night operation when possible.`
    : "Add appliances to see which device is increasing the bill.";
  return { monthLabel, projectedPayable, projectedGridImportKwh, importCost, exportCredit, fixedCharges, topAppliance, appliances: ranked, advice };
}

function generateBill() {
  const overview = buildBillUsageOverview();
  const created = new Date();
  const due = new Date(created);
  due.setDate(due.getDate() + 10);
  solaris.generatedBill = {
    invoiceNumber: `SOL-BILL-${created.getFullYear()}${String(created.getMonth() + 1).padStart(2, "0")}-${String(created.getTime()).slice(-4)}`,
    month: overview.monthLabel,
    createdAt: created.toISOString(),
    dueDate: due.toISOString(),
    projectedPayable: overview.projectedPayable,
    projectedGridImportKwh: overview.projectedGridImportKwh,
    importCost: overview.importCost,
    exportCredit: overview.exportCredit,
    fixedCharges: overview.fixedCharges,
    topAppliance: overview.topAppliance,
    appliances: overview.appliances,
  };
  solaris.selectedPaymentMethod = "";
  solaris.billPaid = false;
  renderGeneratedBill();
}

function renderGeneratedBill() {
  const billBox = $("#generated-bill");
  if (!billBox) return;
  const empty = $("#generated-bill-empty");
  const status = $("#bill-payment-status");
  const bill = solaris.generatedBill;
  if (!bill) {
    billBox.hidden = true;
    empty.hidden = false;
    status.textContent = "Not generated";
    status.className = "pill";
    return;
  }

  billBox.hidden = false;
  empty.hidden = true;
  status.textContent = solaris.billPaid ? "Payment confirmed" : "Awaiting payment";
  status.className = `pill ${solaris.billPaid ? "good" : "warning"}`;
  $("#bill-invoice-number").textContent = bill.invoiceNumber;
  $("#bill-due-date").textContent = formatDisplayDate(bill.dueDate);
  $("#bill-customer-name").textContent = solaris.currentUser?.name || "Solaris Customer";
  $("#bill-customer-email").textContent = solaris.currentUser?.email || "customer@solaris.local";
  $("#bill-customer-address").textContent = solaris.currentUser?.address || "Demo Solar Site";
  $("#bill-total-payable").textContent = `Rs ${bill.projectedPayable}`;
  $("#bill-line-items").innerHTML = [
    { label: `Grid import estimate (${bill.projectedGridImportKwh.toFixed(0)} kWh)`, amount: bill.importCost },
    { label: "Fixed charges", amount: bill.fixedCharges },
    { label: "Solar export credit", amount: -bill.exportCredit },
  ]
    .map((item) => `<div class="bill-line-item"><span>${item.label}</span><strong>${item.amount < 0 ? "-" : ""}Rs ${Math.abs(item.amount)}</strong></div>`)
    .join("");
  $$("[data-payment-method]").forEach((button) => {
    button.classList.toggle("active", button.dataset.paymentMethod === solaris.selectedPaymentMethod);
  });
  $("#pay-bill").disabled = !solaris.selectedPaymentMethod || solaris.billPaid;
  $("#pay-bill").textContent = solaris.selectedPaymentMethod ? "Open Payment Link" : "Pay Bill";
  $("#payment-note").textContent = solaris.billPaid
    ? `Payment was confirmed externally using ${solaris.selectedPaymentMethod}.`
    : solaris.selectedPaymentMethod
      ? `${solaris.selectedPaymentMethod} selected. Click Open Payment Link. Solaris will not mark paid until payment confirmation is received.`
      : "Select a payment option to continue.";
}

function selectPaymentMethod(method) {
  if (!solaris.generatedBill || solaris.billPaid) return;
  solaris.selectedPaymentMethod = method;
  renderGeneratedBill();
}

async function payGeneratedBill() {
  if (!solaris.generatedBill || !solaris.selectedPaymentMethod) return;
  const note = $("#payment-note");
  note.textContent = "Creating payment link...";
  try {
    const data = await apiPost("/api/bill/payment-link", {
      invoiceNumber: solaris.generatedBill.invoiceNumber,
      amount: solaris.generatedBill.projectedPayable,
      method: solaris.selectedPaymentMethod,
    });
    solaris.events = data.events || solaris.events;
    note.textContent = data.message || "Payment link opened. Waiting for payment confirmation.";
    window.open(data.paymentUrl, "_blank", "noopener");
    renderEvents();
  } catch (error) {
    note.textContent = error.message;
  }
}

function formatDisplayDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function applianceLimitAdvice(item, index) {
  const type = String(item.type || item.name || "").toLowerCase();
  if (type.includes("ac")) return "Limit: raise setpoint to 25-26 C, use timer, avoid long night runtime.";
  if (type.includes("ev")) return "Shift: charge mainly between 12 PM - 3 PM when solar surplus is highest.";
  if (type.includes("geyser")) return "Limit: run once in daylight; avoid repeated night heating.";
  if (type.includes("pump") || type.includes("washing") || type.includes("dishwasher")) return "Shift: schedule during solar hours instead of evening grid import.";
  if (type.includes("fridge")) return "Monitor: do not switch off; check door seal and temperature setting.";
  return index === 0 ? "Limit or shift this load where practical." : "Watch usage trend and shift flexible use to solar hours.";
}

function renderTickets() {
  const openTickets = solaris.tickets.filter((ticket) => !["Closed", "Resolved"].includes(ticket.status));
  $("#ticket-count").textContent = `${openTickets.length} open`;
  renderUnderproductionApproval();
  $("#ticket-list").innerHTML = solaris.tickets
    .map(
      (ticket) => `
        <article class="ticket">
          <strong>${ticket.id}: ${ticket.title}</strong>
          <p>${ticket.body}</p>
          <div class="ticket-meta">
            <span><b>Type:</b> ${ticket.type || "Other"}</span>
            <span><b>Source:</b> ${ticket.source || "Manual"}</span>
            <span class="pill warning">${ticket.status}</span>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderUnderproductionApproval() {
  const approval = solaris.ticketApproval;
  const container = $("#underproduction-approval");
  if (!approval || approval.status !== "Awaiting user approval") {
    container.innerHTML = "";
    return;
  }

  const duplicate = solaris.tickets.find(
    (ticket) => ticket.id !== approval.ticketId && ticket.type === approval.type && !["Closed", "Resolved"].includes(ticket.status),
  );
  if (duplicate) {
    container.innerHTML = `
      <span class="label">Automatic ticket recommendation</span>
      <strong>${approval.subject}</strong>
      <p>A similar ${approval.type} ticket is already open: ${duplicate.id}. Close it before creating another.</p>
    `;
    return;
  }

  container.innerHTML = `
    <span class="label">Approval moved to Mission Control</span>
    <strong>${approval.ticketId ? `${approval.ticketId}: ` : ""}${approval.subject}</strong>
    <p>${approval.description}</p>
    <p><b>Action:</b> Open AI Agents &gt; Mission Control to approve or reject this ticket alongside other approvals.</p>
    <p><b>WhatsApp:</b> Use the Approve or Reject button in the Solaris WhatsApp approval message.</p>
    <p><b>Type:</b> ${approval.type} · <b>Severity:</b> ${approval.severity} · <b>Status:</b> ${approval.status}</p>
  `;
}

async function approveUnderproductionTicket(options = {}) {
  $("#ticket-status-note").textContent = "Creating approved underproduction ticket...";
  try {
    const data = await apiPost("/api/tickets/approve-underproduction");
    solaris.tickets = data.tickets;
    solaris.ticketApproval = data.ticketApproval;
    solaris.agentRuns = data.agentRuns || solaris.agentRuns;
    solaris.events = data.events;
    $("#ticket-status-note").textContent = `Approved ticket ${data.ticket.id}. ${data.notificationStatus || ""}`;
    renderUnderproductionApproval();
    renderTickets();
    renderAgentMissionControl();
    renderEvents();
    if (options.fromMissionControl) addChatMessage("agent", `Approved ticket ${data.ticket.id}. Solaris moved it to maintenance tracking.`);
  } catch (error) {
    $("#ticket-status-note").textContent = error.message;
    if (options.fromMissionControl) addChatMessage("agent", error.message);
  }
}

async function rejectUnderproductionTicket(options = {}) {
  $("#ticket-status-note").textContent = "Rejecting underproduction ticket...";
  try {
    const data = await apiPost("/api/tickets/reject-underproduction");
    solaris.tickets = data.tickets;
    solaris.ticketApproval = data.ticketApproval;
    solaris.agentRuns = data.agentRuns || solaris.agentRuns;
    solaris.events = data.events;
    $("#ticket-status-note").textContent = `Rejected ticket ${data.ticket.id}. ${data.notificationStatus || ""}`;
    renderUnderproductionApproval();
    renderTickets();
    renderAgentMissionControl();
    renderEvents();
    if (options.fromMissionControl) addChatMessage("agent", `Rejected ticket ${data.ticket.id}. Solaris stopped the escalation.`);
  } catch (error) {
    $("#ticket-status-note").textContent = error.message;
    if (options.fromMissionControl) addChatMessage("agent", error.message);
  }
}

function renderCleaner() {
  $("#cleaner-state").textContent = solaris.cleaner.state;
  $("#cleaner-state").className = solaris.cleaner.suspended || solaris.cleaner.state === "Ready" ? "pill good" : "pill warning";
  const savedManualMode = solaris.cleaner.mode === "Manual only";
  const locked = Boolean(solaris.cleaner.active && !solaris.cleaner.suspended && !savedManualMode);
  const keepUserEditing = !locked && isCleanerFormEditing();
  if (!keepUserEditing) {
    $("#cleaner-mode").value = solaris.cleaner.mode;
    $("#cleaner-schedule").value = solaris.cleaner.nextSchedule || "";
  }
  const selectedMode = keepUserEditing ? $("#cleaner-mode").value : solaris.cleaner.mode;
  const selectedSchedule = keepUserEditing ? $("#cleaner-schedule").value : solaris.cleaner.nextSchedule;
  const scheduledMode = selectedMode === "Scheduled";
  $("#cleaner-status-title").textContent = locked ? "Active schedule/activity" : solaris.cleaner.suspended ? "Suspended" : "Ready for new settings";
  $("#cleaner-status-message").textContent = solaris.cleaner.statusMessage || "No active cleaner activity.";
  $("#cleaning-note").textContent = locked
    ? `Current setup is locked. Suspend current activity before changing panel cleaning settings. Next run: ${solaris.cleaner.mode === "Auto optimized" ? "AI managed" : formatDateTime(solaris.cleaner.nextSchedule)}.`
    : keepUserEditing
      ? `Editing cleaner settings. Selected mode: ${selectedMode}. Next run: ${scheduledMode ? formatDateTime(selectedSchedule) : selectedMode === "Auto optimized" ? "AI managed" : "manual control only"}. Click Save Schedule to apply.`
      : `Cleaner set to ${solaris.cleaner.mode}. Next run: ${solaris.cleaner.mode === "Scheduled" ? formatDateTime(solaris.cleaner.nextSchedule) : solaris.cleaner.mode === "Auto optimized" ? "AI managed" : "manual control only"}. New settings are allowed.`;

  ["cleaner-mode", "cleaner-schedule", "save-schedule"].forEach((id) => {
    $(`#${id}`).disabled = locked;
    $(`#${id}`).classList.toggle("is-disabled", locked);
  });
  const cleanerControls = [
    ["start-cleaning", !savedManualMode || solaris.cleaner.state === "Running"],
    ["pause-cleaning", !savedManualMode || solaris.cleaner.state !== "Running"],
    ["stop-cleaning", !savedManualMode || ["Ready", "Suspended"].includes(solaris.cleaner.state)],
  ];
  cleanerControls.forEach(([id, disabled]) => {
    $(`#${id}`).disabled = disabled;
    $(`#${id}`).classList.toggle("is-disabled", disabled);
  });
  if (!locked) {
    updateCleanerScheduleVisibility();
  }
  $("#suspend-cleaning").disabled = !locked;
  $("#suspend-cleaning").classList.toggle("is-disabled", !locked);
}

function isCleanerFormEditing() {
  const activeId = document.activeElement?.id || "";
  return solaris.cleanerFormDirty || activeId === "cleaner-mode" || activeId === "cleaner-schedule";
}

function updateCleanerScheduleVisibility() {
  const scheduledMode = $("#cleaner-mode").value === "Scheduled";
  $("#cleaner-schedule-field").hidden = !scheduledMode;
  $("#cleaner-schedule").disabled = !scheduledMode;
  $("#cleaner-schedule").required = scheduledMode;
  $("#cleaner-schedule").classList.toggle("is-disabled", !scheduledMode);
  return !scheduledMode;
}

function renderPreferences() {
  $("#whatsapp-opt").checked = solaris.preferences.whatsapp;
  $("#email-opt").checked = solaris.preferences.email;
  $("#calendar-opt").checked = solaris.preferences.calendar;
  $("#auto-ticket-opt").checked = solaris.preferences.autoTicket;
  $("#quiet-opt").checked = solaris.preferences.quietHours;
}

function renderEvents() {
  $("#event-log").innerHTML = solaris.events
    .map((item) => {
      const time = new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `<div class="log-entry">${time} · ${item.message}</div>`;
    })
    .join("");
}

function renderCalendarStatus(selector, calendarResult) {
  const target = $(selector);
  const link = calendarResult?.result?.htmlLink || "";
  if (!link) {
    target.textContent = calendarResult.statusText;
    return;
  }
  target.innerHTML = `${escapeHtml(calendarResult.statusText)} <a href="${escapeHtml(link)}" target="_blank" rel="noopener">Save Google Calendar reminder</a>`;
}

async function sendCleanerCommand(command) {
  try {
    const data = await apiPost("/api/cleaner/command", { command });
    solaris.cleaner = data.cleaner;
    solaris.events = data.events;
    solaris.cleanerFormDirty = false;
    renderCleaner();
    renderEvents();
  } catch (error) {
    $("#cleaning-note").textContent = error.message;
  }
}

async function suspendCleaning() {
  const data = await apiPost("/api/cleaner/suspend");
  solaris.cleaner = data.cleaner;
  solaris.events = data.events;
  solaris.cleanerFormDirty = false;
  renderCleaner();
  renderEvents();
}

async function savePreferences() {
  const data = await apiPost("/api/preferences", {
    whatsapp: $("#whatsapp-opt").checked,
    email: $("#email-opt").checked,
    calendar: $("#calendar-opt").checked,
    autoTicket: $("#auto-ticket-opt").checked,
    quietHours: $("#quiet-opt").checked,
  });
  solaris.preferences = data.preferences;
  solaris.events = data.events;
  renderEvents();
}

async function sendEmailReport(reportType = "daily", updateStatus = true) {
  if (updateStatus) $("#email-status").textContent = "Preparing Solaris email report...";
  try {
    const data = await apiPost("/api/email/report", { reportType });
    solaris.events = data.events;
    if (updateStatus) {
      const emailText = data.result.sent
        ? "Email report sent to the registered customer email address."
        : "Email preview generated. Configure Gmail SMTP to send real emails.";
      const whatsappText = data.whatsappResult?.sent
        ? " WhatsApp report also sent."
        : data.whatsappResult?.preview
          ? " WhatsApp preview generated."
          : data.whatsappResult?.error
            ? ` WhatsApp failed: ${data.whatsappResult.error}`
            : data.whatsappResult?.skipped
              ? " WhatsApp report skipped because alerts are disabled."
              : "";
      $("#email-status").textContent = `${emailText}${whatsappText}`;
    }
    renderEvents();
    return true;
  } catch (error) {
    if (updateStatus) {
      $("#email-status").textContent = error.message || "Email report was not sent. Check email opt-in and Gmail configuration.";
    }
    return false;
  }
}

async function sendWhatsAppReport(reportType = "daily") {
  $("#whatsapp-status").textContent = "Preparing Solaris WhatsApp report...";
  try {
    const data = await apiPost("/api/whatsapp/report", { reportType });
    solaris.events = data.events;
    $("#whatsapp-status").textContent = data.result.sent
      ? `${data.result.provider || "WhatsApp provider"} accepted the WhatsApp report for ${data.result.to || "the registered phone"}. Status: ${data.result.messageStatus || "accepted"}.`
      : data.result.preview
        ? "WhatsApp report preview generated. Configure WhatsApp provider credentials to send real reports."
        : data.result.skipped
          ? data.result.reason
          : data.result.error || "WhatsApp report was not sent.";
    renderEvents();
    return true;
  } catch (error) {
    $("#whatsapp-status").textContent = error.message || "WhatsApp report was not sent. Check opt-in and WhatsApp configuration.";
    return false;
  }
}

async function sendAgentMessage(message) {
  if (!solaris.authenticated && !solaris.chatAuthenticated) {
    await sendGuestAgentMessage(message);
    return;
  }

  try {
    const data = await apiPost("/api/agent/chat", { message });
    solaris.events = data.events;
    addChatMessage("agent", data.reply.answer, data.reply.details, data.reply);
    if (solaris.authenticated) await loadState();
    renderEvents();
  } catch {
    addChatMessage("agent", "I could not reach the Solaris agent API. Please check that the backend is running.");
  }
}

async function sendGuestAgentMessage(message) {
  if (solaris.pendingOtpIdentifier) {
    const otp = message.trim().match(/\b\d{6}\b/)?.[0];
    const replacementIdentifier = extractCustomerIdentifier(message);
    if (!otp && replacementIdentifier) {
      solaris.pendingOtpIdentifier = "";
      await sendGuestAgentMessage(replacementIdentifier);
      return;
    }

    if (otp) {
      try {
        const data = await apiPost("/api/auth/verify-otp", {
          identifier: solaris.pendingOtpIdentifier,
          otp,
        });
        solaris.pendingOtpIdentifier = "";
        solaris.authenticated = false;
        solaris.chatAuthenticated = true;
        document.body.classList.add("locked");
        addChatMessage("agent", `OTP verified. Full Solaris Agent chat access is now unlocked for ${data.user.name}. Dashboard access still requires email and password sign-in.`);
        return;
      } catch (error) {
        addChatMessage("agent", error.message || "Invalid OTP. Please try again or request a new OTP.");
        return;
      }
    }

    addChatMessage("agent", "Please enter the 6-digit OTP sent to your registered email, or send another customer ID, email, or phone to request a new OTP.");
    return;
  }

  const identifier = extractCustomerIdentifier(message);
  if (identifier) {
    try {
      const data = await apiPost("/api/auth/identify", { identifier });
      solaris.pendingOtpIdentifier = identifier;
      const previewNote = data.result?.preview ? " Gmail is not configured, so the OTP was generated as an email preview on the server." : "";
      addChatMessage("agent", `I found your customer account. I sent an OTP to ${data.emailHint}. Enter the 6-digit OTP here to unlock full Solaris Agent chat access.${previewNote}`);
      return;
    } catch {
      addChatMessage("agent", "I could not find that customer. You can still ask general Solaris questions, or use Sign Up to register.");
      return;
    }
  }

  addChatMessage(
    "agent",
    "I can help with general Solaris information in guest mode. To access your solar data, send your customer ID, registered email, or registered phone number.",
    [
      "Guest mode cannot show production, appliances, tickets, cleaning schedules, or send emails.",
      "Try: customer@solaris.local",
      "You can also use Sign In or Sign Up on the landing page.",
    ],
  );
}

function renderWelcomeMessage() {
  if (!solaris.chatSessionActive) return;
  const messages = $("#chat-messages");
  if (messages.children.length) return;
  const message =
    solaris.authenticated || solaris.chatAuthenticated
      ? "Hi, I am Solaris. Ask me about your solar generation, appliance usage, cleaning, tickets, or alerts."
      : "Hi, I am Solaris. I can help in guest mode. Send your customer ID, registered email, or phone number to unlock Agent chat access with OTP.";
  addChatMessage("agent", message);
}

function openFloatingChat() {
  if (!solaris.chatSessionActive) {
    solaris.chatSessionActive = true;
    $("#chat-messages").innerHTML = "";
    renderWelcomeMessage();
  }
  $("#floating-chat").classList.add("open");
  setTimeout(() => $("#chat-input").focus(), 0);
}

function closeFloatingChat() {
  solaris.chatSessionActive = false;
  solaris.pendingOtpIdentifier = "";
  $("#chat-input").value = "";
  $("#chat-command-menu").classList.remove("open");
  $("#chat-messages").innerHTML = "";
  $("#floating-chat").classList.remove("open");
}

function addChatMessage(type, text, details = [], meta = {}) {
  const item = document.createElement("div");
  item.className = `message ${type}`;
  const calendarUrl = extractCalendarUrl(details);
  const visibleDetails = calendarUrl ? details.filter((detail) => !String(detail || "").includes(calendarUrl)) : details;
  const detailHtml = visibleDetails.length ? `<ul>${visibleDetails.map((detail) => `<li>${renderChatDetail(detail)}</li>`).join("")}</ul>` : "";
  const actionHtml = calendarUrl ? `<a class="chat-calendar-action" href="${escapeHtml(calendarUrl)}" target="_blank" rel="noopener">Save Google Calendar reminder</a>` : "";
  item.innerHTML = type === "agent" ? `<strong>Solaris</strong>${escapeHtml(text)}${detailHtml}${actionHtml}` : escapeHtml(text);
  $("#chat-messages").appendChild(item);
  $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
}

function renderChatDetail(detail) {
  const text = String(detail || "");
  const url = extractCalendarUrl([text]);
  if (!url) return escapeHtml(text);
  const label = text.toLowerCase().includes("calendar") ? "Save Google Calendar reminder" : "Open link";
  const prefix = text.replace(url, "").replace(/:\s*$/, "").trim();
  return `${prefix ? `${escapeHtml(prefix)}: ` : ""}<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${label}</a>`;
}

function extractCalendarUrl(details = []) {
  return details.map((detail) => String(detail || "").match(/https:\/\/calendar\.google\.com\/calendar\/render\?\S+/)?.[0] || "").find(Boolean) || "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function extractCustomerIdentifier(message) {
  const text = message.trim();
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email) return email;

  const customerId = text.match(/\bCUS[-A-Z0-9]*\d[-A-Z0-9]*\b/i)?.[0];
  if (customerId) return customerId;

  const phone = text.match(/\+?\d[\d\s-]{7,}\d/)?.[0];
  if (phone) return phone;

  return "";
}

async function apiGet(path) {
  const response = await fetch(`${apiBase}${path}`, { credentials: "include" });
  if (!response.ok) throw new Error(`GET ${path} failed with ${response.status}`);
  return response.json();
}

async function apiPost(path, body = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `POST ${path} failed with ${response.status}`);
  return payload;
}

async function apiDelete(path) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw new Error(`DELETE ${path} failed with ${response.status}`);
  return response.json();
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

window.addEventListener("load", init);
