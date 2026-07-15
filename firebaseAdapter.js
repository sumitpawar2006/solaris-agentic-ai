const fs = require("node:fs");
const path = require("node:path");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

let db = null;
let localEnvLoaded = false;

function isFirebaseConfigured() {
  loadLocalEnv();
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY),
  );
}

function getFirebaseDb() {
  if (!isFirebaseConfigured()) return null;
  if (db) return db;

  const credential = cert(getFirebaseCredential());

  if (!getApps().length) {
    initializeApp({ credential });
  }
  db = getFirestore();
  return db;
}

function getFirebaseAuth() {
  if (!isFirebaseConfigured()) return null;
  getFirebaseDb();
  return getAuth();
}

function getFirebaseWebConfig() {
  loadLocalEnv();
  const credential = getFirebaseCredential();
  const projectId = process.env.FIREBASE_WEB_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || credential.project_id || credential.projectId;
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey || !projectId) return null;

  return {
    apiKey,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    projectId,
    appId: process.env.FIREBASE_WEB_APP_ID || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
    googleClientId: process.env.FIREBASE_GOOGLE_CLIENT_ID || "",
  };
}

async function verifyFirebaseIdToken(idToken) {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase Authentication is not configured.");
  if (!idToken) throw new Error("Firebase ID token is required.");
  return auth.verifyIdToken(idToken, true);
}

async function getFirebaseAuthReadiness() {
  try {
    const auth = getFirebaseAuth();
    if (!auth) return { ready: false };
    await auth.listUsers(1);
    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      reason: /CONFIGURATION_NOT_FOUND/i.test(String(error?.message || "")) ? "not-initialized" : "unavailable",
    };
  }
}

function loadLocalEnv() {
  if (localEnvLoaded) return;
  localEnvLoaded = true;
  for (const file of [".env.local", ".env"]) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();
      if (!key || process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

function getFirebaseCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return JSON.parse(fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8"));
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  return {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  };
}

async function loadSolarisFirebaseData() {
  const firestore = getFirebaseDb();
  if (!firestore) return { configured: false, users: [], states: [] };

  const [usersSnapshot, statesSnapshot] = await Promise.all([
    firestore.collection("solarisUsers").get(),
    firestore.collection("solarisUserStates").get(),
  ]);

  return {
    configured: true,
    users: usersSnapshot.docs.map((doc) => doc.data()),
    states: statesSnapshot.docs.map((doc) => ({ userId: doc.id, state: doc.data() })),
  };
}

async function saveSolarisUser(user) {
  const firestore = getFirebaseDb();
  if (!firestore || !user?.id) return { configured: false };
  await firestore.collection("solarisUsers").doc(user.id).set({ ...user, updatedAt: new Date().toISOString() }, { merge: true });
  return { configured: true };
}

async function saveSolarisUserState(userId, state) {
  const firestore = getFirebaseDb();
  if (!firestore || !userId || !state) return { configured: false };
  await firestore.collection("solarisUserStates").doc(userId).set({ ...state, updatedAt: new Date().toISOString() });
  return { configured: true };
}

module.exports = {
  getFirebaseAuthReadiness,
  getFirebaseWebConfig,
  isFirebaseConfigured,
  loadSolarisFirebaseData,
  saveSolarisUser,
  saveSolarisUserState,
  verifyFirebaseIdToken,
};
