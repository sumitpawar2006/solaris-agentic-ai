const admin = require("firebase-admin");

let db = null;

function isFirebaseConfigured() {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY));
}

function getFirebaseDb() {
  if (!isFirebaseConfigured()) return null;
  if (db) return db;

  const credential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    ? admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
    : admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      });

  if (!admin.apps.length) {
    admin.initializeApp({ credential });
  }
  db = admin.firestore();
  return db;
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
