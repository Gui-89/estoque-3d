// ═══════════════════════════════════════════════════════════════
//  PRINT SCOUT — firebase-config.js
//
//  ✅ Auth Google: compartilhada com GLM Studio (estoque-3d)
//  ✅ Banco Firestore: separado (printscout-817ce)
//
//  Como funciona:
//    - psAuth  → aponta para o projeto GLM Studio (estoque-3d)
//               para que o login Google seja o MESMO.
//    - psDB    → aponta para o projeto Print Scout (printscout-817ce)
//               banco de dados completamente separado.
// ═══════════════════════════════════════════════════════════════

// ── CONFIG DO GLM STUDIO (usado APENAS para Auth) ─────────────
const GLM_CONFIG = {
  apiKey:            "AIzaSyDEWD_R8z5dFFEhRQ1bUUpk9CCo47a7RHA",
  authDomain:        "estoque-3d.firebaseapp.com",
  projectId:         "estoque-3d",
  storageBucket:     "estoque-3d.firebasestorage.app",
  messagingSenderId: "970757670839",
  appId:             "1:970757670839:web:cf41d4c9ad4acac96c0a32"
};

// ── CONFIG DO PRINT SCOUT (usado APENAS para Firestore/banco) ──
const PRINTSCOUT_CONFIG = {
  apiKey:            "AIzaSyCtI6aEmNbVY7-PkwJ7PjXcP3ubjVo48s4",
  authDomain:        "printscout-817ce.firebaseapp.com",
  projectId:         "printscout-817ce",
  storageBucket:     "printscout-817ce.firebasestorage.app",
  messagingSenderId: "442452292247",
  appId:             "1:442452292247:web:a302580169a61e099f2fd2"
};

// ── E-MAILS AUTORIZADOS (mesma lista dos dois sistemas) ────────
const EMAILS_PERMITIDOS = [
  "guigas83@gmail.com",
  "luciana.lukassantos@gmail.com"
];

// ── INICIALIZAÇÃO ──────────────────────────────────────────────
// App de Auth: usa o projeto GLM Studio para login compartilhado
const psAuthApp = firebase.initializeApp(GLM_CONFIG, "printscout-auth");
const psAuth    = firebase.auth(psAuthApp);

// App de Banco: usa o projeto Print Scout para dados separados
const psDbApp = firebase.initializeApp(PRINTSCOUT_CONFIG, "printscout-db");
const psDB    = firebase.firestore(psDbApp);

// Persistência offline opcional
psDB.enablePersistence().catch(err => {
  if (err.code === "failed-precondition") {
    console.warn("PrintScout: persistência indisponível (múltiplas abas)");
  }
});

console.log("✅ PrintScout Auth  →", GLM_CONFIG.projectId,         "(compartilhada com GLM Studio)");
console.log("✅ PrintScout Banco →", PRINTSCOUT_CONFIG.projectId,  "(banco exclusivo)");
