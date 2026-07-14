# Solaris Agent Guide

## Product

Solaris is an Agentic AI Solar Assistant for solar users. It monitors solar generation, tracks appliance consumption, recommends better usage, controls panel cleaning, detects faults, creates service tickets, and follows up with the solar company.

## Current App

- `index.html` contains the main dashboard shell.
- `styles.css` contains the UI styling.
- `app.js` contains frontend state rendering and API calls.
- `server.js` contains the local Solaris backend API and mocked agent state.
- `package.json` defines the local Node start command.

Run locally with:

```powershell
npm start
```

Then open:

```text
http://localhost:8787
```

## Agent Modules

### Solar Monitoring Agent

Tracks solar generation, current load, grid import/export, expected vs actual production, and system health.

Future integration targets:

- Inverter API
- Smart meter API
- Battery API
- Weather API
- Tariff data

### Hybrid Appliance Agent

Tracks appliance-level power consumption using:

- NILM software estimation from whole-home load data
- Smart plug readings for selected appliances

The UI should always show the source and confidence for appliance readings.

### Recommendation Agent

Creates timely suggestions for:

- Running appliances during high solar generation
- Reducing night usage
- Reducing grid import
- Battery and EV charging optimization
- Cleaning and maintenance actions

Suggestions should be useful, short, and action-oriented.

### On-Demand Action Agent

The chat agent can perform authenticated customer actions from natural-language commands:

- Add appliance, for example: `Add appliance Dishwasher using Smart plug`
- Schedule cleaning, for example: `Schedule cleaning tomorrow at 6 AM`
- Suspend and reschedule cleaning, for example: `Suspend current cleaning and schedule cleaning tomorrow at 7 AM`
- Raise maintenance ticket, for example: `Raise ticket for low production`

After an on-demand action completes, Solaris automatically sends an activity completion email to the registered customer email address. Do not ask for separate confirmation after the action has already been requested by the authenticated user.

If the user specifically asks the Agent to send a report, data, detail, summary, or similar information, Solaris must first ask how to send it:

- Email
- WhatsApp
- Both

After the user chooses a channel, send through only the selected channel or channels. Dashboard buttons can still use their explicit channel behavior.

For ticket creation, the Agent must collect required fields before creating the ticket:

- Ticket type
- Subject
- Description

If any field is missing, ask for that field and keep a pending draft. The user can cancel with `cancel ticket`.

### Landing Chat OTP Access

The floating Solaris Agent is visible on the landing page in guest mode. Guest mode can answer general questions only.

To unlock full Agent access without using the login form:

1. User sends customer ID, registered email, or registered phone in chat.
2. Solaris sends a 6-digit OTP to the registered customer email address.
3. User enters the OTP in chat.
4. Solaris creates a chat-only authenticated session and unlocks full Agent chat functionality.

Dashboard access still requires email and password login.

### Notification Agent

Sends user-approved messages through:

- WhatsApp
- Email
- In-app notification
- SMS, optional later

Always respect opt-in settings and quiet hours.

### Cleaning Agent

Recommends or controls solar panel cleaning based on:

- Production drop
- Dust or pollution level
- Rainfall history
- Weather forecast
- Last cleaning date
- Water level and cleaner readiness

Cleaner commands must support manual, scheduled, and auto-optimized modes.

### Fault And Ticket Agent

Detects critical issues and escalates them to the solar company.

Ticket payloads should include:

- User and site details
- System ID
- Issue type and severity
- Timestamp
- Energy graph context
- Error codes, when available
- Expected vs actual generation
- Recommended diagnosis

The agent must track ticket status and remind the company when SLA deadlines are missed.

## API Conventions

Current local endpoints:

- `GET /api/state`
- `POST /api/suggestions/refresh`
- `POST /api/agent/chat`
- `POST /api/email/report`
- `POST /api/whatsapp/test`
- `GET /api/whatsapp/webhook`
- `POST /api/whatsapp/webhook`
- `POST /api/cleaner/command`
- `POST /api/cleaner/schedule`
- `POST /api/tickets`
- `POST /api/preferences`

Keep new endpoints small and explicit. Prefer adding service or adapter functions before making route handlers complex.

## OpenAI Agent

Solaris can use the OpenAI Responses API for realistic natural-language Agent answers and safe tool use. Set these environment variables before starting the server:

```powershell
$env:OPENAI_API_KEY="your-openai-api-key"
$env:OPENAI_MODEL="gpt-4.1-mini"
npm start
```

If `OPENAI_API_KEY` is not configured, Solaris falls back to the local rule-based Agent handler.

Allowed OpenAI Agent tools:

- `get_solaris_state`
- `add_appliance`
- `create_ticket`
- `schedule_cleaning`
- `suspend_cleaning`
- `send_email_report`
- `send_whatsapp_alert`

## Gmail Email Alerts

Solaris sends email through the `emailAdapter.js` Gmail SMTP adapter.

Set these environment variables before starting the server:

```powershell
$env:GMAIL_USER="your-gmail-address@gmail.com"
$env:GMAIL_APP_PASSWORD="your-google-app-password"
$env:GMAIL_FROM_NAME="Solaris"
npm start
```

`GMAIL_APP_PASSWORD` must be a Google App Password generated from the Google Account security settings. A normal Gmail password will be rejected by Gmail SMTP.

If Gmail is not configured, Solaris should generate an email preview event instead of failing the user flow.

Never commit real Gmail passwords or app passwords.

## WhatsApp Alerts

Solaris sends WhatsApp alerts through `whatsappAdapter.js`.

For fast developer demos, use CallMeBot as the default WhatsApp provider:

```powershell
$env:WHATSAPP_PROVIDER="callmebot"
$env:CALLMEBOT_PHONE="919960587532"
$env:CALLMEBOT_APIKEY="your-callmebot-api-key"
npm start
```

CallMeBot setup:

1. Add `+34 644 10 55 84` to the phone contacts.
2. Send `I allow callmebot to send me messages` to that contact from WhatsApp.
3. Wait for CallMeBot to reply with the API key.
4. Set `CALLMEBOT_APIKEY` to that key.

`CALLMEBOT_PHONE` should match the WhatsApp phone used to activate the API key. If it is not set, Solaris sends to the registered customer phone.

If CallMeBot activation is delayed, use Twilio WhatsApp Sandbox for immediate developer testing:

```powershell
$env:WHATSAPP_PROVIDER="twilio"
$env:TWILIO_ACCOUNT_SID="your-twilio-account-sid"
$env:TWILIO_AUTH_TOKEN="your-twilio-auth-token"
$env:TWILIO_WHATSAPP_FROM="whatsapp:+14155238886"
$env:TWILIO_WHATSAPP_TO="919960587532"
$env:TWILIO_TICKET_APPROVAL_CONTENT_SID="HX184176c08a28304b008fdc2559d7d60a"
npm start
```

The user phone must join the Twilio sandbox first by sending the Twilio-provided `join <code>` message from WhatsApp to the sandbox number shown in Twilio Console. The default sandbox sender is `whatsapp:+14155238886`.

Underproduction ticket approval uses the Twilio Content Template in `TWILIO_TICKET_APPROVAL_CONTENT_SID`. Solaris sends these variables:

- `{{1}}` customer ID
- `{{2}}` ticket ID
- `{{3}}` subject
- `{{4}}` severity
- `{{5}}` description
- `{{6}}` approval code

The template should include Approve and Reject quick-reply buttons. Inbound button text of `Approve` or `Reject` is accepted from the registered WhatsApp phone. Text fallback replies also work with `APPROVE TICKET <code>` and `REJECT TICKET <code>`.

Configure the Twilio WhatsApp Sandbox inbound webhook:

```text
POST https://your-public-url/api/whatsapp/inbound
```

For local testing, expose `http://localhost:8787` through an HTTPS tunnel such as ngrok, then use:

```text
https://your-ngrok-domain/api/whatsapp/inbound
```

If WhatsApp is not configured, Solaris should generate a WhatsApp preview event instead of failing the user flow.

Meta Cloud API is still available as an optional legacy provider by setting `WHATSAPP_PROVIDER="meta"` plus the Meta token and phone number ID variables.

Never commit real CallMeBot API keys, Twilio auth tokens, or Meta access tokens.

## Build Priorities

1. Add persistent storage.
2. Add integration adapter files for inverter, smart plugs, weather, WhatsApp/email, ticket system, and cleaner controller.
3. Add background jobs for monitoring, recommendations, ticket follow-up, and cleaner schedule checks.
4. Add setup flow for user site, system size, location, tariff, appliances, and notification opt-ins.
5. Replace mocked state with real provider adapters.

## Safety Rules

- Do not start cleaner hardware without explicit user command or enabled auto-cleaning mode.
- Do not create service tickets automatically unless auto-ticket is enabled.
- Do not send WhatsApp/email messages unless the user opted in.
- Keep an event log for cleaner commands, ticket actions, and notification decisions.
- Explain recommendations using simple language and visible evidence.

## UI Principles

- Solaris is an operational energy dashboard, not a marketing site.
- Prioritize dense, clear, scan-friendly information.
- Use graphs, trackers, status pills, and concise suggestions.
- Keep action buttons obvious for cleaner control, ticket creation, and notification preferences.
