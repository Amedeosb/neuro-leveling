/* ============================================
   NEURO-LEVELING — Firebase Configuration
   
   ISTRUZIONI:
   1. Vai su https://console.firebase.google.com
   2. Crea un nuovo progetto (nome: neuro-leveling)
   3. Aggiungi un'app Web (icona </>)
   4. Copia i valori del tuo firebaseConfig qui sotto
   5. Vai su Authentication → Sign-in method → abilita Google
   6. Vai su Firestore Database → Crea database (modalità test)
   7. In Authentication → Settings → Authorized domains, 
      aggiungi: amedeosb.github.io
   ============================================ */

const firebaseConfig = {
  apiKey: "LA_TUA_API_KEY",
  authDomain: "IL_TUO_PROGETTO.firebaseapp.com",
  projectId: "IL_TUO_PROJECT_ID",
  storageBucket: "IL_TUO_PROGETTO.appspot.com",
  messagingSenderId: "IL_TUO_SENDER_ID",
  appId: "IL_TUO_APP_ID"
};

// Inizializza Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Google Auth Provider
const googleProvider = new firebase.auth.GoogleAuthProvider();
