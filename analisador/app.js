// ═══════════════════════════════════════════════════════════════
//  PRINT SCOUT — app.js
//  Radar de Produtos 3D com IA (Claude API)
// ═══════════════════════════════════════════════════════════════

"use strict";

// ── ESTADO GLOBAL ──────────────────────────────────────────────
let currentUser   = null;
let allProdutos   = [];
let filteredProds = [];
let sortKey       = "data";
let selectedNiche = null;
let selectedPlat  = "Todas";
let selectedVol   = 0;
let config        = {};
let custos        = {};
let discoveryData = [];

// ── AUTH ───────────────────────────────────────────────────────
psAuth.onAuthStateChanged(user => {
  if (user) {
    if (!EMAILS_PERMITIDOS.includes(user.email)) {
      showToast("❌ E-mail não autorizado", "error");
      psAuth.signOut();
      return;
    }
    currentUser = user;
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("app-screen").classList.remove("hidden");
    document.getElementById("user-name-display").textContent = user.displayName || user.email;
    const photo = document.getElementById("user-photo-display");
    if (user.photoURL) { photo.src = user.photoURL; photo.style.display = "block"; }
    loadConfig();
    loadProdutos();
    checkApiStatus();
  } else {
    currentUser = null;
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("app-screen").classList.add("hidden");
  }
});

function loginGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  psAuth.signInWithPopup(provider).catch(err => {
    showToast("Erro ao entrar: " + err.message, "error");
  });
}

function logoutUser() {
  psAuth.signOut();
}

// ── TABS ───────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".nav-item, .bnav-item").forEach(b => b.classList.remove("active"));
  document.getElementById("tab-" + tab).classList.add("active");
  document.querySelectorAll(`[data-tab="${tab}"]`).forEach(b => b.classList.add("active"));
  if (tab === "produtos") renderProdutos();
  if (tab === "dashboard") renderDashboard();
  closeSidebar();
}

// ── SIDEBAR MOBILE ─────────────────────────────────────────────
document.getElementById("menu-btn").addEventListener("click", () => {
  document.getElementById("sidebar").classList.toggle("open");
});
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
}

// ── CONFIG ─────────────────────────────────────────────────────
function loadConfig() {
  if (!currentUser) return;
  psDB.collection("users").doc(currentUser.uid).collection("config").doc("settings")
    .get().then(doc => {
      if (doc.exists) {
        const d = doc.data();
        config = d.filtros || {};
        custos = d.custos || {};
        preencherConfig();
      }
    });
}

function preencherConfig() {
  if (config.minVendas !== undefined) document.getElementById("cfg-min-vendas").value = config.minVendas;
  if (config.minScore  !== undefined) document.getElementById("cfg-min-score").value  = config.minScore;
  if (custos.filamento !== undefined) document.getElementById("cfg-filamento").value  = custos.filamento;
  if (custos.energia   !== undefined) document.getElementById("cfg-energia").value    = custos.energia;
  if (custos.maoObra   !== undefined) document.getElementById("cfg-mao-obra").value   = custos.maoObra;
  if (custos.margemMin !== undefined) document.getElementById("cfg-margem-min").value = custos.margemMin;
  // Carregar key salva
  const savedKey = localStorage.getItem("ps_api_key");
  if (savedKey) document.getElementById("cfg-api-key").value = savedKey;
}

function salvarConfig() {
  config.minVendas = parseFloat(document.getElementById("cfg-min-vendas").value) || 0;
  config.minScore  = parseFloat(document.getElementById("cfg-min-score").value)  || 0;
  saveConfigToFirestore();
  showToast("✅ Filtros salvos", "success");
}

function salvarCustos() {
  custos.filamento = parseFloat(document.getElementById("cfg-filamento").value) || 80;
  custos.energia   = parseFloat(document.getElementById("cfg-energia").value)   || 1.5;
  custos.maoObra   = parseFloat(document.getElementById("cfg-mao-obra").value)  || 25;
  custos.margemMin = parseFloat(document.getElementById("cfg-margem-min").value)|| 40;
  saveConfigToFirestore();
  showToast("✅ Custos salvos", "success");
}

function salvarApiKey() {
  const key = document.getElementById("cfg-api-key").value.trim();
  if (!key) { showToast("Cole a chave antes de salvar", "error"); return; }
  localStorage.setItem("ps_api_key", key);
  const el = document.getElementById("cfg-key-status");
  el.textContent = "✅ Chave salva localmente (não enviada ao servidor)";
  el.className = "cfg-status ok";
  el.classList.remove("hidden");
  showToast("✅ Chave API salva", "success");
  checkApiStatus();
}

function saveConfigToFirestore() {
  if (!currentUser) return;
  psDB.collection("users").doc(currentUser.uid).collection("config").doc("settings")
    .set({ filtros: config, custos: custos }, { merge: true });
}

// ── API STATUS ─────────────────────────────────────────────────
function checkApiStatus() {
  const dot   = document.getElementById("status-dot");
  const label = document.getElementById("status-label");
  const key   = localStorage.getItem("ps_api_key");
  dot.className = "status-dot checking";
  label.textContent = "Verificando...";
  if (!key) {
    dot.className = "status-dot offline";
    label.textContent = "Sem chave API";
    return;
  }
  dot.className = "status-dot online";
  label.textContent = "API conectada";
}

function testarChaveGemini() {
  const key = localStorage.getItem("ps_api_key");
  if (!key) { showToast("Salve a chave primeiro", "error"); return; }
  showToast("🔍 Testando chave...");
  callGemini("Responda apenas: OK", key)
    .then(r => {
      const el = document.getElementById("cfg-key-status");
      el.textContent = "✅ Chave válida! Resposta: " + r.substring(0, 60);
      el.className = "cfg-status ok";
      el.classList.remove("hidden");
      checkApiStatus();
    })
    .catch(e => {
      const el = document.getElementById("cfg-key-status");
      el.textContent = "❌ Erro: " + e.message;
      el.className = "cfg-status err";
      el.classList.remove("hidden");
    });
}

function limparCacheModelos() {
  localStorage.removeItem("ps_model_cache");
  showToast("🗑 Cache limpo", "success");
}

// ── GEMINI API ─────────────────────────────────────────────────
async function callGemini(prompt, apiKey) {
  const key = apiKey || localStorage.getItem("ps_api_key");
  if (!key) throw new Error("Chave de API Gemini não configurada. Vá em Configurações.");

  const models = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-pro"
  ];

  let lastErr;
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
          })
        }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Erro " + res.status);
      }
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (e) {
      lastErr = e;
      // Se for erro de modelo não encontrado, tenta o próximo
      if (e.message.includes("404") || e.message.includes("not found")) continue;
      throw e;
    }
  }
  throw lastErr || new Error("Nenhum modelo Gemini disponível");
}

// ── BUSCAR NICHO ───────────────────────────────────────────────
document.getElementById("niche-grid").addEventListener("click", e => {
  const card = e.target.closest(".niche-card");
  if (!card) return;
  document.querySelectorAll(".niche-card").forEach(c => c.classList.remove("selected"));
  card.classList.add("selected");
  selectedNiche = card.dataset.niche;
});

document.getElementById("plat-chips").addEventListener("click", e => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  document.querySelectorAll("#plat-chips .chip").forEach(c => c.classList.remove("active"));
  chip.classList.add("active");
  selectedPlat = chip.dataset.plat;
});

document.getElementById("vol-chips").addEventListener("click", e => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  document.querySelectorAll("#vol-chips .chip").forEach(c => c.classList.remove("active"));
  chip.classList.add("active");
  selectedVol = parseInt(chip.dataset.vol) || 0;
});

async function buscarNicho() {
  if (!selectedNiche) {
    showToast("Selecione um nicho primeiro", "error");
    document.getElementById("niche-grid").style.animation = "shake .4s ease";
    setTimeout(() => document.getElementById("niche-grid").style.animation = "", 500);
    return;
  }

  const foco   = document.getElementById("s-foco").value.trim();
  const btnTxt = document.getElementById("search-btn-text");
  const loader = document.getElementById("search-loader");
  const btn    = document.getElementById("btn-search");

  btnTxt.classList.add("hidden");
  loader.classList.remove("hidden");
  btn.disabled = true;

  const platFilter = selectedPlat !== "Todas" ? `Foco na plataforma ${selectedPlat}.` : "Considere Shopee, TikTok Shop e Mercado Livre.";
  const volFilter  = selectedVol > 0 ? `Apenas produtos com estimativa de ${selectedVol}+ vendas/dia.` : "";
  const focoExtra  = foco ? `Foco específico dentro do nicho: "${foco}".` : "";

  const prompt = `Você é um especialista em e-commerce brasileiro e impressão 3D FDM.
Analise o nicho "${selectedNiche}" e retorne os 8 produtos mais vendidos/tendência no mercado brasileiro de e-commerce em 2024-2025 que TAMBÉM têm alto potencial para impressão 3D.
${platFilter} ${volFilter} ${focoExtra}

Para cada produto, avalie a viabilidade para produção em impressão 3D FDM doméstica/semi-industrial.

Retorne APENAS um JSON válido, sem markdown, sem texto extra, neste formato exato:
{
  "nicho": "${selectedNiche}",
  "produtos": [
    {
      "rank": 1,
      "nome": "Nome do produto",
      "descricao": "Descrição curta de 1 linha",
      "plataforma": "Shopee|TikTok Shop|Mercado Livre|Todas",
      "vendas_dia_est": 850,
      "preco_medio": 35.90,
      "margem_est": 62,
      "score_mercado": 8.5,
      "score_printabilidade": 9.0,
      "score_concorrencia": 7.0,
      "veredicto": "PRODUZIR|AVALIAR|EVITAR",
      "motivo_veredicto": "Frase curta explicando o veredicto",
      "tempo_impressao_h": 2.5,
      "filamento_g": 45,
      "material": "PLA|PETG|ABS|TPU",
      "keywords": ["keyword1", "keyword2", "keyword3", "keyword4"],
      "pros": ["Pro 1", "Pro 2", "Pro 3"],
      "contras": ["Contra 1", "Contra 2"]
    }
  ]
}

Seja realista com as estimativas. O score_printabilidade avalia quão fácil é imprimir em 3D com boa qualidade vendável.
Veredicto: PRODUZIR (score geral ≥7.5), AVALIAR (5-7.4), EVITAR (<5).`;

  try {
    const raw  = await callGemini(prompt);
    const json = extractJSON(raw);
    discoveryData = json.produtos || [];

    renderDiscovery(json);
    document.getElementById("discovery-section").classList.remove("hidden");
    document.getElementById("discovery-section").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    showToast("❌ " + e.message, "error");
    console.error(e);
  } finally {
    btnTxt.classList.remove("hidden");
    loader.classList.add("hidden");
    btn.disabled = false;
  }
}

function extractJSON(text) {
  // Tenta extrair JSON de dentro de blocos markdown ou texto puro
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("IA não retornou JSON válido. Tente novamente.");
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new Error("JSON inválido da IA. Tente novamente.");
  }
}

function renderDiscovery(data) {
  const grid  = document.getElementById("discovery-grid");
  const title = document.getElementById("discovery-title");
  title.textContent = `${data.produtos.length} produtos encontrados em "${data.nicho}"`;

  grid.innerHTML = data.produtos.map((p, i) => {
    const scoreColor = s => s >= 8 ? "var(--green)" : s >= 6 ? "var(--yellow)" : "var(--red)";
    return `
    <div class="discovery-card ${p.veredicto}" onclick="abrirAnalise(${i})">
      <div class="dc-header">
        <span class="dc-rank">#${p.rank || i+1}</span>
        <span class="verdict-badge ${p.veredicto}">${verdictEmoji(p.veredicto)} ${p.veredicto}</span>
      </div>
      <div class="dc-nome">${p.nome}</div>
      <div class="dc-desc">${p.descricao}</div>
      <div class="dc-scores">
        <div class="dc-score-item">
          <div class="dc-score-val" style="color:${scoreColor(p.score_mercado)}">${p.score_mercado.toFixed(1)}</div>
          <div class="dc-score-lbl">Mercado</div>
        </div>
        <div class="dc-score-item">
          <div class="dc-score-val" style="color:${scoreColor(p.score_printabilidade)}">${p.score_printabilidade.toFixed(1)}</div>
          <div class="dc-score-lbl">Printab.</div>
        </div>
        <div class="dc-score-item">
          <div class="dc-score-val" style="color:${scoreColor(p.score_concorrencia)}">${p.score_concorrencia.toFixed(1)}</div>
          <div class="dc-score-lbl">Concorr.</div>
        </div>
      </div>
      <div class="dc-stats">
        <span class="dc-stat">📦 ~${fmtNum(p.vendas_dia_est)}/dia</span>
        <span class="dc-stat">💰 R$ ${fmtMoney(p.preco_medio)}</span>
        <span class="dc-stat">📊 ${p.margem_est}% margem</span>
        <span class="dc-stat">⏱ ${p.tempo_impressao_h}h</span>
        <span class="dc-stat">🧵 ${p.filamento_g}g ${p.material}</span>
      </div>
      <div class="dc-motivo">${p.motivo_veredicto}</div>
      <button class="dc-btn-analise" onclick="event.stopPropagation(); abrirAnalise(${i})">
        🔬 Análise Profunda + Salvar
      </button>
    </div>`;
  }).join("");
}

// ── ANÁLISE PROFUNDA ───────────────────────────────────────────
async function abrirAnalise(idx) {
  const prod = discoveryData[idx];
  if (!prod) return;

  document.getElementById("analise-modal").classList.remove("hidden");
  document.getElementById("analise-loading").classList.remove("hidden");
  document.getElementById("analise-resultado").classList.add("hidden");

  const c = {
    filamento: custos.filamento || 80,
    energia:   custos.energia   || 1.5,
    maoObra:   custos.maoObra   || 25,
    margemMin: custos.margemMin || 40
  };

  const custoProd = calcularCusto(prod, c);

  const prompt = `Você é um especialista em impressão 3D FDM para e-commerce brasileiro.
Faça uma análise PROFUNDA e DETALHADA do produto: "${prod.nome}" no nicho "${selectedNiche}".

Dados já disponíveis:
- Estimativa de vendas/dia: ${prod.vendas_dia_est}
- Preço médio de venda: R$ ${prod.preco_medio}
- Material: ${prod.material}, Tempo: ${prod.tempo_impressao_h}h, Filamento: ${prod.filamento_g}g
- Custo estimado de produção: R$ ${custoProd.total.toFixed(2)}
- Margem estimada: ${custoProd.margem.toFixed(1)}%
- Plataforma principal: ${prod.plataforma}

Retorne APENAS um JSON válido sem markdown:
{
  "analise_mercado": "Parágrafo detalhado sobre demanda, tendências, sazonalidade e oportunidade de mercado",
  "analise_producao": "Parágrafo sobre complexidade de impressão, configurações recomendadas, acabamento necessário",
  "estrategia_venda": "Parágrafo sobre como posicionar, precificar e diferenciar o produto",
  "riscos": "Parágrafo sobre principais riscos e como mitigá-los",
  "keywords_seo": ["kw1","kw2","kw3","kw4","kw5","kw6","kw7","kw8"],
  "configuracoes_impressao": {
    "infill": "20%",
    "layer_height": "0.2mm",
    "suporte": "Não|Sim",
    "temperatura": "200°C",
    "velocidade": "60mm/s",
    "acabamento": "Lixamento leve|Pintura|Nenhum"
  },
  "score_final": 8.2,
  "recomendacao_final": "Frase de 1 linha com a recomendação final objetiva"
}`;

  try {
    const raw  = await callGemini(prompt);
    const json = extractJSON(raw);
    renderAnalise(prod, json, custoProd);
  } catch (e) {
    document.getElementById("analise-loading").innerHTML =
      `<p style="color:var(--red)">❌ ${e.message}</p><button class="btn-ghost" style="margin-top:12px" onclick="fecharModal('analise-modal')">Fechar</button>`;
  }
}

function calcularCusto(prod, c) {
  const kgUsado    = (prod.filamento_g || 50) / 1000;
  const custoFil   = kgUsado * (c.filamento || 80);
  const custoEn    = (prod.tempo_impressao_h || 2) * (c.energia || 1.5);
  const custoMO    = (prod.tempo_impressao_h || 2) * ((c.maoObra || 25) / 60) * 15; // ~15min MO por hora de impressão
  const total      = custoFil + custoEn + custoMO + 2; // +R$2 overhead
  const preco      = prod.preco_medio || 30;
  const margem     = ((preco - total) / preco) * 100;
  return { filamento: custoFil, energia: custoEn, maoObra: custoMO, total, preco, margem };
}

function renderAnalise(prod, json, custo) {
  const loading   = document.getElementById("analise-loading");
  const resultado = document.getElementById("analise-resultado");

  const scoreGeral = json.score_final || ((prod.score_mercado + prod.score_printabilidade) / 2);
  const cfg        = json.configuracoes_impressao || {};

  resultado.innerHTML = `
    <div class="analise-result-header">
      <div>
        <div class="analise-nome">${prod.nome}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:4px">${prod.descricao}</div>
      </div>
      <span class="verdict-badge ${prod.veredicto}">${verdictEmoji(prod.veredicto)} ${prod.veredicto}</span>
    </div>

    <!-- Scores circulares -->
    <div class="scores-row">
      ${scoreCircle(scoreGeral, "Score Geral", "#22d3a5")}
      ${scoreCircle(prod.score_mercado, "Mercado", "#38bdf8")}
      ${scoreCircle(prod.score_printabilidade, "Printab.", "#a78bfa")}
      ${scoreCircle(prod.score_concorrencia, "Concorrência", "#f59e0b")}
    </div>

    <!-- Info grid financeiro -->
    <div class="info-grid">
      <div class="info-card info-highlight">
        <div class="info-icon">💰</div>
        <div class="info-label">Preço Venda</div>
        <div class="info-value">R$ ${fmtMoney(custo.preco)}</div>
      </div>
      <div class="info-card">
        <div class="info-icon">🏭</div>
        <div class="info-label">Custo Prod.</div>
        <div class="info-value">R$ ${custo.total.toFixed(2)}</div>
        <div class="info-sub">fil+energia+MO</div>
      </div>
      <div class="info-card info-highlight">
        <div class="info-icon">📊</div>
        <div class="info-label">Margem Real</div>
        <div class="info-value" style="color:${custo.margem >= 50 ? 'var(--green)' : custo.margem >= 30 ? 'var(--yellow)' : 'var(--red)'}">${custo.margem.toFixed(1)}%</div>
      </div>
      <div class="info-card">
        <div class="info-icon">📦</div>
        <div class="info-label">Vendas/dia</div>
        <div class="info-value">~${fmtNum(prod.vendas_dia_est)}</div>
        <div class="info-sub">estimativa IA</div>
      </div>
    </div>

    <!-- Configuração de impressão -->
    <div class="print-config-box">
      <div class="print-config-title">⚙️ Configurações de Impressão Recomendadas</div>
      <div class="print-config-grid">
        ${Object.entries(cfg).map(([k,v]) => `<div class="cfg-chip"><strong>${k.replace(/_/g," ")}:</strong> ${v}</div>`).join("")}
        <div class="cfg-chip"><strong>Material:</strong> ${prod.material}</div>
        <div class="cfg-chip"><strong>Tempo:</strong> ${prod.tempo_impressao_h}h</div>
        <div class="cfg-chip"><strong>Filamento:</strong> ${prod.filamento_g}g</div>
      </div>
    </div>

    <!-- Análise de mercado -->
    <div class="analise-box">
      <div class="analise-title">📈 Análise de Mercado</div>
      <p>${json.analise_mercado || "Análise não disponível."}</p>
    </div>

    <!-- Análise de produção -->
    <div class="analise-box">
      <div class="analise-title">🖨️ Análise de Produção</div>
      <p>${json.analise_producao || "Análise não disponível."}</p>
    </div>

    <!-- Pros / Contras -->
    <div class="pros-cons-row">
      <div class="pros-box">
        <div class="pros-title">Pontos Fortes</div>
        <ul>${(prod.pros || []).map(p => `<li>${p}</li>`).join("")}</ul>
      </div>
      <div class="cons-box">
        <div class="cons-title">Pontos de Atenção</div>
        <ul>${(prod.contras || []).map(c => `<li>${c}</li>`).join("")}</ul>
      </div>
    </div>

    <!-- Estratégia -->
    <div class="analise-box">
      <div class="analise-title">🚀 Estratégia de Venda</div>
      <p>${json.estrategia_venda || "Análise não disponível."}</p>
    </div>

    <!-- Riscos -->
    <div class="analise-box">
      <div class="analise-title">⚠️ Riscos e Mitigação</div>
      <p>${json.riscos || "Análise não disponível."}</p>
    </div>

    <!-- Keywords -->
    <div class="keywords-box">
      <div class="keywords-title">🔍 Keywords SEO para Anúncios</div>
      <div class="keywords-list">
        ${(json.keywords_seo || prod.keywords || []).map(k => `<span class="kw-tag">${k}</span>`).join("")}
      </div>
    </div>

    <!-- Recomendação final -->
    <div class="analise-box" style="border:1px solid var(--accent);background:rgba(34,211,165,.05)">
      <div class="analise-title" style="color:var(--accent)">✅ Recomendação Final</div>
      <p style="font-weight:600;color:var(--text)">${json.recomendacao_final || prod.motivo_veredicto}</p>
    </div>

    <!-- Ações -->
    <div class="result-actions">
      <button class="btn-primary" onclick="salvarProduto(${JSON.stringify(JSON.stringify({prod, json, custo}))})">
        💾 Salvar no Banco
      </button>
      <button class="btn-ghost" onclick="fecharModal('analise-modal')">Fechar</button>
    </div>
  `;

  loading.classList.add("hidden");
  resultado.classList.remove("hidden");
}

function scoreCircle(val, label, color) {
  const r    = 34;
  const circ = 2 * Math.PI * r;
  const pct  = Math.max(0, Math.min(10, val)) / 10;
  const dash = circ * pct;
  return `
  <div style="text-align:center">
    <div class="score-circle-wrap">
      <svg class="score-circle" viewBox="0 0 80 80">
        <circle class="track" cx="40" cy="40" r="${r}"/>
        <circle class="fill" cx="40" cy="40" r="${r}" stroke="${color}"
          stroke-dasharray="${dash} ${circ}" />
      </svg>
      <div class="score-inner">
        <div class="score-num">${val.toFixed(1)}</div>
        <div class="score-lbl">${label}</div>
      </div>
    </div>
  </div>`;
}

// ── SALVAR PRODUTO ─────────────────────────────────────────────
function salvarProduto(jsonStr) {
  if (!currentUser) return;
  let data;
  try { data = JSON.parse(jsonStr); } catch { showToast("Erro ao salvar", "error"); return; }

  const { prod, json, custo } = data;
  const doc = {
    nome:           prod.nome,
    descricao:      prod.descricao,
    nicho:          selectedNiche || "",
    plataforma:     prod.plataforma,
    vendas_dia:     prod.vendas_dia_est,
    preco_medio:    prod.preco_medio,
    margem:         custo.margem,
    custo_total:    custo.total,
    score_mercado:  prod.score_mercado,
    score_print:    prod.score_printabilidade,
    score_conc:     prod.score_concorrencia,
    score_geral:    json.score_final || ((prod.score_mercado + prod.score_printabilidade)/2),
    veredicto:      prod.veredicto,
    material:       prod.material,
    filamento_g:    prod.filamento_g,
    tempo_h:        prod.tempo_impressao_h,
    keywords:       json.keywords_seo || prod.keywords || [],
    pros:           prod.pros || [],
    contras:        prod.contras || [],
    analise_mercado:  json.analise_mercado || "",
    analise_producao: json.analise_producao || "",
    estrategia:       json.estrategia_venda || "",
    riscos:           json.riscos || "",
    cfg_impressao:    json.configuracoes_impressao || {},
    recomendacao:     json.recomendacao_final || "",
    motivo_veredicto: prod.motivo_veredicto || "",
    salvo_em:         firebase.firestore.FieldValue.serverTimestamp(),
    uid:              currentUser.uid
  };

  psDB.collection("users").doc(currentUser.uid).collection("produtos").add(doc)
    .then(() => {
      showToast("✅ Produto salvo com sucesso!", "success");
      fecharModal("analise-modal");
      loadProdutos();
    })
    .catch(e => showToast("❌ " + e.message, "error"));
}

// ── CARREGAR PRODUTOS ──────────────────────────────────────────
function loadProdutos() {
  if (!currentUser) return;
  psDB.collection("users").doc(currentUser.uid).collection("produtos")
    .orderBy("salvo_em", "desc")
    .get()
    .then(snap => {
      allProdutos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      filteredProds = [...allProdutos];
      renderProdutos();
      renderDashboard();
    })
    .catch(e => console.error("loadProdutos:", e));
}

// ── RENDER PRODUTOS ────────────────────────────────────────────
function renderProdutos() {
  aplicarFiltros();
}

function aplicarFiltros() {
  const veredicto = document.getElementById("filter-veredicto").value;
  const plat      = document.getElementById("filter-plataforma").value;
  const minVendas = parseFloat(document.getElementById("filter-vendas").value) || 0;
  const minScore  = parseFloat(document.getElementById("filter-score").value)  || 0;
  const busca     = document.getElementById("filter-busca").value.toLowerCase();

  filteredProds = allProdutos.filter(p => {
    if (veredicto && p.veredicto !== veredicto) return false;
    if (plat && plat !== "Todas" && p.plataforma !== plat && p.plataforma !== "Todas") return false;
    if (p.vendas_dia < minVendas) return false;
    if ((p.score_geral || 0) < minScore) return false;
    if (busca && !p.nome.toLowerCase().includes(busca)) return false;
    return true;
  });

  sortProdutosArr();
  const grid = document.getElementById("produtos-grid");
  const count = document.getElementById("filter-count");
  count.textContent = `${filteredProds.length} de ${allProdutos.length} produtos`;

  if (!filteredProds.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">◎</div><p>Nenhum produto encontrado.</p><button class="btn-ghost" onclick="limparFiltros()">Limpar filtros</button></div>`;
    return;
  }
  grid.innerHTML = filteredProds.map(p => cardProduto(p)).join("");
}

function sortProdutos(key) {
  sortKey = key;
  document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
  document.querySelector(`.sort-btn[data-sort="${key}"]`)?.classList.add("active");
  sortProdutosArr();
  const grid = document.getElementById("produtos-grid");
  grid.innerHTML = filteredProds.map(p => cardProduto(p)).join("");
}

function sortProdutosArr() {
  filteredProds.sort((a, b) => {
    if (sortKey === "score")  return (b.score_geral || 0) - (a.score_geral || 0);
    if (sortKey === "vendas") return (b.vendas_dia  || 0) - (a.vendas_dia  || 0);
    if (sortKey === "margem") return (b.margem      || 0) - (a.margem      || 0);
    // data (default)
    const da = a.salvo_em?.toDate?.() || new Date(0);
    const db = b.salvo_em?.toDate?.() || new Date(0);
    return db - da;
  });
}

function limparFiltros() {
  document.getElementById("filter-veredicto").value = "";
  document.getElementById("filter-plataforma").value = "";
  document.getElementById("filter-vendas").value = "";
  document.getElementById("filter-score").value = "";
  document.getElementById("filter-busca").value = "";
  aplicarFiltros();
}

function cardProduto(p) {
  const date = p.salvo_em?.toDate?.()
    ? p.salvo_em.toDate().toLocaleDateString("pt-BR")
    : "—";
  return `
  <div class="produto-card ${p.veredicto || "pendente"}" onclick="abrirDetalhe('${p.id}')">
    <div class="pc-header">
      <div class="pc-nome">${p.nome}</div>
      <span class="pc-badge ${p.veredicto || "pendente"}">${verdictEmoji(p.veredicto)} ${p.veredicto || "Pendente"}</span>
    </div>
    <div class="pc-nicho-tag">${p.nicho || "—"}</div>
    <div class="pc-stats">
      <div class="pc-stat">
        <div class="pc-stat-val">${(p.score_geral||0).toFixed(1)}</div>
        <div class="pc-stat-lbl">Score IA</div>
      </div>
      <div class="pc-stat">
        <div class="pc-stat-val">~${fmtNum(p.vendas_dia || 0)}</div>
        <div class="pc-stat-lbl">Vendas/dia</div>
      </div>
      <div class="pc-stat">
        <div class="pc-stat-val" style="color:${(p.margem||0)>=50?'var(--green)':(p.margem||0)>=30?'var(--yellow)':'var(--red)'}">${(p.margem||0).toFixed(0)}%</div>
        <div class="pc-stat-lbl">Margem</div>
      </div>
    </div>
    <div class="pc-footer">
      <span class="pc-plat">${p.plataforma || "—"}</span>
      <span class="pc-date">${date}</span>
      <div class="pc-actions">
        <button class="pc-btn" title="Excluir" onclick="event.stopPropagation();excluirProduto('${p.id}')">🗑</button>
      </div>
    </div>
  </div>`;
}

// ── DETALHE PRODUTO SALVO ──────────────────────────────────────
function abrirDetalhe(id) {
  const p = allProdutos.find(x => x.id === id);
  if (!p) return;

  const modal = document.getElementById("produto-modal");
  const box   = document.getElementById("modal-content");

  const date = p.salvo_em?.toDate?.()
    ? p.salvo_em.toDate().toLocaleString("pt-BR")
    : "—";

  box.innerHTML = `
    <button class="modal-close" onclick="fecharModal('produto-modal')">✕</button>
    <div class="modal-title">${p.nome}</div>
    <div class="modal-sub">${p.descricao || ""}</div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <span class="verdict-badge ${p.veredicto}">${verdictEmoji(p.veredicto)} ${p.veredicto}</span>
      <span class="pc-plat">${p.nicho}</span>
      <span class="pc-plat">${p.plataforma}</span>
      <span class="pc-plat">${p.material} · ${p.filamento_g}g · ${p.tempo_h}h</span>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">Números</div>
      <div class="modal-grid">
        <div class="modal-stat"><div class="modal-stat-val">${(p.score_geral||0).toFixed(1)}</div><div class="modal-stat-lbl">Score Geral</div></div>
        <div class="modal-stat"><div class="modal-stat-val">~${fmtNum(p.vendas_dia)}</div><div class="modal-stat-lbl">Vendas/dia est.</div></div>
        <div class="modal-stat"><div class="modal-stat-val">R$ ${fmtMoney(p.preco_medio)}</div><div class="modal-stat-lbl">Preço médio</div></div>
        <div class="modal-stat"><div class="modal-stat-val">${(p.margem||0).toFixed(1)}%</div><div class="modal-stat-lbl">Margem real</div></div>
        <div class="modal-stat"><div class="modal-stat-val">R$ ${(p.custo_total||0).toFixed(2)}</div><div class="modal-stat-lbl">Custo produção</div></div>
        <div class="modal-stat"><div class="modal-stat-val">${(p.score_print||0).toFixed(1)}</div><div class="modal-stat-lbl">Printabilidade</div></div>
      </div>
    </div>

    ${p.analise_mercado ? `
    <div class="modal-section">
      <div class="modal-section-title">Análise de Mercado</div>
      <p style="font-size:13px;color:var(--text2);line-height:1.7">${p.analise_mercado}</p>
    </div>` : ""}

    ${p.estrategia ? `
    <div class="modal-section">
      <div class="modal-section-title">Estratégia de Venda</div>
      <p style="font-size:13px;color:var(--text2);line-height:1.7">${p.estrategia}</p>
    </div>` : ""}

    ${(p.keywords||[]).length ? `
    <div class="modal-section">
      <div class="modal-section-title">Keywords SEO</div>
      <div class="keywords-list">${p.keywords.map(k=>`<span class="kw-tag">${k}</span>`).join("")}</div>
    </div>` : ""}

    ${p.recomendacao ? `
    <div class="analise-box" style="border:1px solid var(--accent);background:rgba(34,211,165,.05);margin-top:12px">
      <div class="analise-title" style="color:var(--accent)">✅ Recomendação</div>
      <p style="font-weight:600;color:var(--text)">${p.recomendacao}</p>
    </div>` : ""}

    <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap">
      <button class="btn-danger" onclick="excluirProduto('${p.id}');fecharModal('produto-modal')">🗑️ Excluir</button>
      <button class="btn-ghost" onclick="fecharModal('produto-modal')">Fechar</button>
    </div>
    <div style="font-size:11px;color:var(--text3);margin-top:12px">Salvo em: ${date}</div>
  `;
  modal.classList.remove("hidden");
}

function excluirProduto(id) {
  if (!currentUser) return;
  if (!confirm("Excluir este produto do banco?")) return;
  psDB.collection("users").doc(currentUser.uid).collection("produtos").doc(id)
    .delete()
    .then(() => {
      showToast("Produto excluído", "success");
      allProdutos = allProdutos.filter(p => p.id !== id);
      filteredProds = filteredProds.filter(p => p.id !== id);
      renderProdutos();
      renderDashboard();
    })
    .catch(e => showToast("❌ " + e.message, "error"));
}

function limparTodosDados() {
  if (!currentUser) return;
  if (!confirm("⚠️ Isso apagará TODOS os produtos do banco. Confirmar?")) return;
  const batch = psDB.batch();
  allProdutos.forEach(p => {
    batch.delete(psDB.collection("users").doc(currentUser.uid).collection("produtos").doc(p.id));
  });
  batch.commit().then(() => {
    showToast("🗑️ Todos os produtos apagados", "success");
    allProdutos = [];
    filteredProds = [];
    renderProdutos();
    renderDashboard();
  }).catch(e => showToast("❌ " + e.message, "error"));
}

// ── DASHBOARD ─────────────────────────────────────────────────
function renderDashboard() {
  const total     = allProdutos.length;
  const produzir  = allProdutos.filter(p => p.veredicto === "PRODUZIR").length;
  const avaliar   = allProdutos.filter(p => p.veredicto === "AVALIAR").length;
  const evitar    = allProdutos.filter(p => p.veredicto === "EVITAR").length;
  const avgVendas = total ? (allProdutos.reduce((s,p) => s+(p.vendas_dia||0), 0)/total).toFixed(0) : "—";
  const avgScore  = total ? (allProdutos.reduce((s,p) => s+(p.score_geral||0), 0)/total).toFixed(1) : "—";

  document.getElementById("kpi-total").textContent    = total;
  document.getElementById("kpi-produzir").textContent = produzir;
  document.getElementById("kpi-vendas").textContent   = avgVendas;
  document.getElementById("kpi-score").textContent    = avgScore;

  // Verdict bars
  const mx = Math.max(produzir, avaliar, evitar, 1);
  document.getElementById("bar-produzir").style.width = (produzir/mx*100) + "%";
  document.getElementById("bar-avaliar").style.width  = (avaliar /mx*100) + "%";
  document.getElementById("bar-evitar").style.width   = (evitar  /mx*100) + "%";
  document.getElementById("count-produzir").textContent = produzir;
  document.getElementById("count-avaliar").textContent  = avaliar;
  document.getElementById("count-evitar").textContent   = evitar;

  // Top oportunidades
  const top    = [...allProdutos].sort((a,b) => (b.score_geral||0)-(a.score_geral||0)).slice(0,5);
  const topEl  = document.getElementById("top-oportunidades");
  if (!top.length) {
    topEl.innerHTML = `<div class="empty-state"><div class="empty-icon">◎</div><p>Nenhum produto salvo ainda.</p><button class="btn-ghost" onclick="switchTab('buscar')">Buscar primeiro nicho →</button></div>`;
  } else {
    topEl.innerHTML = top.map((p, i) => `
      <div class="top-item" onclick="abrirDetalhe('${p.id}')">
        <div class="top-rank ${i===0?'r1':i===1?'r2':i===2?'r3':''}">${i+1}</div>
        <div class="top-info">
          <div class="top-nome">${p.nome}</div>
          <div class="top-meta">${p.nicho} · ${verdictEmoji(p.veredicto)} ${p.veredicto}</div>
        </div>
        <div class="top-score">${(p.score_geral||0).toFixed(1)}</div>
      </div>`).join("");
  }

  // Recentes
  const rec   = [...allProdutos].slice(0, 5);
  const recEl = document.getElementById("recentes-list");
  if (!rec.length) {
    recEl.innerHTML = `<div class="empty-mini">Nenhum produto ainda</div>`;
  } else {
    recEl.innerHTML = rec.map(p => {
      const d = p.salvo_em?.toDate?.()
        ? p.salvo_em.toDate().toLocaleDateString("pt-BR")
        : "—";
      return `<div class="recente-item" onclick="abrirDetalhe('${p.id}')">
        <span class="recente-nome">${p.nome}</span>
        <span class="recente-data">${d}</span>
      </div>`;
    }).join("");
  }
}

// ── MODAL ──────────────────────────────────────────────────────
function fecharModal(id) {
  document.getElementById(id).classList.add("hidden");
}
// Fechar clicando no overlay
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.classList.add("hidden");
  });
});

// ── HELPERS ───────────────────────────────────────────────────
function verdictEmoji(v) {
  return v === "PRODUZIR" ? "✅" : v === "AVALIAR" ? "⚠️" : v === "EVITAR" ? "❌" : "⬜";
}
function fmtNum(n) {
  if (!n) return "0";
  return n >= 1000 ? (n/1000).toFixed(1)+"k" : String(n);
}
function fmtMoney(n) {
  if (!n) return "0,00";
  return parseFloat(n).toFixed(2).replace(".", ",");
}

// ── TOAST ─────────────────────────────────────────────────────
function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className   = "toast " + type + " show";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 3200);
}
