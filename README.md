# Solaris Agentic AI

Solaris is an Agentic AI solar customer operations assistant. It monitors solar generation, tracks appliance consumption, recommends solar-friendly usage, controls cleaning workflows, raises maintenance tickets, and sends customer notifications through email or WhatsApp.

## Run Locally

```powershell
npm install
npm start
```

Open:

```text
http://localhost:8787
```

Demo login:

```text
customer@solaris.local
Solaris@123
```

## Deploy

This app is a Node.js web service, so deploy it to a Node-capable host such as Render, Railway, or similar. GitHub Pages alone will not run the backend APIs.

For Render:

1. Push this repository to GitHub.
2. Create a new Render Web Service from the GitHub repo.
3. Render can use `render.yaml`.
4. Add required environment variables from `.env.example`.
5. Deploy and open the public Render URL.

Never commit real Gmail, WhatsApp, Twilio, Meta, Google, or OpenAI secrets.

## Firebase Firestore Persistence

Solaris can persist customer accounts and dashboard state in Firebase Firestore. If Firebase variables are missing, Solaris falls back to in-memory demo data.

1. Create a Firebase project.
2. Enable Firestore Database.
3. Create a Firebase service account key.
4. Add either the split variables:

```text
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@your-firebase-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nreplace-with-private-key\n-----END PRIVATE KEY-----\n"
```

Or add the full JSON as one environment variable:

```text
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"your-firebase-project-id",...}
```

Solaris writes to these Firestore collections:

```text
solarisUsers
solarisUserStates
```

Do not commit Firebase private keys.

## Bill Payment Links

Solaris can generate a real payment link for a generated bill when payment configuration is present.

Set one of these in the hosting environment:

```text
PAYMENT_URL=https://your-payment-gateway-or-payment-link.example/pay
CARD_PAYMENT_URL=https://your-card-gateway-checkout.example/pay
NETBANKING_PAYMENT_URL=https://your-netbanking-gateway.example/pay
```

Or for UPI deep links:

```text
UPI_ID=your-upi-id@bank
UPI_NAME=Solaris
```

Solaris opens the configured payment link, but it does not mark the bill paid unless a real payment confirmation integration/webhook is added.

For UPI QR, Solaris includes the invoice reference and amount in INR, for example `am=1916.00`, so apps such as PhonePe can show the payable bill amount when the QR is scanned.
