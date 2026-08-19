import { expect, test } from '@playwright/test';

const unique = Date.now().toString();
const password = 'SenhaLocal#123';
let donorToken, ongToken, donorEstablishmentId, ongEstablishmentId, lotId, requestId;

async function json(response) {
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
  return body;
}

test.describe.serial('fluxo crítico Food Rescue', () => {
  test('cadastra doador e ONG', async ({ request }) => {
    const donor = await json(await request.post('/api/v1/auth/cadastro', { data: {
      nome: 'Doador E2E', email: `doador.${unique}@example.test`, senha: password,
      perfil: 'doador', versaoPoliticaPrivacidade: '1.0', aceitouPoliticaPrivacidade: true }}));
    const ong = await json(await request.post('/api/v1/auth/cadastro', { data: {
      nome: 'ONG E2E', email: `ong.${unique}@example.test`, senha: password,
      perfil: 'ong', versaoPoliticaPrivacidade: '1.0', aceitouPoliticaPrivacidade: true }}));
    donorToken = donor.accessToken; ongToken = ong.accessToken;
    const forbidden = await request.get('/api/v1/admin/metricas', {
      headers: { Authorization: `Bearer ${donorToken}` }
    });
    expect(forbidden.status()).toBe(403);
  });

  test('cadastra estabelecimentos', async ({ request }) => {
    const base = { telefoneContato: '11999999999', cep: '01001000', logradouro: 'Praça da Sé',
      numero: '100', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' };
    const donor = await json(await request.post('/api/v1/estabelecimentos', {
      headers: { Authorization: `Bearer ${donorToken}` }, data: { ...base, tipo: 'doador',
        nomeFantasia: 'Mercado E2E', documento: unique.padStart(14, '1').slice(-14) }}));
    const ong = await json(await request.post('/api/v1/estabelecimentos', {
      headers: { Authorization: `Bearer ${ongToken}` }, data: { ...base, tipo: 'ong',
        nomeFantasia: 'ONG E2E', documento: (`2${unique}`).padStart(14, '2').slice(-14) }}));
    donorEstablishmentId = donor.data.id; ongEstablishmentId = ong.data.id;
  });

  test('doador cadastra lote', async ({ request }) => {
    const now = Date.now();
    const body = await json(await request.post('/api/v1/lotes', {
      headers: { Authorization: `Bearer ${donorToken}` }, data: {
        estabelecimentoDoadorId: donorEstablishmentId, titulo: 'Frutas E2E',
        categoria: 'frutas_verduras', quantidade: 10, unidade: 'kg',
        validadeEm: new Date(now + 86_400_000).toISOString(),
        retiradaInicioEm: new Date(now + 3_600_000).toISOString(),
        retiradaFimEm: new Date(now + 7_200_000).toISOString() }}));
    lotId = body.data.id;
  });

  test('ONG solicita e doador reserva', async ({ request }) => {
    const requested = await json(await request.post(`/api/v1/lotes/${lotId}/solicitacoes`, {
      headers: { Authorization: `Bearer ${ongToken}` }, data: { estabelecimentoOngId: ongEstablishmentId }}));
    requestId = requested.data.id;
    const reserved = await json(await request.post(`/api/v1/solicitacoes/${requestId}/reserva`, {
      headers: { Authorization: `Bearer ${donorToken}` }, data: {} }));
    expect(reserved.data.status).toBe('reservada');
    const donorRescues = await json(await request.get('/api/v1/solicitacoes/minhas', {
      headers: { Authorization: `Bearer ${donorToken}` } }));
    expect(donorRescues.data.some((item) => item.id === requestId && item.status === 'reservada')).toBeTruthy();
  });

  test('confirma e baixa comprovante PDF', async ({ request }) => {
    const confirmed = await json(await request.post(`/api/v1/solicitacoes/${requestId}/confirmacao`, {
      headers: { Authorization: `Bearer ${ongToken}`, 'Idempotency-Key': `e2e-${unique}` }, data: {} }));
    expect(confirmed.data.status).toBe('confirmada');
    const pdf = await request.get(confirmed.data.comprovanteUrl, { headers: { Authorization: `Bearer ${ongToken}` } });
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
    const ongRescues = await json(await request.get('/api/v1/solicitacoes/minhas', {
      headers: { Authorization: `Bearer ${ongToken}` } }));
    expect(ongRescues.data.some((item) => item.id === requestId && item.status === 'confirmada')).toBeTruthy();
  });

  test('rotaciona e revoga o refresh token', async ({ request }) => {
    const login = await request.post('/api/v1/auth/login', { data: { email: `doador.${unique}@example.test`, senha: password } });
    expect(login.ok()).toBeTruthy();
    const refreshed = await request.post('/api/v1/auth/refresh');
    expect(refreshed.ok()).toBeTruthy();
    expect((await refreshed.json()).accessToken).toBeTruthy();
    expect((await request.post('/api/v1/auth/logout')).status()).toBe(204);
    expect((await request.post('/api/v1/auth/refresh')).status()).toBe(401);
  });
});
