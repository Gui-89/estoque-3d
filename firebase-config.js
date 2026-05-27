// ═══════════════════════════════════════════════════
//  PRINT SCOUT — firebase-config.js
//
//  BANCO DO PRINT SCOUT (separado do GLM Studio)
//  Auth Google compartilhada com o GLM Studio
// ═══════════════════════════════════════════════════

const PRINTSCOUT_CONFIG = {
  apiKey: "AIzaSyCtI6aEmNbVY7-PkwJ7PjXcP3ubjVo48s4",
  authDomain: "printscout-817ce.firebaseapp.com",
  projectId: "printscout-817ce",
  storageBucket: "printscout-817ce.firebasestorage.app",
  messagingSenderId: "442452292247",
  appId: "1:442452292247:web:a302580169a61e099f2fd2"
};

// Lista de e-mails autorizados (MESMA do GLM Studio)
const EMAILS_PERMITIDOS = [
  "guigas83@gmail.com",
  "luciana.lukassantos@gmail.com"
];

// Inicializa app nomeado para não colidir com GLM Studio
const psApp = firebase.initializeApp(PRINTSCOUT_CONFIG, "printscout");
const psDB  = firebase.firestore(psApp);
const psAuth = firebase.auth(psApp);

psDB.enablePersistence().catch(() => {});

console.log("✅ PrintScout Firebase:", PRINTSCOUT_CONFIG.projectId);