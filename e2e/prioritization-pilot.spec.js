import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';

// These cases write to the database. Run only against a disposable pilot database.
test.skip(process.env.E2E_PILOT !== '1', 'Set E2E_PILOT=1 against a disposable test database.');

const password = 'SenhaLocal#123';

function uniqueIdentity() {
  const id = crypto.randomUUID().replaceAll('-', '');
  return {
    email: `piloto.${id}@example.test`,
    document: (BigInt(`0x${id.slice(0, 16)}`) % 100000000000000n).toString().padStart(14, '0')
  };
}

async function ok(response) {
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
  return body;
}

async function register(request, role) {
  const identity = uniqueIdentity();
  const result = await ok(await request.post('/api/v1/auth/cadastro', { data: {
    nome: `Piloto ${role}`, email: identity.email, senha: password, perfil: role,
    versaoPoliticaPrivacidade: '1.0', aceitouPoliticaPrivacidade: true
  } }));
  return { token: result.accessToken, ...identity };
}

function auth(token) { return { Authorization: `Bearer ${token}` }; }

async function establishment(request, account, role) {
  const result = await ok(await request.post('/api/v1/estabelecimentos', {
    headers: auth(account.token),
    data: {
      tipo: role, nomeFantasia: `Estabelecimento ${role}`, documento: account.document,
      telefoneContato: '11999999999', cep: '01001000', logradouro: 'Praça da Sé',
      numero: '100', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP'
    }
  }));
  return result.data.id;
}

async function lot(request, donor, donorEstablishmentId) {
  const now = Date.now();
  const result = await ok(await request.post('/api/v1/lotes', {
    headers: auth(donor.token),
    data: {
      estabelecimentoDoadorId: donorEstablishmentId, titulo: 'Frutas do piloto',
      categoria: 'frutas_verduras', quantidade: 10, unidade: 'kg',
      validadeEm: new Date(now + 86400000).toISOString(),
      retiradaInicioEm: new Date(now + 3600000).toISOString(),
      retiradaFimEm: new Date(now + 7200000).toISOString()
    }
  }));
  return result.data.id;
}

async function rescueScenario(request) {
  const donor = await register(request, 'doador');
  const ong = await register(request, 'ong');
  const donorEstablishmentId = await establishment(request, donor, 'doador');
  const ongEstablishmentId = await establishment(request, ong, 'ong');
  const lotId = await lot(request, donor, donorEstablishmentId);
  const requested = await ok(await request.post(`/api/v1/lotes/${lotId}/solicitacoes`, {
    headers: auth(ong.token), data: { estabelecimentoOngId: ongEstablishmentId }
  }));
  return { donor, ong, lotId, requestId: requested.data.id };
}

test('piloto auth bloqueia acesso de doador à administração', async ({ request }) => {
  const donor = await register(request, 'doador');
  const response = await request.get('/api/v1/admin/metricas', { headers: auth(donor.token) });
  expect(response.status()).toBe(403);
});

test('piloto estabelecimentos lista o cadastro do próprio doador', async ({ request }) => {
  const donor = await register(request, 'doador');
  const id = await establishment(request, donor, 'doador');
  const response = await ok(await request.get('/api/v1/estabelecimentos/meus', { headers: auth(donor.token) }));
  expect(response.data.some((item) => item.id === id)).toBeTruthy();
});

test('piloto lotes mostra o lote disponível para uma ONG', async ({ request }) => {
  const donor = await register(request, 'doador');
  const ong = await register(request, 'ong');
  const id = await establishment(request, donor, 'doador');
  const lotId = await lot(request, donor, id);
  const response = await ok(await request.get('/api/v1/lotes', { headers: auth(ong.token) }));
  expect(response.data.some((item) => item.id === lotId)).toBeTruthy();
});

test('piloto reservas muda o estado da solicitação', async ({ request }) => {
  const scenario = await rescueScenario(request);
  const reserved = await ok(await request.post(`/api/v1/solicitacoes/${scenario.requestId}/reserva`, {
    headers: auth(scenario.donor.token), data: {}
  }));
  expect(reserved.data.status).toBe('reservada');
});

test('piloto confirmação gera comprovante PDF', async ({ request }) => {
  const scenario = await rescueScenario(request);
  await ok(await request.post(`/api/v1/solicitacoes/${scenario.requestId}/reserva`, {
    headers: auth(scenario.donor.token), data: {}
  }));
  const confirmed = await ok(await request.post(`/api/v1/solicitacoes/${scenario.requestId}/confirmacao`, {
    headers: { ...auth(scenario.ong.token), 'Idempotency-Key': crypto.randomUUID() }, data: {}
  }));
  expect(confirmed.data.status).toBe('confirmada');
  const pdf = await request.get(confirmed.data.comprovanteUrl, { headers: auth(scenario.ong.token) });
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
});
