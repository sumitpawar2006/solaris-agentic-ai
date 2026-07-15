const fs = require("node:fs");
const path = require("node:path");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
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
  isFirebaseConfigured,
  loadSolarisFirebaseData,
  saveSolarisUser,
  saveSolarisUserState,
};
