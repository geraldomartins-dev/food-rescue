const apiBase = '/api/v1';
const state = {
  token: sessionStorage.getItem('foodRescueToken'),
  user: JSON.parse(sessionStorage.getItem('foodRescueUser') || 'null'),
  establishments: []
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let response = await fetch(`${apiBase}${path}`, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 401 && state.token && !options.noRefresh) {
    const refreshed = await fetch(`${apiBase}/auth/refresh`, { method: 'POST', credentials: 'same-origin' });
    if (refreshed.ok) { const session = await refreshed.json(); storeSession(session); headers.Authorization = `Bearer ${state.token}`;
      response = await fetch(`${apiBase}${path}`, { ...options, headers, credentials: 'same-origin' }); }
  }
  const body = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
  if (!response.ok) throw new Error(body?.error?.message || 'Não foi possível concluir a operação.');
  return body;
}

function showMessage(target, text, error = false) {
  const element = $(target); element.textContent = text; element.classList.remove('hidden');
  if (error) element.style.background = '#8f2f2f';
  setTimeout(() => element.classList.add('hidden'), 4500);
}

function setAuthTab(tab) {
  const login = tab === 'login';
  $('#login-form').classList.toggle('hidden', !login);
  $('#register-form').classList.toggle('hidden', login);
  $('#login-tab').classList.toggle('active', login);
  $('#register-tab').classList.toggle('active', !login);
  $('#login-tab').setAttribute('aria-selected', String(login));
  $('#register-tab').setAttribute('aria-selected', String(!login));
  $('#auth-message').classList.add('hidden');
}

function storeSession(result) {
  state.token = result.accessToken; state.user = result.user;
  sessionStorage.setItem('foodRescueToken', state.token);
  sessionStorage.setItem('foodRescueUser', JSON.stringify(state.user));
}

async function logout() {
  try { await fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'same-origin' }); } catch {}
  sessionStorage.clear(); state.token = null; state.user = null; state.establishments = [];
  renderSession();
}

async function renderSession() {
  const signedIn = Boolean(state.token && state.user);
  $('#auth-view').classList.toggle('hidden', signedIn);
  $('#dashboard-view').classList.toggle('hidden', !signedIn);
  $('#session-actions').innerHTML = signedIn ? '<button class="button secondary" id="logout-button">Sair</button>' : '';
  $('#logout-button')?.addEventListener('click', logout);
  if (!signedIn) return;
  $('#user-name').textContent = state.user.nome;
  $('#user-role').textContent = ({ ong: 'ONG', doador: 'Doador', admin: 'Administrador' })[state.user.perfil];
  $('#welcome-title').textContent = `Olá, ${state.user.nome.split(' ')[0]}!`;
  $('#welcome-copy').textContent = state.user.perfil === 'doador'
    ? 'Cadastre excedentes com informações claras e acompanhe o caminho de cada doação.'
    : state.user.perfil === 'ong' ? 'Encontre alimentos próximos, organize retiradas e amplie o alcance da sua organização.'
    : 'Acompanhe a operação, gerencie acessos e consulte a rastreabilidade da plataforma.';
  $$('.donor-only').forEach((element) => element.classList.toggle('hidden', state.user.perfil !== 'doador'));
  $$('.ong-only').forEach((element) => element.classList.toggle('hidden', state.user.perfil !== 'ong'));
  $$('.admin-only').forEach((element) => element.classList.toggle('hidden', state.user.perfil !== 'admin'));
  $$('.member-only').forEach((element) => element.classList.toggle('hidden', state.user.perfil === 'admin'));
  if (state.user.perfil === 'admin') await loadAdmin(); else await loadEstablishments();
}

function openPanel(name) {
  $$('[data-panel-content]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panelContent !== name));
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.panel === name));
  if (name === 'available-lots') loadLots();
  if (name === 'rescues') loadRescues();
  if (name === 'admin') loadAdmin();
  if (name === 'audit') loadAudit();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadEstablishments() {
  try {
    const result = await api('/estabelecimentos/meus');
    state.establishments = result.data;
    $('#establishment-count').textContent = state.establishments.length;
    $('#action-value').textContent = state.establishments.length ? (state.user.perfil === 'doador' ? 'Doar lote' : 'Buscar lotes') : 'Cadastrar';
    $('#establishment-list').innerHTML = state.establishments.length ? state.establishments.map((item) => `
      <article class="item-card"><span class="badge">${item.tipo}</span><h3>${escapeHtml(item.nome_fantasia)}</h3>
      <p>${escapeHtml(item.cidade)} - ${escapeHtml(item.uf)}</p><p>${escapeHtml(item.logradouro)}, ${escapeHtml(item.numero)}</p></article>`).join('')
      : '<div class="empty">Nenhum estabelecimento cadastrado. Adicione o primeiro para continuar.</div>';
    const select = $('#donor-establishment');
    select.innerHTML = state.establishments.map((item) => `<option value="${item.id}">${escapeHtml(item.nome_fantasia)}</option>`).join('');
  } catch (error) { showMessage('#dashboard-message', error.message, true); }
}

async function loadLots() {
  const list = $('#lot-list'); list.innerHTML = '<div class="empty">Carregando alimentos...</div>';
  try {
    const result = await api('/lotes');
    list.innerHTML = result.data.length ? result.data.map((lot) => `
      <article class="item-card"><p class="eyebrow">${escapeHtml(lot.categoria.replaceAll('_', ' '))}</p>
      <h3>${escapeHtml(lot.titulo)}</h3><p><strong>${lot.quantidade} ${escapeHtml(lot.unidade)}</strong> · validade ${formatDate(lot.validade_em)}</p>
      <p>${escapeHtml(lot.nome_fantasia)} · ${escapeHtml(lot.cidade)}, ${escapeHtml(lot.uf)}</p>
      <button class="button primary request-lot" data-id="${lot.id}">Solicitar resgate</button></article>`).join('')
      : '<div class="empty">Não há lotes disponíveis neste momento.</div>';
    $$('.request-lot').forEach((button) => button.addEventListener('click', () => requestLot(button.dataset.id)));
  } catch (error) { list.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
}

async function requestLot(lotId) {
  const ong = state.establishments.find((item) => item.tipo === 'ong');
  if (!ong) return showMessage('#dashboard-message', 'Cadastre uma ONG antes de solicitar um resgate.', true);
  try {
    await api(`/lotes/${lotId}/solicitacoes`, { method: 'POST', body: JSON.stringify({ estabelecimentoOngId: ong.id }) });
    showMessage('#dashboard-message', 'Solicitação enviada ao doador.'); await loadLots();
  } catch (error) { showMessage('#dashboard-message', error.message, true); }
}

async function loadRescues() {
  const list = $('#rescue-list'); list.innerHTML = '<div class="empty">Carregando resgates...</div>';
  try {
    const result = await api('/solicitacoes/minhas');
    list.innerHTML = result.data.length ? result.data.map((rescue) => {
      const reserve = state.user.perfil === 'doador' && rescue.status === 'solicitada'
        ? `<button class="button primary reserve-rescue" data-id="${rescue.id}">Reservar para ONG</button>` : '';
      const confirm = rescue.status === 'reservada'
        ? `<button class="button primary confirm-rescue" data-id="${rescue.id}">Confirmar entrega</button>` : '';
      const receipt = rescue.status === 'confirmada'
        ? `<button class="button secondary download-receipt" data-id="${rescue.id}">Baixar comprovante</button>` : '';
      return `<article class="rescue-card"><div><span class="status-pill ${rescue.status}">${escapeHtml(rescue.status)}</span>
        <h3>${escapeHtml(rescue.titulo)}</h3><div class="rescue-meta"><span>${rescue.quantidade} ${escapeHtml(rescue.unidade)}</span>
        <span>Doador: ${escapeHtml(rescue.estabelecimento_doador)}</span><span>ONG: ${escapeHtml(rescue.estabelecimento_ong)}</span>
        <span>Solicitado em ${formatDate(rescue.criado_em)}</span></div></div><div class="rescue-actions">${reserve}${confirm}${receipt}</div></article>`;
    }).join('') : '<div class="empty">Nenhum resgate encontrado para esta conta.</div>';
    $$('.reserve-rescue').forEach((button) => button.addEventListener('click', () => reserveRescue(button.dataset.id)));
    $$('.confirm-rescue').forEach((button) => button.addEventListener('click', () => confirmRescue(button.dataset.id)));
    $$('.download-receipt').forEach((button) => button.addEventListener('click', () => downloadReceipt(button.dataset.id)));
  } catch (error) { list.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
}

async function reserveRescue(id) {
  try {
    await api(`/solicitacoes/${id}/reserva`, { method: 'POST', body: '{}' });
    showMessage('#dashboard-message', 'Lote reservado para a ONG selecionada.'); await loadRescues();
  } catch (error) { showMessage('#dashboard-message', error.message, true); }
}

async function confirmRescue(id) {
  try {
    await api(`/solicitacoes/${id}/confirmacao`, { method: 'POST', body: '{}', headers: { 'Idempotency-Key': `web-${id}-${Date.now()}` } });
    showMessage('#dashboard-message', 'Entrega confirmada e comprovante gerado.'); await loadRescues();
  } catch (error) { showMessage('#dashboard-message', error.message, true); }
}

async function downloadReceipt(id) {
  try {
    const response = await fetch(`${apiBase}/solicitacoes/${id}/comprovante`, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message || 'Falha no download.'); }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = `comprovante-resgate-${id}.pdf`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  } catch (error) { showMessage('#dashboard-message', error.message, true); }
}

async function loadAdmin() {
  try {
    const [metrics, users] = await Promise.all([api('/admin/metricas'), api('/admin/usuarios')]);
    const values = [
      ['Usuários ativos', metrics.data.usuarios.ativos], ['Doadores', metrics.data.usuarios.doadores],
      ['ONGs', metrics.data.usuarios.ongs], ['Lotes resgatados', metrics.data.lotes.resgatados],
      ['Solicitações', metrics.data.resgates.total], ['Confirmados', metrics.data.resgates.confirmadas],
      ['ONGs atendidas', metrics.data.impacto.ongs_atendidas], ['Lotes disponíveis', metrics.data.lotes.disponiveis]
    ];
    $('#admin-metrics').innerHTML = values.map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${Number(value || 0)}</strong></article>`).join('');
    $('#admin-users').innerHTML = users.data.map((user) => `<tr><td>${escapeHtml(user.nome)}<small>${escapeHtml(user.email)}</small></td>
      <td><span class="status-pill">${escapeHtml(user.perfil)}</span></td><td>${user.ativo ? 'Ativo' : 'Inativo'}</td>
      <td>${formatDate(user.criado_em)}</td><td><button class="button secondary toggle-user" data-id="${user.id}" data-active="${user.ativo ? 'true' : 'false'}">${user.ativo ? 'Desativar' : 'Ativar'}</button></td></tr>`).join('');
    $$('.toggle-user').forEach((button) => button.addEventListener('click', () => toggleUser(button.dataset.id, button.dataset.active === 'true')));
  } catch (error) { showMessage('#dashboard-message', error.message, true); }
}

async function toggleUser(id, active) {
  try {
    await api(`/admin/usuarios/${id}/status`, { method: 'PATCH', body: JSON.stringify({ ativo: !active }) });
    showMessage('#dashboard-message', `Usuário ${active ? 'desativado' : 'ativado'}.`); await loadAdmin();
  } catch (error) { showMessage('#dashboard-message', error.message, true); }
}

async function loadAudit() {
  try {
    const result = await api('/admin/auditoria');
    $('#audit-list').innerHTML = result.data.length ? result.data.map((log) => `<tr><td>${formatDate(log.criado_em)}</td>
      <td>${escapeHtml(log.usuario_nome || 'Sistema')}<small>${escapeHtml(log.usuario_email || '')}</small></td>
      <td>${escapeHtml(log.acao)}</td><td>${escapeHtml(log.entidade)} #${log.entidade_id ?? '-'}</td>
      <td class="${log.resultado === 'sucesso' ? 'result-ok' : 'result-fail'}">${escapeHtml(log.resultado)}</td></tr>`).join('')
      : '<tr><td colspan="5">Nenhum log de auditoria encontrado.</td></tr>';
  } catch (error) { showMessage('#dashboard-message', error.message, true); }
}

async function downloadAdminReport() {
  try {
    const response = await fetch(`${apiBase}/admin/relatorios/resgates.pdf`, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message || 'Falha no relatório.'); }
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a');
    link.href = url; link.download = 'relatorio-resgates-food-rescue.pdf'; document.body.appendChild(link);
    link.click(); link.remove(); URL.revokeObjectURL(url);
  } catch (error) { showMessage('#dashboard-message', error.message, true); }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
function formatDate(value) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
const iso = (value) => new Date(value).toISOString();

$('#login-tab').addEventListener('click', () => setAuthTab('login'));
$('#register-tab').addEventListener('click', () => setAuthTab('register'));
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  try { storeSession(await api('/auth/login', { method: 'POST', body: JSON.stringify(data) })); await renderSession(); }
  catch (error) { $('#auth-message').textContent = error.message; $('#auth-message').classList.remove('hidden'); }
});
$('#register-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  delete data.privacidade; data.aceitouPoliticaPrivacidade = true; data.versaoPoliticaPrivacidade = '1.0';
  try { storeSession(await api('/auth/cadastro', { method: 'POST', body: JSON.stringify(data) })); await renderSession(); }
  catch (error) { $('#auth-message').textContent = error.message; $('#auth-message').classList.remove('hidden'); }
});
$('#forgot-password').addEventListener('click', async () => {
  const email = window.prompt('Digite o e-mail da sua conta:'); if (!email) return;
  try { await api('/auth/esqueci-senha', { method: 'POST', body: JSON.stringify({ email }), noRefresh: true });
    $('#auth-message').textContent = 'Se a conta existir, as instruções serão enviadas.'; $('#auth-message').classList.remove('hidden'); }
  catch (error) { $('#auth-message').textContent = error.message; $('#auth-message').classList.remove('hidden'); }
});
$$('.nav-item').forEach((button) => button.addEventListener('click', () => openPanel(button.dataset.panel)));
$('#show-establishment-form').addEventListener('click', () => $('#establishment-form').classList.remove('hidden'));
$('#cancel-establishment').addEventListener('click', () => $('#establishment-form').classList.add('hidden'));
$('#establishment-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); data.tipo = state.user.perfil;
  try { await api('/estabelecimentos', { method: 'POST', body: JSON.stringify(data) }); event.currentTarget.reset(); event.currentTarget.classList.add('hidden'); await loadEstablishments(); showMessage('#dashboard-message', 'Estabelecimento cadastrado.'); }
  catch (error) { showMessage('#dashboard-message', error.message, true); }
});
$('#lot-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  data.estabelecimentoDoadorId = Number(data.estabelecimentoDoadorId); data.quantidade = Number(data.quantidade);
  data.validadeEm = iso(data.validadeEm); data.retiradaInicioEm = iso(data.retiradaInicioEm); data.retiradaFimEm = iso(data.retiradaFimEm);
  try { await api('/lotes', { method: 'POST', body: JSON.stringify(data) }); event.currentTarget.reset(); showMessage('#dashboard-message', 'Lote publicado com sucesso.'); openPanel('overview'); }
  catch (error) { showMessage('#dashboard-message', error.message, true); }
});
$('#refresh-lots').addEventListener('click', loadLots);
$('#refresh-rescues').addEventListener('click', loadRescues);
$('#refresh-audit').addEventListener('click', loadAudit);
$('#download-admin-report').addEventListener('click', downloadAdminReport);
async function handleActionLink() {
  const query = new URLSearchParams(location.search);
  if (query.get('verificar')) { try { await api('/auth/verificar-email', { method: 'POST', body: JSON.stringify({ token: query.get('verificar') }), noRefresh: true }); alert('E-mail verificado com sucesso.'); } catch (error) { alert(error.message); } }
  if (query.get('redefinir')) { const senha = prompt('Digite sua nova senha (mínimo 10 caracteres):');
    if (senha) try { await api('/auth/redefinir-senha', { method: 'POST', body: JSON.stringify({ token: query.get('redefinir'), senha }), noRefresh: true }); alert('Senha redefinida. Entre novamente.'); } catch (error) { alert(error.message); } }
  if (query.size) history.replaceState({}, '', location.pathname);
}
await handleActionLink(); renderSession();
