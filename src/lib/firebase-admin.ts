import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export function getCustomerAdminAuth() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin is not configured.");
  }

  const app = getApps().length
    ? getApps()[0]
    : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return getAuth(app);
}
