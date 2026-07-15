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

Create a real customer account from the Sign Up screen. Internal demo login is disabled by default.

For internal testing only, enable the demo account:

```powershell
$env:ENABLE_DEMO_ACCOUNT="true"
npm start
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

Solaris can persist customer accounts and dashboard state in Firebase Firestore. If Firebase variables are missing, Solaris falls back to in-memory local data for development.

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

For local development only, you can point Solaris at the downloaded JSON file using an ignored `.env.local` file:

```text
FIREBASE_SERVICE_ACCOUNT_PATH=C:\Users\you\Downloads\firebase-service-account.json
```

Solaris writes to these Firestore collections:

```text
solarisUsers
solarisUserStates
```

Do not commit Firebase private keys.

## Firebase Authentication

Solaris uses Firebase Authentication for real customer sign-in through email/password, Google, or mobile SMS OTP.

Create a Firebase Web App and configure these values in `.env.local` or the deployment environment:

```text
FIREBASE_WEB_API_KEY=your-firebase-web-api-key
FIREBASE_WEB_PROJECT_ID=your-firebase-project-id
FIREBASE_AUTH_DOMAIN=your-firebase-project-id.firebaseapp.com
FIREBASE_WEB_APP_ID=your-firebase-web-app-id
FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
FIREBASE_STORAGE_BUCKET=your-firebase-storage-bucket
FIREBASE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
```

In Firebase Console, open **Authentication**, click **Get started**, and enable Email/Password, Google, and Phone in **Sign-in method**. Select a support email for Google. In Authentication settings, add every deployed website domain to **Authorized domains** and allow the required SMS regions.

Google sign-in uses Google Identity Services and exchanges the Google credential with Firebase, avoiding cross-domain redirect storage failures in embedded browsers. The Solaris server then verifies the Firebase ID token before issuing an HTTP-only customer session cookie. First-time Google and phone users complete their customer ID and solar installation profile once. Test real phone authentication on an authorized HTTPS deployment domain.

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
