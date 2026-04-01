import { initializeApp } from 'firebase/app';
import { initializeAuth, browserLocalPersistence, browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, Timestamp, getDocFromServer, serverTimestamp, arrayUnion, deleteField } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
  popupRedirectResolver: browserPopupRedirectResolver,
});
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

export { signInWithPopup, signOut, onAuthStateChanged, collection, doc, setDoc, getDoc, getDocs, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, Timestamp, getDocFromServer, serverTimestamp, arrayUnion, deleteField };
export type { User };

// Test connection
async function testConnection() {
  try {
    // Attempt to fetch a non-existent doc to test connectivity
    await getDocFromServer(doc(db, '_connection_test_', 'test'));
    console.log("Firebase Firestore connected successfully.");
  } catch (error: any) {
    console.error("Firestore connection test failed:", error);
    if (error.message?.includes('the client is offline')) {
      console.error("Erro: O cliente Firestore não conseguiu conectar ao servidor. Verifique se o banco de dados Firestore foi criado no Console do Firebase e se as regras de segurança permitem o acesso.");
    } else if (error.code === 'permission-denied') {
      console.warn("Firestore conectado, mas o teste de leitura foi negado (esperado se não houver documento de teste).");
    }
  }
}
testConnection();
