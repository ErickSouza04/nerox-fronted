/**
 * Testes automatizados — Fluxo de Cadastro e Login
 * Estratégia: extrai o bloco de script AUTH do index.html e o
 * executa em um contexto vm isolado com DOM (jsdom) e fetch mockado.
 */

const fs   = require('fs')
const path = require('path')
const vm   = require('vm')

// ─── Extração do script AUTH ───────────────────────────────────────────────
const HTML_PATH = path.resolve(__dirname, '../index.html')

function extractAuthScript(html) {
  const lines = html.split('\n')
  // Bloco principal de <script> até o início do DASHBOARD
  const scriptStart = lines.findIndex(l => l.trim() === '<script>') + 1
  // Para logo antes da seção DASHBOARD (linha com "// DASHBOARD - carrega dados")
  const scriptEnd = lines.findIndex(
    (l, i) => i > scriptStart && l.includes('DASHBOARD - carrega dados')
  )
  return lines.slice(scriptStart, scriptEnd).join('\n')
}

const rawScript = extractAuthScript(fs.readFileSync(HTML_PATH, 'utf-8'))

// ─── HTML mínimo necessário ────────────────────────────────────────────────
const MINIMAL_HTML = `
<div class="auth-tab active"></div>
<div class="auth-tab"></div>
<div id="auth-screen">
  <!-- LOGIN -->
  <div id="auth-login" class="auth-step active">
    <div id="login-erro" class="auth-error"></div>
    <input id="login-email" type="email">
    <input id="login-senha" type="password">
    <button class="auth-btn">Entrar no Nexor</button>
    <button class="auth-btn-secondary">Modo demo</button>
  </div>
  <!-- CADASTRO Etapa 1 -->
  <div id="auth-cad-1" class="auth-step">
    <div id="cad-erro-1" class="auth-error"></div>
    <input id="cad-nome"  type="text">
    <input id="cad-email" type="email">
    <input id="cad-senha" type="password">
  </div>
  <!-- CADASTRO Etapa 2 -->
  <div id="auth-cad-2" class="auth-step">
    <div id="cad-erro-2" class="auth-error">Selecione uma categoria para continuar.</div>
    <div class="categoria-card"></div>
  </div>
  <!-- CADASTRO Etapa 3 -->
  <div id="auth-cad-3" class="auth-step">
    <div id="cad-erro-3" class="auth-error">Selecione uma opção para continuar.</div>
    <div class="fat-opt"></div>
    <button id="btn-finalizar">🚀 Criar minha conta grátis</button>
  </div>
</div>
`

// ─── Auxiliares ────────────────────────────────────────────────────────────

/** Cria e avalia o script no contexto vm, retornando o sandbox */
function loadScript(fetchMock) {
  const sandbox = {
    // DOM / Browser APIs
    document:    global.document,
    window:      global,
    localStorage: global.localStorage,
    fetch:       fetchMock,
    setTimeout:  (...a) => setTimeout(...a),
    clearTimeout:(...a) => clearTimeout(...a),
    Promise,
    JSON,
    parseFloat,
    String,
    console: { log:()=>{}, warn:()=>{}, error:()=>{} },

    // Stubs para funções do dashboard (definidas mais adiante no script)
    aplicarStatusPlano: jest.fn(),
    aplicarUsuarioUI:   jest.fn(),
    iniciarDashboard:   jest.fn(),
    atualizarHeroHora:  jest.fn(),
    initPerf30Chart:    jest.fn(),
    mostrarBoasVindas:  jest.fn(),
    fazerLogout:        jest.fn(),
    drawGauge:          jest.fn(),

    // Chart.js não disponível fora do browser (seguro pelo guard no script)
    Chart: undefined,
  }
  vm.createContext(sandbox)
  vm.runInContext(rawScript, sandbox)
  return sandbox
}

/** Monta resposta fake da API */
function makeApiResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

/** Preenche um input pelo id */
function fillInput(id, value) {
  document.getElementById(id).value = value
}

/** Verifica se o elemento de erro está visível com determinado texto */
function erroVisivel(id, texto) {
  const el = document.getElementById(id)
  return el.classList.contains('show') && el.textContent.includes(texto)
}

// ══════════════════════════════════════════════════════════════════════════
// TESTES
// ══════════════════════════════════════════════════════════════════════════

describe('mostrarErroAuth — fix do timer', () => {
  let sb

  beforeEach(() => {
    document.body.innerHTML = MINIMAL_HTML
    localStorage.clear()
    jest.useFakeTimers()
    sb = loadScript(jest.fn())
  })

  afterEach(() => jest.useRealTimers())

  test('exibe a mensagem e adiciona classe "show"', () => {
    const el = document.getElementById('cad-erro-1')
    sb.mostrarErroAuth(el, 'Mensagem de erro')
    expect(el.classList.contains('show')).toBe(true)
    expect(el.textContent).toBe('Mensagem de erro')
  })

  test('remove "show" após 4 s', () => {
    const el = document.getElementById('cad-erro-1')
    sb.mostrarErroAuth(el, 'Erro')
    jest.advanceTimersByTime(4000)
    expect(el.classList.contains('show')).toBe(false)
  })

  test('segunda chamada cancela o timer da primeira (bug fix)', () => {
    const el = document.getElementById('cad-erro-1')
    sb.mostrarErroAuth(el, 'Primeiro erro')
    jest.advanceTimersByTime(2000)           // metade do tempo

    sb.mostrarErroAuth(el, 'Segundo erro')  // cancela timer anterior
    jest.advanceTimersByTime(2000)           // chegaria ao fim do timer antigo
    // erro ainda deve estar visível (timer reiniciou)
    expect(el.classList.contains('show')).toBe(true)
    expect(el.textContent).toBe('Segundo erro')

    jest.advanceTimersByTime(2100)           // fim do timer novo
    expect(el.classList.contains('show')).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────────────

describe('Cadastro — validação Etapa 1 (avancarEtapa)', () => {
  let sb

  beforeEach(() => {
    document.body.innerHTML = MINIMAL_HTML
    localStorage.clear()
    sb = loadScript(jest.fn())
  })

  test('nome vazio → exibe "Digite seu nome."', async () => {
    fillInput('cad-nome', '')
    fillInput('cad-email', 'teste@teste.com')
    fillInput('cad-senha', 'Senha123!')
    await sb.avancarEtapa(2)
    expect(erroVisivel('cad-erro-1', 'Digite seu nome')).toBe(true)
  })

  test('e-mail inválido → exibe "Digite um e-mail válido."', async () => {
    fillInput('cad-nome', 'Maria Clara')
    fillInput('cad-email', 'emailinvalido')
    fillInput('cad-senha', 'Senha123!')
    await sb.avancarEtapa(2)
    expect(erroVisivel('cad-erro-1', 'e-mail válido')).toBe(true)
  })

  test('senha com menos de 8 chars → exibe "Senha: mínimo 8 caracteres."', async () => {
    fillInput('cad-nome', 'Maria Clara')
    fillInput('cad-email', 'maria@teste.com')
    fillInput('cad-senha', '1234567')
    await sb.avancarEtapa(2)
    expect(erroVisivel('cad-erro-1', 'mínimo 8')).toBe(true)
  })

  test('dados válidos → avança para Etapa 2', async () => {
    fillInput('cad-nome', 'Maria Clara')
    fillInput('cad-email', 'maria@teste.com')
    fillInput('cad-senha', 'Senha123!')
    await sb.avancarEtapa(2)
    expect(document.getElementById('auth-cad-2').classList.contains('active')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────

describe('Cadastro — validação Etapa 2 (categoria)', () => {
  let sb

  beforeEach(() => {
    document.body.innerHTML = MINIMAL_HTML
    localStorage.clear()
    sb = loadScript(jest.fn())
  })

  test('sem categoria selecionada → exibe erro e NÃO avança', async () => {
    // cadCategoria está vazio (estado inicial)
    await sb.avancarEtapa(3)
    expect(document.getElementById('cad-erro-2').classList.contains('show')).toBe(true)
    expect(document.getElementById('auth-cad-3').classList.contains('active')).toBe(false)
  })

  test('com categoria selecionada → avança para Etapa 3', async () => {
    vm.runInContext("cadCategoria = 'Alimentação e Confeitaria'", sb)
    await sb.avancarEtapa(3)
    expect(document.getElementById('auth-cad-3').classList.contains('active')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────

describe('Cadastro — finalizarCadastro (API)', () => {
  let fetchMock, sb

  beforeEach(() => {
    document.body.innerHTML = MINIMAL_HTML
    localStorage.clear()
    fetchMock = jest.fn()
    sb = loadScript(fetchMock)
    // Pré-preenche etapas 1-2-3
    fillInput('cad-nome', 'Guilherme Phellipe')
    fillInput('cad-email', 'guilherme@teste.com')
    fillInput('cad-senha', 'Senha123!')
    vm.runInContext(
      "cadCategoria = 'Alimentação e Confeitaria'; cadFaturamento = 'Até R$ 1.000/mês'",
      sb
    )
  })

  test('sem faturamento selecionado → exibe erro e NÃO chama API', async () => {
    vm.runInContext("cadFaturamento = ''", sb)
    await sb.finalizarCadastro()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(document.getElementById('cad-erro-3').classList.contains('show')).toBe(true)
  })

  test('API retorna sucesso → salva sessão no localStorage', async () => {
    const fakeUser = { nome: 'Guilherme Phellipe', email: 'guilherme@teste.com', plano: 'ativo' }
    fetchMock.mockReturnValue(makeApiResponse({ token: 'tok123', refresh_token: 'ref456', usuario: fakeUser }))

    await sb.finalizarCadastro()

    expect(localStorage.getItem('nexor_token')).toBe('tok123')
    expect(localStorage.getItem('nexor_refresh')).toBe('ref456')
    expect(JSON.parse(localStorage.getItem('nexor_usuario')).email).toBe('guilherme@teste.com')
  })

  test('API 409 (e-mail duplicado) → mensagem "já está cadastrado" na Etapa 1', async () => {
    fetchMock.mockReturnValue(makeApiResponse({ erro: 'E-mail já cadastrado' }, 409))
    await sb.finalizarCadastro()
    expect(erroVisivel('cad-erro-1', 'já está cadastrado')).toBe(true)
    expect(document.getElementById('auth-cad-1').classList.contains('active')).toBe(true)
  })

  test('API retorna "Dados inválidos" → mensagem orientativa na Etapa 1', async () => {
    fetchMock.mockReturnValue(makeApiResponse({ erro: 'Dados inválidos' }, 400))
    await sb.finalizarCadastro()
    expect(erroVisivel('cad-erro-1', 'Verifique nome')).toBe(true)
    expect(document.getElementById('auth-cad-1').classList.contains('active')).toBe(true)
  })

  test('outro erro da API → exibe mensagem genérica da API na Etapa 1', async () => {
    fetchMock.mockReturnValue(makeApiResponse({ erro: 'Servidor indisponível' }, 500))
    await sb.finalizarCadastro()
    expect(erroVisivel('cad-erro-1', 'Servidor indisponível')).toBe(true)
  })

  test('erro de rede → exibe "Erro de conexão"', async () => {
    fetchMock.mockReturnValue(Promise.resolve(null)) // simula falha de rede
    await sb.finalizarCadastro()
    expect(erroVisivel('cad-erro-3', 'Erro de conexão')).toBe(true)
  })

  test('envia os campos corretos para a API', async () => {
    fetchMock.mockReturnValue(makeApiResponse({ token: 't', refresh_token: 'r', usuario: {} }))
    await sb.finalizarCadastro()

    const call = fetchMock.mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.nome).toBe('Guilherme Phellipe')
    expect(body.email).toBe('guilherme@teste.com')
    expect(body.tipo_negocio).toBe('Alimentação e Confeitaria')
    expect(body.faturamento_medio).toBe('Até R$ 1.000/mês')
    expect(call[1].method).toBe('POST')
  })

  test('botão volta ao estado original após erro', async () => {
    fetchMock.mockReturnValue(makeApiResponse({ erro: 'Dados inválidos' }, 400))
    await sb.finalizarCadastro()
    const btn = document.getElementById('btn-finalizar')
    expect(btn.disabled).toBe(false)
    expect(btn.textContent).toContain('Criar minha conta grátis')
  })
})

// ──────────────────────────────────────────────────────────────────────────

describe('Login — fazerLogin', () => {
  let fetchMock, sb

  beforeEach(() => {
    document.body.innerHTML = MINIMAL_HTML
    localStorage.clear()
    fetchMock = jest.fn()
    sb = loadScript(fetchMock)
  })

  test('e-mail ou senha vazios → exibe erro sem chamar API', async () => {
    fillInput('login-email', '')
    fillInput('login-senha', '')
    await sb.fazerLogin()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(erroVisivel('login-erro', 'Preencha e-mail e senha')).toBe(true)
  })

  test('somente senha vazia → exibe erro sem chamar API', async () => {
    fillInput('login-email', 'user@teste.com')
    fillInput('login-senha', '')
    await sb.fazerLogin()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('login com sucesso → salva token e dados do usuário', async () => {
    const fakeUser = { nome: 'Guilherme', email: 'g@teste.com', plano: 'ativo' }
    fetchMock.mockReturnValue(makeApiResponse({ token: 'abc', refresh_token: 'xyz', usuario: fakeUser }))
    fillInput('login-email', 'g@teste.com')
    fillInput('login-senha', 'Senha123!')
    await sb.fazerLogin()
    expect(localStorage.getItem('nexor_token')).toBe('abc')
    expect(localStorage.getItem('nexor_refresh')).toBe('xyz')
    expect(JSON.parse(localStorage.getItem('nexor_usuario')).nome).toBe('Guilherme')
  })

  test('credenciais erradas (401) → exibe mensagem de erro', async () => {
    fetchMock.mockReturnValue(makeApiResponse({ erro: 'E-mail ou senha incorretos.' }, 401))
    fillInput('login-email', 'errado@teste.com')
    fillInput('login-senha', 'SenhaErrada1')
    await sb.fazerLogin()
    expect(erroVisivel('login-erro', 'incorretos')).toBe(true)
    expect(localStorage.getItem('nexor_token')).toBeNull()
  })

  test('outro erro da API → exibe mensagem do servidor', async () => {
    fetchMock.mockReturnValue(makeApiResponse({ erro: 'Conta bloqueada.' }, 403))
    fillInput('login-email', 'bloqueado@teste.com')
    fillInput('login-senha', 'Senha123!')
    await sb.fazerLogin()
    expect(erroVisivel('login-erro', 'Conta bloqueada')).toBe(true)
  })

  test('erro de rede → exibe "Erro de conexão"', async () => {
    fetchMock.mockReturnValue(Promise.resolve(null))
    fillInput('login-email', 'user@teste.com')
    fillInput('login-senha', 'Senha123!')
    await sb.fazerLogin()
    expect(erroVisivel('login-erro', 'Erro de conexão')).toBe(true)
  })

  test('envia e-mail e senha corretos para o endpoint de login', async () => {
    fetchMock.mockReturnValue(makeApiResponse({ token: 't', refresh_token: 'r', usuario: {} }))
    fillInput('login-email', 'user@teste.com')
    fillInput('login-senha', 'Senha123!')
    await sb.fazerLogin()
    const call = fetchMock.mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.email).toBe('user@teste.com')
    expect(body.senha).toBe('Senha123!')
    expect(call[0]).toContain('/auth/login')
  })
})

// ──────────────────────────────────────────────────────────────────────────

describe('salvarSessao', () => {
  let sb

  beforeEach(() => {
    document.body.innerHTML = MINIMAL_HTML
    localStorage.clear()
    sb = loadScript(jest.fn())
  })

  test('persiste token, refresh e usuário no localStorage', () => {
    const usuario = { nome: 'Ana', email: 'ana@teste.com', plano: 'ativo' }
    sb.salvarSessao({ token: 'tok', refresh_token: 'ref', usuario })
    expect(localStorage.getItem('nexor_token')).toBe('tok')
    expect(localStorage.getItem('nexor_refresh')).toBe('ref')
    expect(JSON.parse(localStorage.getItem('nexor_usuario')).nome).toBe('Ana')
  })
})
