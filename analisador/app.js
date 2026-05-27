/* ═══════════════════════════════════════════════════
   PRINT SCOUT — app.js
   Auth compartilhada com GLM Studio
   Banco Firestore próprio (printscout-817ce)
   ═══════════════════════════════════════════════════ */

// ── ESTADO GLOBAL ────────────────────────────────────
let currentUser   = null;
let produtosSalvos = [];
let currentResult = null;
let sortKey       = 'data';

// ── INIT ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Inicializa data de hoje nos campos
  setupEventListeners();

  // Escuta autenticação do app nomeado "printscout"
  psAuth.onAuthStateChanged(user => {
    if (user) {
      if (EMAILS_PERMITIDOS.includes(user.email)) {
        currentUser = user;
        showApp(user);
        iniciarEscutadores();
        verificarApiKey();
      } else {
        showToast('Acesso negado: ' + user.email, 'error');
        psAuth.signOut();
      }
    } else {
      currentUser = null;
      showLogin();
    }
  });
});

// ── AUTH ─────────────────────────────────────────────
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
}

function showApp(user) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  document.getElementById('user-name-display').textContent = user.displayName || user.email;
  document.getElementById('user-photo-display').src = user.photoURL || '';
}

window.loginGoogle = function() {
  const provider = new firebase.auth.GoogleAuthProvider();
  psAuth.signInWithPopup(provider).catch(e => showToast(e.message, 'error'));
};

window.logoutUser = function() {
  psAuth.signOut();
};

// ── API KEY ───────────────────────────────────────────
function getApiKey() {
  return localStorage.getItem('ps_api_key') || '';
}

function verificarApiKey() {
  const key = getApiKey();
  const dot  = document.getElementById('status-dot');
  const lbl  = document.getElementById('status-label');

  if (!key) {
    dot.className = 'status-dot offline';
    lbl.textContent = 'API não configurada';
    return;
  }

  dot.className = 'status-dot checking';
  lbl.textContent = 'Verificando...';

  // Testa a chave
  fetch('https://api.anthropic.com/v1/models', {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  }).then(r => {
    if (r.ok || r.status === 200) {
      dot.className = 'status-dot online';
      lbl.textContent = 'API conectada';
    } else {
      dot.className = 'status-dot offline';
      lbl.textContent = 'Chave inválida';
    }
  }).catch(() => {
    // Sem acesso ao endpoint de models pelo CORS — assumir OK se a chave existe
    dot.className = 'status-dot online';
    lbl.textContent = 'API configurada';
  });
}

window.salvarApiKey = function() {
  const key = document.getElementById('cfg-api-key').value.trim();
  if (!key) { showToast('Informe a chave de API', 'error'); return; }
  localStorage.setItem('ps_api_key', key);
  document.getElementById('cfg-api-key').value = '';
  const status = document.getElementById('cfg-key-status');
  status.textContent = '✅ Chave salva com sucesso!';
  status.className = 'cfg-status ok';
  status.classList.remove('hidden');
  verificarApiKey();
  showToast('Chave de API salva ✓');
};

window.salvarConfig = function() {
  const minVendas = document.getElementById('cfg-min-vendas').value;
  const minScore  = document.getElementById('cfg-min-score').value;
  if (minVendas) localStorage.setItem('ps_min_vendas', minVendas);
  if (minScore)  localStorage.setItem('ps_min_score', minScore);
  showToast('Configurações salvas ✓');
};

window.salvarCustos = function() {
  const campos = ['cfg-filamento','cfg-energia','cfg-mao-obra','cfg-margem-min'];
  const keys   = ['ps_custo_fil','ps_custo_energia','ps_custo_mao','ps_margem_min'];
  campos.forEach((id, i) => {
    const v = document.getElementById(id).value;
    if (v) localStorage.setItem(keys[i], v);
  });
  showToast('Custos salvos ✓');
};

// Preenche campos de config com valores salvos
function carregarConfigs() {
  const map = {
    'cfg-min-vendas': 'ps_min_vendas',
    'cfg-min-score':  'ps_min_score',
    'cfg-filamento':  'ps_custo_fil',
    'cfg-energia':    'ps_custo_energia',
    'cfg-mao-obra':   'ps_custo_mao',
    'cfg-margem-min': 'ps_margem_min'
  };
  Object.entries(map).forEach(([id, key]) => {
    const el  = document.getElementById(id);
    const val = localStorage.getItem(key);
    if (el && val) el.value = val;
  });
}

// ── TABS ──────────────────────────────────────────────
window.switchTab = function(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item, .bnav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll(`[data-tab="${tab}"]`).forEach(el => el.classList.add('active'));

  if (tab === 'config') carregarConfigs();
  if (tab === 'produtos') renderProdutos();
};

// ── ANALISAR PRODUTO ─────────────────────────────────
window.analisarProduto = async function() {
  const apiKey = getApiKey();
  if (!apiKey) {
    showToast('Configure sua chave de API Claude primeiro!', 'error');
    switchTab('config');
    return;
  }

  const nome    = document.getElementById('f-nome').value.trim();
  const plat    = document.getElementById('f-plataforma').value;
  const cat     = document.getElementById('f-categoria').value;
  const preco   = document.getElementById('f-preco').value;
  const vendas  = document.getElementById('f-vendas').value;
  const concorr = document.getElementById('f-concorrentes').value;
  const aval    = document.getElementById('f-avaliacao').value;
  const url     = document.getElementById('f-url').value;
  const desc    = document.getElementById('f-descricao').value;

  const errorEl = document.getElementById('form-error');
  if (!nome || !preco || !vendas) {
    errorEl.textContent = 'Preencha os campos obrigatórios: Nome, Preço e Vendas/dia.';
    errorEl.classList.remove('hidden');
    return;
  }
  errorEl.classList.add('hidden');

  // Custos do usuário
  const custoFil    = localStorage.getItem('ps_custo_fil')    || '80';
  const custoEnerg  = localStorage.getItem('ps_custo_energia') || '1.50';
  const custoMao    = localStorage.getItem('ps_custo_mao')    || '25';
  const margemMin   = localStorage.getItem('ps_margem_min')   || '40';

  const prompt = `Você é um especialista em impressão 3D e análise de mercado para e-commerce brasileiro.

Analise este produto para avaliar viabilidade de produção 3D e venda nas plataformas online:

PRODUTO: ${nome}
PLATAFORMA: ${plat}
CATEGORIA: ${cat}
PREÇO DE VENDA: R$ ${preco}
VENDAS ESTIMADAS/DIA: ${vendas}
CONCORRENTES: ${concorr || 'não informado'}
AVALIAÇÃO MÉDIA: ${aval || 'não informado'}
${url ? 'URL: ' + url : ''}
${desc ? 'DESCRIÇÃO: ' + desc : ''}

CUSTOS DO PRODUTOR:
- Filamento PLA: R$ ${custoFil}/kg
- Energia: R$ ${custoEnerg}/hora
- Mão de obra: R$ ${custoMao}/hora
- Margem mínima aceitável: ${margemMin}%

Responda EXCLUSIVAMENTE em JSON válido, sem texto antes ou depois, sem markdown:

{
  "printabilidade": <0-10, quão fácil é produzir em impressora 3D FDM comum>,
  "oportunidade": <0-10, potencial de mercado e lucro>,
  "saturacao": <0-10, nível de saturação do mercado — 10 = muito saturado>,
  "veredicto": <"PRODUZIR" | "AVALIAR" | "EVITAR">,
  "material_principal": <"PLA" | "PETG" | "ABS" | "TPU" | "PETG-CF" | "PLA+">,
  "material_alternativo": <material secundário ou string vazia>,
  "tempo_impressao": <"X h Ym" por unidade>,
  "custo_material_min": <número em reais, mínimo>,
  "custo_material_max": <número em reais, máximo>,
  "margem_estimada": <porcentagem como número>,
  "preco_sugerido": <número em reais>,
  "dificuldade": <"Fácil" | "Médio" | "Difícil" | "Muito Difícil">,
  "nivel_concorrencia": <"Baixa" | "Média" | "Alta" | "Altíssima">,
  "config_impressao": {
    "camada": <"0.1mm" | "0.15mm" | "0.2mm" | "0.3mm">,
    "infill": <porcentagem como string, ex: "15%">,
    "suporte": <"Não" | "Sim" | "Opcional">,
    "temperatura": <temperatura do bico em Celsius como string, ex: "210°C">,
    "velocidade": <velocidade em mm/s como string, ex: "60mm/s">
  },
  "pontos_favoraveis": [<3 a 5 strings com pontos positivos>],
  "riscos": [<3 a 5 strings com riscos e desafios>],
  "analise_resumo": <string com análise detalhada de 3-4 frases>,
  "keywords_shopee": [<6 a 8 palavras-chave relevantes para SEO>],
  "diferenciais": [<3 a 5 sugestões de como se diferenciar da concorrência>]
}`;

  setLoading(true);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Erro ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Remove possível markdown
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    // Enriquece com dados do form
    result._form = { nome, plat, cat, preco: Number(preco), vendas: Number(vendas), concorr: Number(concorr) || 0, aval: Number(aval) || 0, url, desc };

    currentResult = result;
    renderResultado(result);
    showToast('Análise concluída! ✓', 'success');

  } catch (e) {
    console.error(e);
    showToast('Erro na análise: ' + e.message, 'error');
  } finally {
    setLoading(false);
  }
};

function setLoading(loading) {
  const btn  = document.getElementById('btn-analyze');
  const txt  = document.getElementById('analyze-btn-text');
  const load = document.getElementById('analyze-loader');
  btn.disabled = loading;
  txt.classList.toggle('hidden', loading);
  load.classList.toggle('hidden', !loading);
}

// ── RENDER RESULTADO ──────────────────────────────────
function renderResultado(r) {
  // Mostra card e esconde placeholder
  document.getElementById('result-placeholder').classList.add('hidden');
  const card = document.getElementById('result-card');
  card.classList.remove('hidden');

  // Nome e veredicto
  document.getElementById('res-nome').textContent = r._form?.nome || '—';
  const badge = document.getElementById('res-veredicto-badge');
  badge.textContent = r.veredicto;
  badge.className = 'verdict-badge ' + r.veredicto;

  // Scores (círculos SVG)
  setScoreCircle('circle-print', 'res-printabilidade', r.printabilidade);
  setScoreCircle('circle-opp',   'res-oportunidade',   r.oportunidade);
  setScoreCircle('circle-sat',   'res-saturacao',      r.saturacao);

  // Info cards
  document.getElementById('res-material').textContent     = r.material_principal || '—';
  document.getElementById('res-material-alt').textContent = r.material_alternativo || 'sem alternativa';
  document.getElementById('res-tempo').textContent        = r.tempo_impressao || '—';

  const custoMin = r.custo_material_min || 0;
  const custoMax = r.custo_material_max || 0;
  document.getElementById('res-custo').textContent = `R$ ${custoMin.toFixed(2)}–${custoMax.toFixed(2)}`;

  const margem = r.margem_estimada || 0;
  document.getElementById('res-margem').textContent    = margem + '%';
  document.getElementById('res-preco-sug').textContent = `preço sugerido: R$ ${(r.preco_sugerido || 0).toFixed(2)}`;

  // Tags
  document.getElementById('res-dificuldade').textContent  = r.dificuldade || '—';
  document.getElementById('res-concorrencia').textContent = r.nivel_concorrencia || '—';

  // Config de impressão
  const cfg = r.config_impressao || {};
  const grid = document.getElementById('res-config-grid');
  grid.innerHTML = [
    ['Camada', cfg.camada],
    ['Infill', cfg.infill],
    ['Suporte', cfg.suporte],
    ['Temperatura', cfg.temperatura],
    ['Velocidade', cfg.velocidade]
  ].filter(([,v]) => v).map(([k,v]) => `<span class="cfg-chip"><strong>${k}:</strong> ${v}</span>`).join('');

  // Pros e cons
  const prosList = document.getElementById('res-pros');
  const consList = document.getElementById('res-cons');
  prosList.innerHTML = (r.pontos_favoraveis || []).map(p => `<li>${p}</li>`).join('');
  consList.innerHTML = (r.riscos || []).map(p => `<li>${p}</li>`).join('');

  // Análise
  document.getElementById('res-analise').textContent = r.analise_resumo || '—';

  // Keywords
  const kwList = document.getElementById('res-keywords');
  kwList.innerHTML = (r.keywords_shopee || []).map(k => `<span class="kw-tag">${k}</span>`).join('');

  // Diferenciais
  const difList = document.getElementById('res-diferenciais');
  difList.innerHTML = (r.diferenciais || []).map(d => `<li>${d}</li>`).join('');

  // Botão salvar
  document.getElementById('btn-save').disabled = false;
}

function setScoreCircle(circleId, numId, value) {
  const v    = Math.min(10, Math.max(0, value || 0));
  const pct  = v / 10;
  const circ = 2 * Math.PI * 34; // r=34 → circumference ≈ 213.6
  const offset = circ - (pct * circ);
  const el = document.getElementById(circleId);
  if (el) el.style.strokeDashoffset = offset.toFixed(1);
  const numEl = document.getElementById(numId);
  if (numEl) numEl.textContent = v.toFixed(1);
}

// ── SALVAR PRODUTO ────────────────────────────────────
window.salvarProduto = async function() {
  if (!currentResult || !currentUser) return;
  const r = currentResult;
  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = '⏳ Salvando...';

  try {
    const payload = {
      nome:            r._form.nome,
      plataforma:      r._form.plat,
      categoria:       r._form.cat,
      precoVenda:      r._form.preco,
      vendasDia:       r._form.vendas,
      concorrentes:    r._form.concorr,
      avaliacao:       r._form.aval,
      url:             r._form.url || '',
      descricao:       r._form.desc || '',
      // Resultado da IA
      printabilidade:  r.printabilidade,
      oportunidade:    r.oportunidade,
      saturacao:       r.saturacao,
      veredicto:       r.veredicto,
      materialPrincipal: r.material_principal,
      materialAlt:     r.material_alternativo,
      tempoImpressao:  r.tempo_impressao,
      custoMin:        r.custo_material_min,
      custoMax:        r.custo_material_max,
      margemEstimada:  r.margem_estimada,
      precoSugerido:   r.preco_sugerido,
      dificuldade:     r.dificuldade,
      nivelConcorrencia: r.nivel_concorrencia,
      configImpressao: r.config_impressao || {},
      pontosPositivos: r.pontos_favoraveis || [],
      riscos:          r.riscos || [],
      analise:         r.analise_resumo,
      keywords:        r.keywords_shopee || [],
      diferenciais:    r.diferenciais || [],
      // Meta
      scoreTotal: ((r.printabilidade + r.oportunidade + (10 - r.saturacao)) / 3).toFixed(2),
      salvoEm:    new Date().toISOString(),
      usuario:    currentUser.email
    };

    await psDB.collection('produtos').add(payload);
    showToast('Produto salvo! ✓', 'success');
    btn.textContent = '✅ Salvo!';
    currentResult = null;
  } catch (e) {
    showToast('Erro ao salvar: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '💾 Salvar no Firebase';
  }
};

window.limparFormulario = function() {
  ['f-nome','f-preco','f-vendas','f-concorrentes','f-avaliacao','f-url','f-descricao'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('form-error').classList.add('hidden');
  document.getElementById('result-placeholder').classList.remove('hidden');
  document.getElementById('result-card').classList.add('hidden');
  document.getElementById('btn-save').disabled = false;
  document.getElementById('btn-save').textContent = '💾 Salvar no Firebase';
  currentResult = null;
};

// ── ESCUTA FIRESTORE ─────────────────────────────────
function iniciarEscutadores() {
  psDB.collection('produtos').orderBy('salvoEm', 'desc').onSnapshot(snap => {
    produtosSalvos = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    atualizarDashboard();
    renderProdutos();
  });
}

// ── DASHBOARD ─────────────────────────────────────────
function atualizarDashboard() {
  const total   = produtosSalvos.length;
  const produzir = produtosSalvos.filter(p => p.veredicto === 'PRODUZIR').length;
  const avaliar  = produtosSalvos.filter(p => p.veredicto === 'AVALIAR').length;
  const evitar   = produtosSalvos.filter(p => p.veredicto === 'EVITAR').length;
  const pendente = produtosSalvos.filter(p => !p.veredicto).length;

  document.getElementById('kpi-total').textContent    = total || '0';
  document.getElementById('kpi-produzir').textContent = produzir || '0';

  // Vendas médias
  const avgVendas = total > 0
    ? (produtosSalvos.reduce((s, p) => s + (p.vendasDia || 0), 0) / total).toFixed(0)
    : '—';
  document.getElementById('kpi-vendas').textContent = avgVendas !== '—' ? avgVendas : '—';

  // Score médio
  const avgScore = total > 0
    ? (produtosSalvos.reduce((s, p) => s + Number(p.scoreTotal || 0), 0) / total).toFixed(1)
    : '—';
  document.getElementById('kpi-score').textContent = avgScore !== '—' ? avgScore : '—';

  // Barras de veredicto
  const setBar = (id, count) => {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const el  = document.getElementById(id);
    if (el) el.style.width = pct + '%';
  };
  setBar('bar-produzir', produzir);
  setBar('bar-avaliar',  avaliar);
  setBar('bar-evitar',   evitar);
  setBar('bar-pendente', pendente);

  ['produzir','avaliar','evitar','pendente'].forEach(v => {
    const el = document.getElementById('count-' + v);
    if (el) el.textContent = { produzir, avaliar, evitar, pendente }[v];
  });

  // Top oportunidades
  const topDiv = document.getElementById('top-oportunidades');
  const top5   = [...produtosSalvos].sort((a, b) => b.scoreTotal - a.scoreTotal).slice(0, 5);
  if (!top5.length) {
    topDiv.innerHTML = `<div class="empty-state"><div class="empty-icon">◎</div><p>Nenhum produto analisado ainda.</p><button class="btn-ghost" onclick="switchTab('analisar')">Analisar primeiro produto →</button></div>`;
  } else {
    topDiv.innerHTML = top5.map((p, i) => `
      <div class="top-item" onclick="abrirModal('${p._id}')">
        <div class="top-rank ${i===0?'r1':i===1?'r2':i===2?'r3':''}">#${i+1}</div>
        <div class="top-info">
          <div class="top-nome">${p.nome}</div>
          <div class="top-meta">${p.plataforma} · ${p.vendasDia || 0} vendas/dia</div>
        </div>
        <div class="top-score">${Number(p.scoreTotal||0).toFixed(1)}</div>
      </div>`).join('');
  }

  // Recentes
  const recentesDiv = document.getElementById('recentes-list');
  const recentes    = produtosSalvos.slice(0, 5);
  if (!recentes.length) {
    recentesDiv.innerHTML = '<div class="empty-mini">Nenhum produto ainda</div>';
  } else {
    recentesDiv.innerHTML = recentes.map(p => `
      <div class="recente-item" onclick="abrirModal('${p._id}')">
        <div>
          <div class="recente-nome">${p.nome}</div>
          <span class="verdict-label ${verdictClass(p.veredicto)}" style="font-size:10px">${p.veredicto || 'PENDENTE'}</span>
        </div>
        <span class="recente-data">${formatDate(p.salvoEm)}</span>
      </div>`).join('');
  }
}

// ── RENDER PRODUTOS ───────────────────────────────────
window.aplicarFiltros = function() { renderProdutos(); };
window.limparFiltros = function() {
  ['filter-veredicto','filter-plataforma','filter-vendas','filter-score','filter-busca'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderProdutos();
};

window.sortProdutos = function(key) {
  sortKey = key;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-sort="${key}"]`)?.classList.add('active');
  renderProdutos();
};

function renderProdutos() {
  let dados = [...produtosSalvos];

  // Filtros
  const fVerd  = document.getElementById('filter-veredicto')?.value || '';
  const fPlat  = document.getElementById('filter-plataforma')?.value || '';
  const fVend  = Number(document.getElementById('filter-vendas')?.value) || 0;
  const fScore = Number(document.getElementById('filter-score')?.value) || 0;
  const fBusca = (document.getElementById('filter-busca')?.value || '').toLowerCase();

  if (fVerd)  dados = dados.filter(p => (fVerd === 'pendente' ? !p.veredicto : p.veredicto === fVerd));
  if (fPlat)  dados = dados.filter(p => p.plataforma === fPlat);
  if (fVend)  dados = dados.filter(p => (p.vendasDia || 0) >= fVend);
  if (fScore) dados = dados.filter(p => Number(p.scoreTotal || 0) >= fScore);
  if (fBusca) dados = dados.filter(p => (p.nome || '').toLowerCase().includes(fBusca));

  // Ordenação
  dados.sort((a, b) => {
    if (sortKey === 'score')  return Number(b.scoreTotal || 0) - Number(a.scoreTotal || 0);
    if (sortKey === 'vendas') return (b.vendasDia || 0) - (a.vendasDia || 0);
    if (sortKey === 'margem') return (b.margemEstimada || 0) - (a.margemEstimada || 0);
    return (b.salvoEm || '').localeCompare(a.salvoEm || ''); // data desc
  });

  const countEl = document.getElementById('filter-count');
  if (countEl) countEl.textContent = `${dados.length} produto(s)`;

  const grid = document.getElementById('produtos-grid');
  if (!dados.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;text-align:center;padding:60px"><div class="empty-icon">◫</div><p>Nenhum produto encontrado.</p></div>`;
    return;
  }

  grid.innerHTML = dados.map(p => {
    const veredicto = p.veredicto || 'pendente';
    const score     = Number(p.scoreTotal || 0).toFixed(1);
    return `
    <div class="produto-card ${veredicto}" onclick="abrirModal('${p._id}')">
      <div class="pc-header">
        <div class="pc-nome">${p.nome}</div>
        <div class="pc-badge ${veredicto}">${p.veredicto || 'PENDENTE'}</div>
      </div>
      <div class="pc-stats">
        <div class="pc-stat"><div class="pc-stat-val">${score}</div><div class="pc-stat-lbl">Score IA</div></div>
        <div class="pc-stat"><div class="pc-stat-val">${p.vendasDia || 0}</div><div class="pc-stat-lbl">Vendas/dia</div></div>
        <div class="pc-stat"><div class="pc-stat-val">${p.margemEstimada || 0}%</div><div class="pc-stat-lbl">Margem Est.</div></div>
      </div>
      <div class="pc-footer">
        <span class="pc-plat">${p.plataforma || '—'}</span>
        <span class="pc-date">${formatDate(p.salvoEm)}</span>
        <div class="pc-actions">
          <button class="pc-btn" title="Excluir" onclick="event.stopPropagation();excluirProduto('${p._id}','${(p.nome||'').replace(/'/g,"\\'")}')">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── MODAL DETALHES ────────────────────────────────────
window.abrirModal = function(id) {
  const p = produtosSalvos.find(x => x._id === id);
  if (!p) return;

  const modal   = document.getElementById('produto-modal');
  const content = document.getElementById('modal-content');

  content.innerHTML = `
    <button class="modal-close" onclick="fecharModal()">✕</button>
    <div class="modal-title">${p.nome}</div>
    <div class="modal-sub">${p.plataforma} · ${p.categoria} · Salvo em ${formatDate(p.salvoEm)}</div>
    <span class="verdict-badge ${p.veredicto || 'pendente'}" style="display:inline-block;margin-bottom:20px">${p.veredicto || 'PENDENTE'}</span>

    <div class="modal-section">
      <div class="modal-section-title">Scores</div>
      <div class="modal-grid">
        <div class="modal-stat"><div class="modal-stat-val" style="color:var(--accent)">${p.printabilidade || 0}</div><div class="modal-stat-lbl">Printabilidade</div></div>
        <div class="modal-stat"><div class="modal-stat-val" style="color:var(--blue)">${p.oportunidade || 0}</div><div class="modal-stat-lbl">Oportunidade</div></div>
        <div class="modal-stat"><div class="modal-stat-val" style="color:var(--yellow)">${p.saturacao || 0}</div><div class="modal-stat-lbl">Saturação</div></div>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">Dados de Produção</div>
      <div class="modal-grid">
        <div class="modal-stat"><div class="modal-stat-val">${p.materialPrincipal || '—'}</div><div class="modal-stat-lbl">Material</div></div>
        <div class="modal-stat"><div class="modal-stat-val">${p.tempoImpressao || '—'}</div><div class="modal-stat-lbl">Tempo</div></div>
        <div class="modal-stat"><div class="modal-stat-val">R$ ${(p.custoMin||0).toFixed(2)}</div><div class="modal-stat-lbl">Custo Mín.</div></div>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">Mercado</div>
      <div class="modal-grid">
        <div class="modal-stat"><div class="modal-stat-val">R$ ${p.precoVenda || 0}</div><div class="modal-stat-lbl">Preço Venda</div></div>
        <div class="modal-stat"><div class="modal-stat-val">${p.vendasDia || 0}/dia</div><div class="modal-stat-lbl">Vendas</div></div>
        <div class="modal-stat"><div class="modal-stat-val">${p.margemEstimada || 0}%</div><div class="modal-stat-lbl">Margem Est.</div></div>
      </div>
    </div>

    ${p.analise ? `
    <div class="modal-section">
      <div class="modal-section-title">Análise da IA</div>
      <p style="font-size:13px;color:var(--text2);line-height:1.7">${p.analise}</p>
    </div>` : ''}

    ${p.keywords?.length ? `
    <div class="modal-section">
      <div class="modal-section-title">Keywords Shopee</div>
      <div class="keywords-list">${p.keywords.map(k => `<span class="kw-tag">${k}</span>`).join('')}</div>
    </div>` : ''}
  `;

  modal.classList.remove('hidden');
};

window.fecharModal = function() {
  document.getElementById('produto-modal').classList.add('hidden');
};

// ── EXCLUIR ───────────────────────────────────────────
window.excluirProduto = async function(id, nome) {
  if (!confirm(`Excluir "${nome}" permanentemente?`)) return;
  try {
    await psDB.collection('produtos').doc(id).delete();
    showToast('Produto excluído ✓');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
};

window.limparTodosDados = async function() {
  if (!confirm('⚠️ Apagar TODOS os produtos? Esta ação é irreversível!')) return;
  if (!confirm('Tem certeza absoluta? Todos os dados serão perdidos!')) return;
  try {
    const snap = await psDB.collection('produtos').get();
    const batch = psDB.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    showToast('Todos os produtos foram apagados', 'error');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
};

// ── UTILS ──────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

function verdictClass(v) {
  if (v === 'PRODUZIR') return 'verd-green';
  if (v === 'AVALIAR')  return 'verd-yellow';
  if (v === 'EVITAR')   return 'verd-red';
  return '';
}

window.showToast = function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 3500);
};

// ── EVENTOS ───────────────────────────────────────────
function setupEventListeners() {
  // Fechar modal clicando fora
  document.getElementById('produto-modal')?.addEventListener('click', function(e) {
    if (e.target === this) fecharModal();
  });

  // Menu mobile
  document.getElementById('menu-btn')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Fechar sidebar ao clicar fora (mobile)
  document.getElementById('main')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
  });
}

// Expõe para o HTML
window.switchTab    = window.switchTab;
window.loginGoogle  = window.loginGoogle;
window.logoutUser   = window.logoutUser;
