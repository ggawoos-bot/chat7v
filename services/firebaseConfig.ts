// Firebase configuration and initialization
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDyx_GGIDteLNZKspL0RqLdNfMA-uLXwq0",
  authDomain: "chat7-88761.firebaseapp.com",
  projectId: "chat7-88761",
  storageBucket: "chat7-88761.firebasestorage.app",
  messagingSenderId: "1090093126813",
  appId: "1:1090093126813:web:3f8872dfe3c4f13c92f074"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
export const db = getFirestore(app);

// Initialize Analytics (optional)
export const analytics = getAnalytics(app);

export default app;
