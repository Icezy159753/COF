// ============================================================
// Firebase SDK config
// Hosting URL/site: codeframe-dp.web.app (Firebase project: codeframe-dp)
// Data/Auth/Firestore backend: codeframe-dbd8d (existing production data)
//
// Prefer Vite env vars for future staging/prod separation. Fallback values keep
// the deployed app connected to the existing backend project.
// ============================================================
const env = import.meta.env

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyDANgnILPxHk9Kw0p96e3TsujAY40S5S6M',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'codeframe-dbd8d.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'codeframe-dbd8d',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'codeframe-dbd8d.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '724384258806',
  appId: env.VITE_FIREBASE_APP_ID || '1:724384258806:web:6da3b75f21639296a02ad7',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || 'G-S5K3DV45L7',
}
