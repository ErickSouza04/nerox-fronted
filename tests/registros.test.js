/**
 * Testes automatizados — Fluxo de Registros (Venda e Despesa)
 * Cobre: registro otimístico, persistência na tabela e atualização do dashboard.
 */

const fs   = require('fs')
const path = require('path')
const vm   = require('vm')

const HTML_PATH = path.resolve(__dirname, '../index.html')

// ─── Extração de seções do script ─────────────────────────────────────────

function extractSection(html, fromComment, toComment) {
  const lines = html.split('\n')
  const from  = lines.findIndex(l => l.includes(fromComment))
  const to    = lines.findIndex((l, i) => i > from && l.includes(toComment))
  return lines.slice(from, to).join('\n')
}

function extractScript(html) {
  const lines = html.split('\n')
  const scriptStart = lines.findIndex(l => l.trim() === '<script>') + 1
  // Para antes da seção de onboarding (depois dos registros)
  const scriptEnd   = lines.findIndex(
    (l, i) => i > scriptStart && l.includes('ONBOARDING - Boas-vindas')
  )
  return lines.slice(scriptStart, scriptEnd).join('\n')
}

const htmlContent  = fs.readFileSync(HTML_PATH, 'utf-8')
const rawScript    = extractScript(htmlContent)

// ─── HTML mínimo com tabela, hero e campos de registro ───────────────────

const DASHBOARD_HTML = `
<div class="auth-tab"></div>
<div class="auth-tab"></div>
<div id="auth-screen" class="hidden"></div>

<!-- Dashboard hero -->
<div id="hero-lucro">R$ 1.000,00</div>
<div id="hero-receita">R$ 2.000,00</div>
<div id="hero-despesas">R$ 1.000,00</div>
<div id="hero-receita-badge">+5%</div>
<div data-target="1000" data-prefix="" data-suffix="">1000</div>
<div data-target="1000" data-prefix="" data-suffix="">1000</div>
<div data-target="1000" data-prefix="" data-suffix="">1000</div>
<div data-target="10"   data-prefix="" data-suffix="%">10%</div>
<div class="stats-grid">
  <div class="badge-up">↑5%</div>
  <div class="badge-down">↓2%</div>
  <div class="badge-up">↑3%</div>
  <div class="badge-up">↑1%</div>
</div>
<div class="progress-fill" style="width:50%"></div>
<div class="meta-current">R$ 500,00</div>

<!-- Histórico -->
<table><tbody id="tabela-registros">
  <tr class="demo-row"><td>01/03</td><td>Demo</td><td>Venda</td><td>+R$ 100,00</td></tr>
</tbody></table>
<div id="top-products-list">Demo produto</div>
<div id="recent-list-dash">Demo recente</div>
<div id="dicas-dashboard">Demo dica</div>

<!-- Campos de venda -->
<input id="val-venda"   type="number" value="150">
<select id="cat-venda"><option value="Produto">Produto</option></select>
<select id="pag-venda"><option value="Pix">Pix</option></select>
<input id="data-venda"  type="date"   value="2026-03-17">
<div id="modo-avulso" style="display:none"></div>
<input id="prod-avulso-input" value="">
<select id="select-produto-cadastrado"><option value="">Selecione</option></select>
<div id="produto-preview" style="display:none"></div>

<!-- Campos de despesa -->
<input id="val-despesa"  type="number" value="50">
<select id="cat-despesa"><option value="Fixas">Fixas</option></select>
<select id="pag-despesa"><option value="Pix">Pix</option></select>
<input id="desc-despesa" type="text"   value="Aluguel">
<input id="data-despesa" type="date"   value="2026-03-17">

<!-- Extras exigidos pelo script -->
<canvas id="gaugeCanvas" width="200" height="200"></canvas>
<div id="gaugeNum">0</div>
<div id="page-subtitle"></div>
<span id="idx-margem"></span><span id="idx-dias"></span>
<span id="idx-crescimento"></span><span id="idx-despesas"></span>
<span id="proj-receita-val"></span><span id="proj-lucro-val"></span>
`

// ─── Sandbox factory ──────────────────────────────────────────────────────

function buildSandbox(fetchMock, token = 'fake-token') {
  return {
    document:     global.document,
    window:       global,
    localStorage: global.localStorage,
    fetch:        fetchMock,
    setTimeout:   (...a) => setTimeout(...a),
    clearTimeout: (...a) => clearTimeout(...a),
    Promise, JSON, parseFloat, String, Math,
    Date,
    performance:  { now: () => Date.now() },
    requestAnimationFrame: (fn) => setTimeout(fn, 16),
    console: { log:()=>{}, warn:()=>{}, error:()=>{} },

    // Stubs de funções fora do escopo extraído
    iniciarDashboard:   jest.fn(),
    agendarDashboard:   jest.fn(),
    aplicarStatusPlano: jest.fn(),
    aplicarUsuarioUI:   jest.fn(),
    atualizarHeroHora:  jest.fn(),
    initEvolucao30Chart: jest.fn(),
    mostrarBoasVindas:  jest.fn(),
    fazerLogout:        jest.fn(),
    drawGauge:          jest.fn(),

    // Mock de Chart.js (CDN) — precisa ser construtor válido com defaults e getChart
    Chart: Object.assign(
      class ChartMock {
        constructor() {
          this.data = { labels: [], datasets: [{ data: [], backgroundColor: [] }] }
          this.options = {}
        }
        update()  {}
        destroy() {}
      },
      {
        defaults: { font: { family: '' }, color: '' },
        getChart: () => null,
      }
    ),

    // Dados iniciais
    _token: token,
  }
}

function loadScript(fetchMock, token = 'fake-token') {
  const sb = buildSandbox(fetchMock, token)
  vm.createContext(sb)

  // Injeta token antes do script rodar
  vm.runInContext(`
    // garante que localStorage tem token para App inicializar autenticado
  `, sb)

  localStorage.setItem('nexor_token', token)
  localStorage.setItem('nexor_usuario', JSON.stringify({ nome: 'Teste', email: 'teste@x.com', plano: 'ativo' }))

  vm.runInContext(rawScript, sb)

  // O script define as funções reais no sandbox, sobrescrevendo os stubs.
  // Salvamos as funções reais e depois substituímos por mocks rastreáveis.
  sb._realIniciarDashboard = sb.iniciarDashboard
  sb._realAgendarDashboard = sb.agendarDashboard
  sb.agendarDashboard = jest.fn()
  sb.iniciarDashboard = jest.fn()

  return sb
}

// ─── Resposta API fake ────────────────────────────────────────────────────

function ok(body)   { return Promise.resolve({ ok:true,  status:200, json:()=>Promise.resolve(body) }) }
function fail(body) { return Promise.resolve({ ok:false, status:400, json:()=>Promise.resolve(body) }) }

// ══════════════════════════════════════════════════════════════════════════

describe('registrarVenda', () => {
  let fetchMock, sb

  beforeEach(() => {
    document.body.innerHTML = DASHBOARD_HTML
    localStorage.clear()
    fetchMock = jest.fn().mockReturnValue(ok({ id: 1 }))
    sb = loadScript(fetchMock)
  })

  test('adiciona linha na tabela antes da chamada à API', async () => {
    const tbody = document.getElementById('tabela-registros')
    const rowsBefore = tbody.rows.length

    // Inicia registro (não aguarda — queremos checar estado síncrono)
    const promise = sb.registrarVenda()
    expect(tbody.rows.length).toBeGreaterThan(rowsBefore)

    await promise
  })

  test('a linha otimista contém o valor formatado', async () => {
    await sb.registrarVenda()
    const tbody = document.getElementById('tabela-registros')
    const html   = tbody.innerHTML
    expect(html).toContain('150')      // valor
    expect(html).toContain('Venda')    // tipo
  })

  test('limpa o campo de valor após registrar', async () => {
    await sb.registrarVenda()
    expect(document.getElementById('val-venda').value).toBe('')
  })

  test('chama a API com os dados corretos', async () => {
    await sb.registrarVenda()
    expect(fetchMock).toHaveBeenCalled()
    const call = fetchMock.mock.calls.find(c => c[0].includes('/vendas'))
    expect(call).toBeTruthy()
    const body = JSON.parse(call[1].body)
    expect(body.valor).toBe(150)
    expect(body.pagamento).toBe('Pix')
  })

  test('dispara agendarDashboard após salvar', async () => {
    await sb.registrarVenda()
    expect(sb.agendarDashboard).toHaveBeenCalled()
  })

  test('valor inválido (0) → NÃO chama API', async () => {
    document.getElementById('val-venda').value = '0'
    await sb.registrarVenda()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────────────────

describe('registrarDespesa', () => {
  let fetchMock, sb

  beforeEach(() => {
    document.body.innerHTML = DASHBOARD_HTML
    localStorage.clear()
    fetchMock = jest.fn().mockReturnValue(ok({ id: 2 }))
    sb = loadScript(fetchMock)
  })

  test('adiciona linha na tabela antes da chamada à API', async () => {
    const tbody = document.getElementById('tabela-registros')
    const rowsBefore = tbody.rows.length
    const promise = sb.registrarDespesa()
    expect(tbody.rows.length).toBeGreaterThan(rowsBefore)
    await promise
  })

  test('a linha otimista contém o valor e tipo Despesa', async () => {
    await sb.registrarDespesa()
    const html = document.getElementById('tabela-registros').innerHTML
    expect(html).toContain('50')
    expect(html).toContain('Despesa')
  })

  test('limpa o campo de valor após registrar', async () => {
    await sb.registrarDespesa()
    expect(document.getElementById('val-despesa').value).toBe('')
  })

  test('chama a API com os dados corretos', async () => {
    await sb.registrarDespesa()
    const call = fetchMock.mock.calls.find(c => c[0].includes('/despesas'))
    expect(call).toBeTruthy()
    const body = JSON.parse(call[1].body)
    expect(body.valor).toBe(50)
    expect(body.descricao).toBe('Aluguel')
  })

  test('dispara agendarDashboard após salvar', async () => {
    await sb.registrarDespesa()
    expect(sb.agendarDashboard).toHaveBeenCalled()
  })

  test('valor inválido (vazio) → NÃO chama API', async () => {
    document.getElementById('val-despesa').value = ''
    await sb.registrarDespesa()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────────────────

describe('iniciarDashboard — linha otimista NÃO some no refresh (bug fix)', () => {
  let fetchMock, sb

  const dashResumoDB = {
    dados: {
      faturamento: 1500, total_despesas: 500, lucro: 1000, margem: 66,
      ticket_medio: 150, ticket_medio_anterior: 140,
      progresso_meta: 50,
      variacao: { faturamento: 10, despesas: 5, lucro: 15 },
    }
  }

  function makeDashFetch() {
    return jest.fn(url => {
      if (url.includes('/dashboard/resumo'))  return ok(dashResumoDB)
      if (url.includes('/dashboard/indice'))  return ok({ dados: { margem_liquida:66, dias_para_meta:10, crescimento:15, concentracao_despesas:30 } })
      if (url.includes('/dashboard/diario'))  return ok({ dados: [] })
      if (url.includes('/vendas'))    return ok({ dados: [] })
      if (url.includes('/despesas'))  return ok({ dados: [] })
      if (url.includes('/produtos/top')) return ok({ dados: [] })
      return ok({})
    })
  }

  beforeEach(() => {
    document.body.innerHTML = DASHBOARD_HTML
    localStorage.clear()
    fetchMock = makeDashFetch()
    sb = loadScript(fetchMock)

    // Restaura as funções reais salvas em loadScript
    sb.iniciarDashboard = sb._realIniciarDashboard
    sb.agendarDashboard = sb._realAgendarDashboard
    sb.drawGauge = () => {}
  })

  test('primeiro carregamento limpa dados demo e exibe "Carregando registros..."', async () => {
    // _lastDashLoad === 0 → primeiro carregamento
    expect(vm.runInContext('_lastDashLoad', sb)).toBe(0)

    const dashPromise = sb.iniciarDashboard()
    // Imediatamente após iniciar, a tabela deve mostrar "Carregando"
    expect(document.getElementById('tabela-registros').textContent).toContain('Carregando')

    await dashPromise
  })

  test('refresh (após primeiro load) NÃO limpa a tabela com "Carregando..."', async () => {
    // Simula primeiro carregamento já completo
    vm.runInContext('_lastDashLoad = Date.now()', sb)

    // Adiciona uma linha otimista
    const tbody = document.getElementById('tabela-registros')
    const tr = document.createElement('tr')
    tr.id = 'linha-otimista'
    tr.innerHTML = '<td>17/03</td><td>Produto Teste</td><td>Venda</td><td>+R$ 150,00</td>'
    tbody.prepend(tr)

    // Dispara refresh do dashboard
    await sb.iniciarDashboard()

    // A linha otimista NÃO deve ter sido substituída por "Carregando..."
    expect(document.getElementById('tabela-registros').textContent).not.toContain('Carregando registros')
  })

  test('refresh NÃO reseta hero-lucro para R$ 0,00', async () => {
    vm.runInContext('_lastDashLoad = Date.now()', sb)

    document.getElementById('hero-lucro').textContent = 'R$ 1.000,00'

    await sb.iniciarDashboard()

    // Não deve ter sido zerado durante o refresh
    expect(document.getElementById('hero-lucro').textContent).not.toBe('R$ 0,00')
  })

  test('após refresh a tabela é atualizada com dados reais da API', async () => {
    vm.runInContext('_lastDashLoad = Date.now()', sb)

    // Simula API retornando um registro real
    fetchMock.mockImplementation(url => {
      if (url.includes('/vendas')) return ok({ dados: [{ data:'2026-03-17', produto:'Produto API', valor:200, _tipo:'venda' }] })
      if (url.includes('/despesas')) return ok({ dados: [] })
      if (url.includes('/dashboard/resumo')) return ok(dashResumoDB)
      if (url.includes('/dashboard/indice')) return ok({ dados: { margem_liquida:66, dias_para_meta:10, crescimento:15, concentracao_despesas:30 } })
      if (url.includes('/dashboard/diario')) return ok({ dados: [] })
      return ok({})
    })

    await sb.iniciarDashboard()

    // A tabela deve conter o registro vindo da API
    expect(document.getElementById('tabela-registros').innerHTML).toContain('Produto API')
  })
})
