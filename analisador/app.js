/* ═══════════════════════════════════════════════════════════
   PRINT SCOUT — app.js  v8
   Fix: remove modelos 1.5 (404 na v1beta), corrige lógica 400,
   cache salva só modelos válidos testados, sem toast em 404
   ═══════════════════════════════════════════════════════════ */

let currentUser           = null;
let produtosSalvos        = [];
let sortKey               = 'data';
let nichoSelecionado      = '';
let plataformaSelecionada = 'Todas';
let volumeMinimo          = 0;
let produtoParaAnalise    = null;

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
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

// ── AUTH ──────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
}
function showApp(user) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  document.getElementById('user-name-display').textContent = user.displayName || user.email;
  const img = document.getElementById('user-photo-display');
  if (img && user.photoURL) img.src = user.photoURL;
}
window.loginGoogle = function () {
  const provider = new firebase.auth.GoogleAuthProvider();
  psAuth.signInWithPopup(provider).catch(e => showToast(e.message, 'error'));
};
window.logoutUser = function () { psAuth.signOut(); };

// ── GEMINI API ────────────────────────────────────────────────
function getApiKey() { return localStorage.getItem('ps_gemini_key') || ''; }

/* Extrai o primeiro bloco JSON válido de uma string qualquer */
function extractJSON(raw) {
  if (!raw) throw new Error('Resposta vazia da IA.');

  // Remove fences markdown
  let s = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();

  // Tenta parse direto
  try { return JSON.parse(s); } catch (_) {}

  // Procura pelo primeiro { ... } balanceado
  const start = s.indexOf('{');
  if (start === -1) throw new Error('Nenhum JSON encontrado na resposta.');
  let depth = 0, end = -1;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('JSON incompleto na resposta.');
  try { return JSON.parse(s.slice(start, end + 1)); }
  catch (e) { throw new Error('JSON inválido: ' + e.message); }
}

/*
 * Modelos confirmados na API v1beta (chaves gratuitas 2024+).
 * gemini-1.5-* retornam 404 em chaves recentes — removidos da lista.
 * Todos os erros 404 são silenciados (modelo não existe = pula para o próximo).
 */
const PREFERRED_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-preview-05-20',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

/*
 * Retorna a lista de modelos a tentar.
 * SEMPRE começa com o working_model salvo (se existir),
 * depois os preferidos, depois os do cache dinâmico.
 * Isso garante que gemini-2.5-flash (que funciona) seja tentado PRIMEIRO.
 */
function getModelsToTry() {
  const saved = localStorage.getItem('ps_working_model');

  // Pega modelos do cache dinâmico (se existir e válido)
  let cached = [];
  try {
    const raw = localStorage.getItem('ps_models_cache');
    const at  = parseInt(localStorage.getItem('ps_models_cache_at') || '0');
    // Cache válido por 30 minutos
    if (raw && Date.now() - at < 30 * 60 * 1000) {
      cached = JSON.parse(raw);
    }
  } catch (_) {}

  // Mescla: saved primeiro, depois PREFERRED, depois cached (sem duplicatas)
  const all = [];
  const seen = new Set();
  const add = (m) => { if (m && !seen.has(m)) { seen.add(m); all.push(m); } };

  if (saved) add(saved);
  PREFERRED_MODELS.forEach(add);
  cached.forEach(add);

  return all;
}

/* Tenta UM modelo — retorna resultado ou lança erro com .status */
async function tryModel(model, prompt, maxTokens) {
  const apiKey = getApiKey();

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature:     0.4,
          maxOutputTokens: maxTokens,
        }
      })
    }
  );

  if (res.ok) {
    const data = await res.json();
    const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!raw) throw new Error('Resposta vazia do modelo.');
    return extractJSON(raw);
  }

  let errMsg = `HTTP ${res.status}`;
  try {
    const errBody = await res.json();
    errMsg = errBody.error?.message || errMsg;
  } catch (_) {}

  const err = new Error(errMsg);
  err.status = res.status;
  throw err;
}

/* Chamada principal: tenta cada modelo, pulando 429 e 404 */
async function callGemini(prompt, maxTokens = 1500) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Configure sua chave Gemini gratuita em Configurações!');

  updateStatusLabel('Conectando à IA…', 'checking');
  const models = getModelsToTry();

  let lastErr     = null;
  let hadQuota    = false; // houve pelo menos um 429
  let hadSuccess  = false; // segurança

  for (const model of models) {
    try {
      updateStatusLabel(`Consultando ${model}…`, 'checking');
      const result = await tryModel(model, prompt, maxTokens);

      // Sucesso — salva como working model e atualiza status
      localStorage.setItem('ps_working_model', model);
      updateStatusLabel(`Gemini ✓ (${model})`, 'online');
      console.log(`[PrintScout] ✓ Sucesso com ${model}`);
      return result;

    } catch (e) {
      lastErr = e;
      console.warn(`[PrintScout] ${model}: HTTP ${e.status || '?'} — ${e.message}`);

      if (e.status === 400) {
        // Chave inválida — para imediatamente
        updateStatusLabel('Chave inválida', 'offline');
        throw new Error('Chave API inválida. Verifique em Configurações (deve começar com "AIza").');
      }

      if (e.status === 429) {
        hadQuota = true; // registra que houve cota esgotada
        continue;        // tenta próximo modelo
      }

      if (e.status === 404) {
        continue; // modelo não existe nesta chave — silencia completamente
      }

      // Outros erros (500, rede, etc.) — tenta próximo
    }
  }

  // Nenhum modelo funcionou
  updateStatusLabel('Erro na API', 'offline');

  // Se houve pelo menos um 429 (e nenhum sucesso), é problema de cota
  if (hadQuota) {
    throw new Error('⏳ Cota esgotada. Aguarde 1-2 minutos e tente novamente.');
  }

  // Erro técnico — mostra mensagem amigável sem expor detalhes da API
  throw new Error('Nenhum modelo disponível respondeu. Vá em Configurações → Testar Chave.');
}

function updateStatusLabel(text, state) {
  const dot = document.getElementById('status-dot');
  const lbl = document.getElementById('status-label');
  if (!dot || !lbl) return;
  dot.className   = 'status-dot ' + (state || '');
  lbl.textContent = text;
}

function verificarApiKey() {
  const key = getApiKey();
  const dot = document.getElementById('status-dot');
  const lbl = document.getElementById('status-label');
  if (!dot || !lbl) return;
  if (!key) {
    dot.className   = 'status-dot offline';
    lbl.textContent = 'Gemini não configurado';
  } else {
    dot.className   = 'status-dot online';
    const m = localStorage.getItem('ps_working_model') || 'gemini-2.5-flash';
    lbl.textContent = `Gemini ✓ (${m})`;
  }
}

window.salvarApiKey = function () {
  const key = document.getElementById('cfg-api-key').value.trim();
  if (!key || !key.startsWith('AIza')) {
    showToast('Chave inválida. Deve começar com "AIza"', 'error');
    return;
  }
  localStorage.setItem('ps_gemini_key', key);
  // Limpa cache para forçar redescoberta
  localStorage.removeItem('ps_working_model');
  localStorage.removeItem('ps_models_cache');
  localStorage.removeItem('ps_models_cache_at');
  document.getElementById('cfg-api-key').value = '';
  const st = document.getElementById('cfg-key-status');
  st.textContent = '✅ Chave salva! Clique em "Testar Chave" para detectar os modelos.';
  st.className = 'cfg-status ok';
  st.classList.remove('hidden');
  verificarApiKey();
  showToast('Chave Gemini salva ✓', 'success');
};

window.testarChaveGemini = async function () {
  const key = getApiKey();
  if (!key) { showToast('Nenhuma chave configurada', 'error'); return; }

  const btn = document.getElementById('btn-testar-chave');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Testando…'; }

  const st = document.getElementById('cfg-key-status');
  st.innerHTML = '⏳ Testando modelos disponíveis…';
  st.className = 'cfg-status ok';
  st.classList.remove('hidden');

  // Limpa cache para teste limpo
  localStorage.removeItem('ps_models_cache');
  localStorage.removeItem('ps_models_cache_at');
  localStorage.removeItem('ps_working_model');

  const results = [];
  let firstOk   = null;
  const modelsToTest = [...PREFERRED_MODELS];

  for (const model of modelsToTest) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Responda APENAS: {"ok":true}' }] }],
            generationConfig: { maxOutputTokens: 20, temperature: 0 }
          })
        }
      );
      if (r.ok) {
        results.push(`✅ ${model} — <strong style="color:var(--green)">funcionando</strong>`);
        if (!firstOk) firstOk = model;
      } else {
        const s = r.status;
        if (s === 429) {
          results.push(`⏳ ${model} — cota temporária (tente em 1 min)`);
          if (!firstOk) firstOk = model; // Marcar como disponível mesmo com 429
        } else if (s === 404) {
          results.push(`⬜ ${model} — não disponível nesta chave`);
        } else {
          results.push(`⚠️ ${model} — erro ${s}`);
        }
      }
    } catch {
      results.push(`❌ ${model} — falha de rede`);
    }
  }

  const html = results.map(r => `<div style="padding:3px 0;font-size:12px">${r}</div>`).join('');

  if (firstOk) {
    localStorage.setItem('ps_working_model', firstOk);
    // Salva no cache APENAS os modelos que existem (ok ou 429), excluindo 404
    const validModels = modelsToTest.filter((_, i) => {
      const r = results[i] || '';
      return !r.includes('não disponível') && !r.includes('falha de rede');
    });
    localStorage.setItem('ps_models_cache',    JSON.stringify(validModels.length ? validModels : PREFERRED_MODELS));
    localStorage.setItem('ps_models_cache_at', String(Date.now()));
    st.innerHTML = html + `<div style="margin-top:10px;padding:8px;background:var(--green-bg);border-radius:6px;color:var(--green);font-weight:600">→ Pronto! Modelo padrão: ${firstOk}</div>`;
    st.className = 'cfg-status ok';
  } else {
    st.innerHTML = html + `<div style="margin-top:10px;padding:8px;background:var(--red-bg);border-radius:6px;color:var(--red);font-weight:600">→ Nenhum modelo respondeu. Aguarde 1-2 minutos e tente novamente.</div>`;
    st.className = 'cfg-status err';
  }

  verificarApiKey();
  if (btn) { btn.disabled = false; btn.textContent = '🔍 Testar Chave'; }
};

// ── TABS ──────────────────────────────────────────────────────
window.switchTab = function (tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item, .bnav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll(`[data-tab="${tab}"]`).forEach(el => el.classList.add('active'));
  if (tab === 'config')   carregarConfigs();
  if (tab === 'produtos') renderProdutos();
};

// ── SELEÇÃO DE NICHO ──────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('niche-grid')?.addEventListener('click', e => {
    const card = e.target.closest('.niche-card');
    if (!card) return;
    document.querySelectorAll('.niche-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    nichoSelecionado = card.dataset.niche;
  });
  document.getElementById('plat-chips')?.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('#plat-chips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    plataformaSelecionada = chip.dataset.plat;
  });
  document.getElementById('vol-chips')?.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('#vol-chips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    volumeMinimo = parseInt(chip.dataset.vol) || 0;
  });
  document.getElementById('analise-modal')?.addEventListener('click', function (e) {
    if (e.target === this) fecharModal('analise-modal');
  });
  document.getElementById('produto-modal')?.addEventListener('click', function (e) {
    if (e.target === this) fecharModal('produto-modal');
  });
  document.getElementById('menu-btn')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
  document.getElementById('main')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
  });
}

// ── BUSCAR NICHO ──────────────────────────────────────────────
window.buscarNicho = async function () {
  if (!nichoSelecionado) {
    showToast('Selecione um nicho antes de buscar!', 'error');
    document.getElementById('niche-grid').style.animation = 'shake .4s ease';
    setTimeout(() => { document.getElementById('niche-grid').style.animation = ''; }, 500);
    return;
  }

  const foco       = document.getElementById('s-foco')?.value.trim() || '';
  const custoFil   = localStorage.getItem('ps_custo_fil')     || '80';
  const custoEnerg = localStorage.getItem('ps_custo_energia') || '1.50';
  const custoMao   = localStorage.getItem('ps_custo_mao')     || '25';

  setBuscarLoading(true);

  const hoje = new Date().toLocaleDateString('pt-BR',
    { day: '2-digit', month: 'long', year: 'numeric' });

  const prompt = `Você é especialista em e-commerce brasileiro e impressão 3D FDM.

Nicho: ${nichoSelecionado}
Plataforma: ${plataformaSelecionada}
${volumeMinimo > 0 ? 'Volume mínimo: ' + volumeMinimo + ' vendas/dia' : ''}
${foco ? 'Foco: ' + foco : ''}
Custos: filamento R$${custoFil}/kg, energia R$${custoEnerg}/h, mão de obra R$${custoMao}/h

Liste os 8 produtos mais vendidos deste nicho que possam ser fabricados com impressora 3D FDM.

Responda SOMENTE com JSON puro, sem texto antes ou depois, sem markdown, sem explicações:
{"nicho":"${nichoSelecionado}","plataforma":"${plataformaSelecionada}","data_referencia":"${hoje}","produtos":[{"nome":"nome do produto","descricao":"descricao curta","preco_min":15.00,"preco_max":45.00,"vendas_dia_estimadas":500,"concorrentes_estimados":60,"avaliacao_media":4.5,"printabilidade":8,"oportunidade":7,"saturacao":4,"veredicto":"PRODUZIR","material_sugerido":"PLA","motivo":"motivo em uma frase","diferencial_possivel":"como se diferenciar"}]}

Regras:
- printabilidade/oportunidade/saturacao: 0 a 10
- veredicto: PRODUZIR (oportunidade>=7 e print>=6), AVALIAR (intermediario), EVITAR (saturado)
- Retorne exatamente 8 produtos
- JSON valido sem caracteres especiais problematicos
- Nao use aspas simples dentro de strings JSON`;

  try {
    const resultado = await callGemini(prompt, 2000);

    if (!resultado.produtos || !Array.isArray(resultado.produtos)) {
      throw new Error('A IA não retornou a lista de produtos. Tente novamente.');
    }

    let produtos = resultado.produtos;
    if (volumeMinimo > 0) {
      produtos = produtos.filter(p => (p.vendas_dia_estimadas || 0) >= volumeMinimo);
    }

    if (!produtos.length) {
      showToast('Nenhum produto passou o filtro de volume. Reduza o mínimo.', 'error');
      setBuscarLoading(false);
      return;
    }

    renderDiscovery(resultado, produtos);
    showToast(`${produtos.length} produtos encontrados!`, 'success');
  } catch (e) {
    showToast('Erro: ' + e.message.split('\n')[0], 'error');
    // Mostra erro completo no modal se for longo
    if (e.message.includes('Cota') || e.message.includes('Configurações') || e.message.includes('Config')) {
      if (e.message.includes('Configurações') || e.message.includes('Config')) switchTab('config');
    }
  } finally {
    setBuscarLoading(false);
    verificarApiKey();
  }
};

function setBuscarLoading(loading) {
  const btn  = document.getElementById('btn-search');
  const txt  = document.getElementById('search-btn-text');
  const load = document.getElementById('search-loader');
  btn.disabled = loading;
  txt.classList.toggle('hidden', loading);
  load.classList.toggle('hidden', !loading);
}

// ── RENDER DISCOVERY ──────────────────────────────────────────
function renderDiscovery(meta, produtos) {
  const section = document.getElementById('discovery-section');
  const grid    = document.getElementById('discovery-grid');
  const title   = document.getElementById('discovery-title');

  title.textContent = `${meta.nicho} · ${meta.plataforma} · ${meta.data_referencia}`;
  section.classList.remove('hidden');

  grid.innerHTML = produtos.map((p, i) => {
    const scoreGeral = ((p.printabilidade + p.oportunidade + (10 - p.saturacao)) / 3).toFixed(1);
    const verdClass  = p.veredicto === 'PRODUZIR' ? 'PRODUZIR' : p.veredicto === 'AVALIAR' ? 'AVALIAR' : 'EVITAR';
    const vendasFmt  = p.vendas_dia_estimadas >= 1000
      ? (p.vendas_dia_estimadas / 1000).toFixed(1) + 'k'
      : p.vendas_dia_estimadas;
    return `
    <div class="discovery-card ${verdClass}" onclick="abrirAnalise(${i})" data-index="${i}">
      <div class="dc-header">
        <div class="dc-rank">#${i + 1}</div>
        <span class="pc-badge ${verdClass}">${p.veredicto}</span>
      </div>
      <div class="dc-nome">${p.nome}</div>
      <div class="dc-desc">${p.descricao}</div>
      <div class="dc-scores">
        <div class="dc-score-item"><div class="dc-score-val" style="color:var(--accent)">${p.printabilidade}</div><div class="dc-score-lbl">Print</div></div>
        <div class="dc-score-item"><div class="dc-score-val" style="color:var(--blue)">${p.oportunidade}</div><div class="dc-score-lbl">Oport.</div></div>
        <div class="dc-score-item"><div class="dc-score-val" style="color:var(--yellow)">${p.saturacao}</div><div class="dc-score-lbl">Satur.</div></div>
        <div class="dc-score-item"><div class="dc-score-val" style="color:var(--purple)">${scoreGeral}</div><div class="dc-score-lbl">Score</div></div>
      </div>
      <div class="dc-stats">
        <span class="dc-stat">📦 ~${vendasFmt}/dia</span>
        <span class="dc-stat">💰 R$ ${p.preco_min}–${p.preco_max}</span>
        <span class="dc-stat">🧵 ${p.material_sugerido}</span>
      </div>
      <div class="dc-motivo">${p.motivo}</div>
      <button class="dc-btn-analise">🔬 Análise Profunda →</button>
    </div>`;
  }).join('');

  window._discoveryProdutos = produtos;
  window._discoveryMeta     = meta;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── ANÁLISE PROFUNDA ──────────────────────────────────────────
window.abrirAnalise = async function (index) {
  const produto = window._discoveryProdutos?.[index];
  const meta    = window._discoveryMeta || {};
  if (!produto) return;

  produtoParaAnalise = { ...produto, nicho: meta.nicho, plataforma: meta.plataforma };
  document.getElementById('analise-loading').classList.remove('hidden');
  document.getElementById('analise-resultado').classList.add('hidden');
  document.getElementById('analise-modal').classList.remove('hidden');

  const custoFil   = localStorage.getItem('ps_custo_fil')     || '80';
  const custoEnerg = localStorage.getItem('ps_custo_energia') || '1.50';
  const custoMao   = localStorage.getItem('ps_custo_mao')     || '25';
  const margemMin  = localStorage.getItem('ps_margem_min')    || '40';

  const prompt = `Especialista em impressao 3D FDM e e-commerce brasileiro.

Produto: ${produto.nome}
Nicho: ${meta.nicho || ''} | Plataforma: ${meta.plataforma || 'Shopee'}
Preco mercado: R$${produto.preco_min}–R$${produto.preco_max}
Vendas/dia: ${produto.vendas_dia_estimadas} | Concorrentes: ${produto.concorrentes_estimados}
Custos: filamento R$${custoFil}/kg, energia R$${custoEnerg}/h, mao obra R$${custoMao}/h, margem minima ${margemMin}%

Responda SOMENTE com JSON puro, sem texto antes ou depois:
{"printabilidade":8,"oportunidade":7,"saturacao":5,"veredicto":"PRODUZIR","material_principal":"PLA","material_alternativo":"PETG","dificuldade":"Facil","nivel_concorrencia":"Media","tempo_impressao":"2h 30m","custo_material_min":3.50,"custo_material_max":6.00,"custo_total_min":5.00,"custo_total_max":9.00,"preco_sugerido_min":25.00,"preco_sugerido_max":45.00,"margem_estimada_min":60,"margem_estimada_max":80,"config_impressao":{"camada":"0.2mm","infill":"20%","suporte":"Nao","temperatura_bico":"210C","temperatura_mesa":"60C","velocidade":"60mm/s"},"pontos_favoraveis":["ponto1","ponto2","ponto3"],"riscos":["risco1","risco2"],"analise_resumo":"analise em 3 frases","keywords_shopee":["kw1","kw2","kw3","kw4","kw5"],"diferenciais":["diferencial1","diferencial2"],"ideias_variacao":["variacao1","variacao2"],"alertas":[]}`;

  try {
    const resultado = await callGemini(prompt, 1500);
    resultado._produto = { ...produto, nicho: meta.nicho, plataforma: meta.plataforma };
    renderAnalise(resultado);
  } catch (e) {
    fecharModal('analise-modal');
    showToast('Erro na análise: ' + e.message.split('\n')[0], 'error');
  }
};

// ── RENDER ANÁLISE PROFUNDA ───────────────────────────────────
function renderAnalise(r) {
  const p = r._produto;
  document.getElementById('analise-loading').classList.add('hidden');
  const container = document.getElementById('analise-resultado');
  container.classList.remove('hidden');

  const verdClass  = r.veredicto;
  const scoreGeral = ((r.printabilidade + r.oportunidade + (10 - r.saturacao)) / 3).toFixed(1);

  container.innerHTML = `
    <div class="analise-result-header">
      <div>
        <div class="analise-nome">${p.nome}</div>
        <div style="font-size:12px;color:var(--text3)">${p.nicho} · ${p.plataforma}</div>
      </div>
      <span class="verdict-badge ${verdClass}">${r.veredicto}</span>
    </div>
    <div class="scores-row">
      ${renderCircle('circle-p', r.printabilidade, 'Printabilidade', 'var(--accent)')}
      ${renderCircle('circle-o', r.oportunidade,   'Oportunidade',   'var(--blue)')}
      ${renderCircle('circle-s', r.saturacao,      'Saturação',      'var(--yellow)')}
      ${renderCircle('circle-g', parseFloat(scoreGeral), 'Score Geral', 'var(--purple)')}
    </div>
    <div class="info-grid">
      <div class="info-card"><div class="info-icon">🧵</div><div class="info-label">Material</div><div class="info-value">${r.material_principal}</div><div class="info-sub">${r.material_alternativo||'—'}</div></div>
      <div class="info-card"><div class="info-icon">⏱</div><div class="info-label">Tempo Print</div><div class="info-value">${r.tempo_impressao}</div><div class="info-sub">por unidade</div></div>
      <div class="info-card"><div class="info-icon">💰</div><div class="info-label">Custo Total</div><div class="info-value">R$ ${(r.custo_total_min||0).toFixed(2)}–${(r.custo_total_max||0).toFixed(2)}</div><div class="info-sub">material + energia + M.O.</div></div>
      <div class="info-card info-highlight"><div class="info-icon">📈</div><div class="info-label">Margem Est.</div><div class="info-value">${r.margem_estimada_min||0}%–${r.margem_estimada_max||0}%</div><div class="info-sub">preço: R$ ${(r.preco_sugerido_min||0).toFixed(2)}–${(r.preco_sugerido_max||0).toFixed(2)}</div></div>
    </div>
    <div class="tags-row">
      <div class="tag-item"><span class="tag-label">Dificuldade:</span><span class="tag-value">${r.dificuldade}</span></div>
      <div class="tag-item"><span class="tag-label">Concorrência:</span><span class="tag-value">${r.nivel_concorrencia}</span></div>
      <div class="tag-item"><span class="tag-label">Vendas/dia:</span><span class="tag-value">~${p.vendas_dia_estimadas}</span></div>
    </div>
    <div class="print-config-box">
      <div class="print-config-title">⚙️ Configuração de Impressão Sugerida</div>
      <div class="print-config-grid">
        ${Object.entries(r.config_impressao||{}).map(([k,v])=>`<span class="cfg-chip"><strong>${k.replace(/_/g,' ')}:</strong> ${v}</span>`).join('')}
      </div>
    </div>
    <div class="pros-cons-row">
      <div class="pros-box">
        <div class="pros-title">✅ Pontos Favoráveis</div>
        <ul>${(r.pontos_favoraveis||[]).map(pt=>`<li>${pt}</li>`).join('')}</ul>
      </div>
      <div class="cons-box">
        <div class="cons-title">⚠️ Riscos</div>
        <ul>${(r.riscos||[]).map(ri=>`<li>${ri}</li>`).join('')}</ul>
      </div>
    </div>
    <div class="analise-box">
      <div class="analise-title">🤖 Análise da IA</div>
      <p>${r.analise_resumo}</p>
    </div>
    ${r.ideias_variacao?.length ? `<div class="analise-box"><div class="analise-title">💡 Ideias de Variação</div><ul style="margin-top:8px;padding-left:16px;color:var(--text2);font-size:13px;line-height:1.8">${r.ideias_variacao.map(d=>`<li>${d}</li>`).join('')}</ul></div>` : ''}
    <div class="analise-box">
      <div class="analise-title">🚀 Como Se Diferenciar</div>
      <ul style="margin-top:8px;padding-left:16px;color:var(--text2);font-size:13px;line-height:1.8">${(r.diferenciais||[]).map(d=>`<li>${d}</li>`).join('')}</ul>
    </div>
    ${r.alertas?.length ? `<div class="analise-box" style="border-left:3px solid var(--yellow)"><div class="analise-title" style="color:var(--yellow)">⚠️ Alertas</div><ul style="margin-top:8px;padding-left:16px;color:var(--text2);font-size:13px;line-height:1.8">${r.alertas.map(a=>`<li>${a}</li>`).join('')}</ul></div>` : ''}
    <div class="keywords-box">
      <div class="keywords-title">🔍 Palavras-chave para Shopee / TikTok</div>
      <div class="keywords-list">${(r.keywords_shopee||[]).map(k=>`<span class="kw-tag">${k}</span>`).join('')}</div>
    </div>
    <div class="result-actions" style="padding:20px 0 0">
      <button class="btn-save" onclick="salvarAnalise()">💾 Salvar no Firebase</button>
      <button class="btn-ghost" onclick="fecharModal('analise-modal')">Fechar</button>
    </div>`;

  setTimeout(() => animarCirculos(r), 100);
  window._currentAnalise = r;
}

function renderCircle(id, value, label, color) {
  const v = Math.min(10, Math.max(0, value || 0));
  const circ = 213.6;
  const offset = circ - (v / 10) * circ;
  return `
  <div class="score-circle-wrap">
    <svg class="score-circle" viewBox="0 0 80 80">
      <circle class="track" cx="40" cy="40" r="34"/>
      <circle class="fill" cx="40" cy="40" r="34" id="${id}"
        style="stroke:${color};stroke-dashoffset:${offset.toFixed(1)};stroke-dasharray:${circ}"/>
    </svg>
    <div class="score-inner">
      <div class="score-num">${v.toFixed(1)}</div>
      <div class="score-lbl">${label}</div>
    </div>
  </div>`;
}

function animarCirculos(r) {
  const circ = 213.6;
  const vals = {
    'circle-p': r.printabilidade,
    'circle-o': r.oportunidade,
    'circle-s': r.saturacao,
    'circle-g': parseFloat(((r.printabilidade + r.oportunidade + (10 - r.saturacao)) / 3).toFixed(1))
  };
  Object.entries(vals).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const v = Math.min(10, Math.max(0, val || 0));
    el.style.transition = 'stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)';
    el.style.strokeDashoffset = (circ - (v / 10) * circ).toFixed(1);
  });
}

// ── SALVAR ANÁLISE ────────────────────────────────────────────
window.salvarAnalise = async function () {
  const r = window._currentAnalise;
  if (!r || !currentUser) return;
  const p   = r._produto || {};
  const btn = document.querySelector('#analise-resultado .btn-save');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }

  try {
    const scoreGeral = ((r.printabilidade + r.oportunidade + (10 - r.saturacao)) / 3);
    const payload = {
      nome: p.nome, descricao: p.descricao || '',
      nicho: p.nicho || '', plataforma: p.plataforma || 'Shopee',
      categoria: p.nicho || '',
      precoMin: p.preco_min || 0, precoMax: p.preco_max || 0,
      vendasDia: p.vendas_dia_estimadas || 0,
      concorrentes: p.concorrentes_estimados || 0,
      printabilidade: r.printabilidade, oportunidade: r.oportunidade, saturacao: r.saturacao,
      scoreTotal: scoreGeral.toFixed(2), veredicto: r.veredicto,
      materialPrincipal: r.material_principal, materialAlt: r.material_alternativo || '',
      dificuldade: r.dificuldade, nivelConcorrencia: r.nivel_concorrencia,
      tempoImpressao: r.tempo_impressao,
      custoMin: r.custo_material_min || 0, custoMax: r.custo_material_max || 0,
      custoTotalMin: r.custo_total_min || 0, custoTotalMax: r.custo_total_max || 0,
      margemMin: r.margem_estimada_min || 0, margemMax: r.margem_estimada_max || 0,
      margemEstimada: r.margem_estimada_max || 0,
      precoSugeridoMin: r.preco_sugerido_min || 0, precoSugeridoMax: r.preco_sugerido_max || 0,
      configImpressao: r.config_impressao || {},
      pontosPositivos: r.pontos_favoraveis || [], riscos: r.riscos || [],
      analise: r.analise_resumo || '', keywords: r.keywords_shopee || [],
      diferenciais: r.diferenciais || [], ideiasVariacao: r.ideias_variacao || [],
      alertas: r.alertas || [],
      salvoEm: new Date().toISOString(), usuario: currentUser.email
    };
    await psDB.collection('produtos').add(payload);
    if (btn) btn.textContent = '✅ Salvo!';
    showToast('Produto salvo! ✓', 'success');
    window._currentAnalise = null;
  } catch (e) {
    showToast('Erro ao salvar: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar no Firebase'; }
  }
};

// ── FIRESTORE ─────────────────────────────────────────────────
function iniciarEscutadores() {
  psDB.collection('produtos')
    .where('usuario', '==', currentUser.email)
    .orderBy('salvoEm', 'desc')
    .onSnapshot(snap => {
      produtosSalvos = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
      atualizarDashboard(); renderProdutos();
    }, err => {
      console.warn('Firestore:', err.message);
      psDB.collection('produtos').orderBy('salvoEm', 'desc').onSnapshot(snap => {
        produtosSalvos = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
          .filter(p => p.usuario === currentUser.email);
        atualizarDashboard(); renderProdutos();
      });
    });
}

// ── DASHBOARD ─────────────────────────────────────────────────
function atualizarDashboard() {
  const total    = produtosSalvos.length;
  const produzir = produtosSalvos.filter(p => p.veredicto === 'PRODUZIR').length;
  const avaliar  = produtosSalvos.filter(p => p.veredicto === 'AVALIAR').length;
  const evitar   = produtosSalvos.filter(p => p.veredicto === 'EVITAR').length;

  document.getElementById('kpi-total').textContent    = total || '0';
  document.getElementById('kpi-produzir').textContent = produzir || '0';

  const avgVendas = total > 0
    ? Math.round(produtosSalvos.reduce((s, p) => s + (p.vendasDia || 0), 0) / total)
    : '—';
  document.getElementById('kpi-vendas').textContent = avgVendas;

  const avgScore = total > 0
    ? (produtosSalvos.reduce((s, p) => s + Number(p.scoreTotal || 0), 0) / total).toFixed(1)
    : '—';
  document.getElementById('kpi-score').textContent = avgScore;

  ['produzir', 'avaliar', 'evitar'].forEach(k => {
    const count = { produzir, avaliar, evitar }[k];
    const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
    const bar   = document.getElementById('bar-' + k);
    const cnt   = document.getElementById('count-' + k);
    if (bar) bar.style.width = pct + '%';
    if (cnt) cnt.textContent = count;
  });

  const topDiv = document.getElementById('top-oportunidades');
  const top5   = [...produtosSalvos].sort((a, b) => b.scoreTotal - a.scoreTotal).slice(0, 5);
  topDiv.innerHTML = !top5.length
    ? `<div class="empty-state"><div class="empty-icon">◎</div><p>Nenhum produto salvo ainda.</p><button class="btn-ghost" onclick="switchTab('buscar')">Buscar primeiro nicho →</button></div>`
    : top5.map((p, i) => `
      <div class="top-item" onclick="abrirModal('${p._id}')">
        <div class="top-rank ${i===0?'r1':i===1?'r2':i===2?'r3':''}">#${i+1}</div>
        <div class="top-info"><div class="top-nome">${p.nome}</div><div class="top-meta">${p.plataforma||''} · ${p.vendasDia||0} vendas/dia</div></div>
        <div class="top-score">${Number(p.scoreTotal||0).toFixed(1)}</div>
      </div>`).join('');

  const recentesDiv = document.getElementById('recentes-list');
  const recentes    = produtosSalvos.slice(0, 5);
  recentesDiv.innerHTML = !recentes.length
    ? '<div class="empty-mini">Nenhum produto ainda</div>'
    : recentes.map(p => `
      <div class="recente-item" onclick="abrirModal('${p._id}')">
        <div><div class="recente-nome">${p.nome}</div><span class="verdict-label ${verdictClass(p.veredicto)}" style="font-size:10px">${p.veredicto||'PENDENTE'}</span></div>
        <span class="recente-data">${formatDate(p.salvoEm)}</span>
      </div>`).join('');
}

// ── RENDER PRODUTOS ───────────────────────────────────────────
window.aplicarFiltros = function () { renderProdutos(); };
window.limparFiltros  = function () {
  ['filter-veredicto','filter-plataforma','filter-vendas','filter-score','filter-busca']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  renderProdutos();
};
window.sortProdutos = function (key) {
  sortKey = key;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-sort="${key}"]`)?.classList.add('active');
  renderProdutos();
};

function renderProdutos() {
  let dados = [...produtosSalvos];
  const fVerd  = document.getElementById('filter-veredicto')?.value || '';
  const fPlat  = document.getElementById('filter-plataforma')?.value || '';
  const fVend  = Number(document.getElementById('filter-vendas')?.value) || 0;
  const fScore = Number(document.getElementById('filter-score')?.value) || 0;
  const fBusca = (document.getElementById('filter-busca')?.value || '').toLowerCase();

  if (fVerd)  dados = dados.filter(p => p.veredicto === fVerd);
  if (fPlat)  dados = dados.filter(p => (p.plataforma || '').includes(fPlat));
  if (fVend)  dados = dados.filter(p => (p.vendasDia || 0) >= fVend);
  if (fScore) dados = dados.filter(p => Number(p.scoreTotal || 0) >= fScore);
  if (fBusca) dados = dados.filter(p => (p.nome || '').toLowerCase().includes(fBusca));

  dados.sort((a, b) => {
    if (sortKey === 'score')  return Number(b.scoreTotal||0) - Number(a.scoreTotal||0);
    if (sortKey === 'vendas') return (b.vendasDia||0) - (a.vendasDia||0);
    if (sortKey === 'margem') return (b.margemEstimada||0) - (a.margemEstimada||0);
    return (b.salvoEm||'').localeCompare(a.salvoEm||'');
  });

  const countEl = document.getElementById('filter-count');
  if (countEl) countEl.textContent = `${dados.length} produto(s)`;

  const grid = document.getElementById('produtos-grid');
  if (!dados.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;text-align:center;padding:60px"><div class="empty-icon">◫</div><p>Nenhum produto encontrado.</p></div>`;
    return;
  }
  grid.innerHTML = dados.map(p => {
    const v     = p.veredicto || 'pendente';
    const score = Number(p.scoreTotal||0).toFixed(1);
    return `
    <div class="produto-card ${v}" onclick="abrirModal('${p._id}')">
      <div class="pc-header">
        <div class="pc-nome">${p.nome}</div>
        <div class="pc-badge ${v}">${p.veredicto||'PENDENTE'}</div>
      </div>
      <div class="pc-nicho-tag">${p.nicho||p.categoria||'—'}</div>
      <div class="pc-stats">
        <div class="pc-stat"><div class="pc-stat-val">${score}</div><div class="pc-stat-lbl">Score IA</div></div>
        <div class="pc-stat"><div class="pc-stat-val">${p.vendasDia||0}</div><div class="pc-stat-lbl">Vendas/dia</div></div>
        <div class="pc-stat"><div class="pc-stat-val">${p.margemMax||p.margemEstimada||0}%</div><div class="pc-stat-lbl">Margem</div></div>
      </div>
      <div class="pc-footer">
        <span class="pc-plat">${p.plataforma||'—'}</span>
        <span class="pc-date">${formatDate(p.salvoEm)}</span>
        <div class="pc-actions"><button class="pc-btn" title="Excluir" onclick="event.stopPropagation();excluirProduto('${p._id}','${(p.nome||'').replace(/'/g,"\\'")}')">🗑</button></div>
      </div>
    </div>`;
  }).join('');
}

// ── MODAL PRODUTO ─────────────────────────────────────────────
window.abrirModal = function (id) {
  const p = produtosSalvos.find(x => x._id === id);
  if (!p) return;
  document.getElementById('modal-content').innerHTML = `
    <button class="modal-close" onclick="fecharModal('produto-modal')">✕</button>
    <div class="modal-title">${p.nome}</div>
    <div class="modal-sub">${p.plataforma||''} · ${p.nicho||p.categoria||''} · ${formatDate(p.salvoEm)}</div>
    <span class="verdict-badge ${p.veredicto}" style="display:inline-block;margin-bottom:20px">${p.veredicto||'PENDENTE'}</span>
    <div class="modal-section"><div class="modal-section-title">Scores</div>
      <div class="modal-grid">
        <div class="modal-stat"><div class="modal-stat-val" style="color:var(--accent)">${p.printabilidade||0}</div><div class="modal-stat-lbl">Printabilidade</div></div>
        <div class="modal-stat"><div class="modal-stat-val" style="color:var(--blue)">${p.oportunidade||0}</div><div class="modal-stat-lbl">Oportunidade</div></div>
        <div class="modal-stat"><div class="modal-stat-val" style="color:var(--yellow)">${p.saturacao||0}</div><div class="modal-stat-lbl">Saturação</div></div>
      </div></div>
    <div class="modal-section"><div class="modal-section-title">Produção</div>
      <div class="modal-grid">
        <div class="modal-stat"><div class="modal-stat-val">${p.materialPrincipal||'—'}</div><div class="modal-stat-lbl">Material</div></div>
        <div class="modal-stat"><div class="modal-stat-val">${p.tempoImpressao||'—'}</div><div class="modal-stat-lbl">Tempo</div></div>
        <div class="modal-stat"><div class="modal-stat-val">R$ ${(p.custoTotalMin||p.custoMin||0).toFixed(2)}</div><div class="modal-stat-lbl">Custo Mín.</div></div>
      </div></div>
    <div class="modal-section"><div class="modal-section-title">Mercado</div>
      <div class="modal-grid">
        <div class="modal-stat"><div class="modal-stat-val">R$${p.precoMin||0}–${p.precoMax||0}</div><div class="modal-stat-lbl">Preço Mercado</div></div>
        <div class="modal-stat"><div class="modal-stat-val">${p.vendasDia||0}/dia</div><div class="modal-stat-lbl">Vendas Est.</div></div>
        <div class="modal-stat"><div class="modal-stat-val">${p.margemMax||p.margemEstimada||0}%</div><div class="modal-stat-lbl">Margem Máx.</div></div>
      </div></div>
    ${p.analise ? `<div class="modal-section"><div class="modal-section-title">Análise da IA</div><p style="font-size:13px;color:var(--text2);line-height:1.7">${p.analise}</p></div>` : ''}
    ${p.keywords?.length ? `<div class="modal-section"><div class="modal-section-title">Keywords</div><div class="keywords-list">${p.keywords.map(k=>`<span class="kw-tag">${k}</span>`).join('')}</div></div>` : ''}`;
  document.getElementById('produto-modal').classList.remove('hidden');
};
window.fecharModal = function (id) { document.getElementById(id)?.classList.add('hidden'); };

// ── EXCLUIR ───────────────────────────────────────────────────
window.excluirProduto = async function (id, nome) {
  if (!confirm(`Excluir "${nome}"?`)) return;
  try { await psDB.collection('produtos').doc(id).delete(); showToast('Produto excluído ✓'); }
  catch (e) { showToast('Erro: ' + e.message, 'error'); }
};
window.limparTodosDados = async function () {
  if (!confirm('⚠️ Apagar TODOS os seus produtos?')) return;
  if (!confirm('Confirma? Ação irreversível!')) return;
  try {
    const snap  = await psDB.collection('produtos').where('usuario', '==', currentUser.email).get();
    const batch = psDB.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    showToast('Todos os produtos apagados', 'error');
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
};

// ── CONFIGS ───────────────────────────────────────────────────
window.salvarConfig = function () {
  const v = document.getElementById('cfg-min-vendas').value;
  const s = document.getElementById('cfg-min-score').value;
  if (v) localStorage.setItem('ps_min_vendas', v);
  if (s) localStorage.setItem('ps_min_score', s);
  showToast('Configurações salvas ✓');
};
window.salvarCustos = function () {
  [['cfg-filamento','ps_custo_fil'],['cfg-energia','ps_custo_energia'],
   ['cfg-mao-obra','ps_custo_mao'],['cfg-margem-min','ps_margem_min']]
    .forEach(([id, key]) => {
      const v = document.getElementById(id)?.value;
      if (v) localStorage.setItem(key, v);
    });
  showToast('Custos salvos ✓');
};
function carregarConfigs() {
  [['cfg-min-vendas','ps_min_vendas'],['cfg-min-score','ps_min_score'],
   ['cfg-filamento','ps_custo_fil'],['cfg-energia','ps_custo_energia'],
   ['cfg-mao-obra','ps_custo_mao'],['cfg-margem-min','ps_margem_min']]
    .forEach(([id, key]) => {
      const el = document.getElementById(id);
      const v  = localStorage.getItem(key);
      if (el && v) el.value = v;
    });
}

// ── LIMPAR CACHE (botão útil nas configs) ─────────────────────
window.limparCacheModelos = function () {
  localStorage.removeItem('ps_models_cache');
  localStorage.removeItem('ps_models_cache_at');
  localStorage.removeItem('ps_working_model');
  showToast('Cache de modelos limpo ✓', 'success');
  verificarApiKey();
};

// ── UTILS ─────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}
function verdictClass(v) {
  return v==='PRODUZIR' ? 'verd-green' : v==='AVALIAR' ? 'verd-yellow' : v==='EVITAR' ? 'verd-red' : '';
}
window.showToast = function (msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 3500);
};
