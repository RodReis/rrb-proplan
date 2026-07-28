#!/usr/bin/env node
/**
 * Office3D Hook — cross-platform (Windows/Mac/Linux)
 * Encaminha eventos do Claude Code para o escritório 3D.
 *
 * Instalação: copie para <SEU_PROJETO>/.claude/hooks/office3d.js
 */

const http = require('http')
// NUNCA 'localhost': no Windows com Node >=17 ele resolve ::1 (IPv6) primeiro,
// mas o backend faz bind só em 127.0.0.1 → ECONNREFUSED silencioso (§8.1).
const OFFICE3D_URL = process.env.OFFICE3D_URL || 'http://127.0.0.1:3001'

// ── truncamento na origem (§10.1) ─────────────────────────────────────
// O backend usa no máx. ~120 chars de qualquer campo, mas o PostToolUse carrega
// o `tool_response` inteiro: um Read de arquivo grande, um grep ou um WebFetch
// viram megabytes. Acima do limite do express o evento era REJEITADO — e o que
// se perdia não era só a linha do feed: `isToolError` nunca via o erro (SEV não
// subia), a telemetria subcontava e o replay ficava furado. Truncar aqui é o
// único ponto onde o payload gigante ainda não saiu do processo.
const FIELD_MAX = 2000       // chars por campo string
const TODO_MAX = 200         // chars por item de todo
const PAYLOAD_MAX = 256 * 1024 // acima disso, só o esqueleto do evento

/** Chaves do tool_response que carregam erro/resumo — o resto é volume morto. */
const RESPONSE_KEYS = ['is_error', 'success', 'error', 'message', 'stderr']

const cut = (s, max) => (s.length > max ? s.slice(0, max) + '…' : s)

/** Trunca strings de um valor qualquer, preservando a forma (§10.1). */
function slimValue(v, max) {
  if (typeof v === 'string') return cut(v, max)
  if (Array.isArray(v)) return v.map((x) => slimValue(x, max))
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v)) out[k] = slimValue(v[k], max)
    return out
  }
  return v
}

/**
 * `todos` é dado estrutural do Plano de Guerra (§9.2): o diff depende de ter
 * TODOS os itens com seus status. Trunca só o texto — nunca descarta itens.
 */
function slimTodos(todos) {
  if (!Array.isArray(todos)) return todos
  return todos.map((t) => {
    if (!t || typeof t !== 'object') return t
    const out = { ...t }
    if (typeof out.content === 'string') out.content = cut(out.content, TODO_MAX)
    if (typeof out.activeForm === 'string') out.activeForm = cut(out.activeForm, TODO_MAX)
    return out
  })
}

/** tool_response: string cortada; objeto reduzido às chaves de erro/resumo. */
function slimResponse(r) {
  if (typeof r === 'string') return cut(r, FIELD_MAX)
  if (Array.isArray(r)) return slimValue(r, FIELD_MAX)
  if (r && typeof r === 'object') {
    const out = {}
    for (const k of RESPONSE_KEYS) {
      if (k in r) out[k] = slimValue(r[k], FIELD_MAX)
    }
    return out
  }
  return r
}

/**
 * Reduz o payload do hook ao que o backend realmente consome.
 * Função pura — é o que os testes exercitam.
 */
function slim(payload) {
  if (!payload || typeof payload !== 'object') return payload
  const out = { ...payload }

  if ('tool_response' in out) out.tool_response = slimResponse(out.tool_response)

  if (out.tool_input && typeof out.tool_input === 'object' && !Array.isArray(out.tool_input)) {
    const input = {}
    for (const k of Object.keys(out.tool_input)) {
      input[k] = k === 'todos'
        ? slimTodos(out.tool_input[k])
        : slimValue(out.tool_input[k], FIELD_MAX)
    }
    out.tool_input = input
  }

  // Cinto final: um tool_input com centenas de campos ainda estoura mesmo com
  // cada campo cortado. Aí vale mais o evento mínimo (tool + sessão, que é o
  // que move a sala) do que evento nenhum.
  if (Buffer.byteLength(JSON.stringify(out)) > PAYLOAD_MAX) {
    return {
      hook_event_name: out.hook_event_name,
      session_id: out.session_id,
      tool_name: out.tool_name,
      cwd: out.cwd,
      _truncated: true,
    }
  }
  return out
}

function preparePayload(payload, cwd = process.cwd()) {
  if (!payload || typeof payload !== 'object') return payload
  const out = { ...payload }
  if (!out.cwd) out.cwd = cwd
  // F1.2 (ANALISE-TROCA-ABAS): provider pela IDENTIDADE do hook, não por
  // heurística. Este arquivo só é instalado em `.claude/hooks` — tudo que
  // passa por aqui É Claude. A inferência antiga classificava eventos do
  // Claude sem `transcript_path` como codex, silenciava o watcher e criava
  // mismatch de provider no orquestrador.
  out.provider = 'claude'
  return slim(out)
}

// Permite `require()` nos testes sem disparar a leitura de stdin.
module.exports = { slim, slimValue, slimTodos, slimResponse, preparePayload }

function main() {
const chunks = []
process.stdin.on('data', (d) => chunks.push(d))
process.stdin.on('end', () => {
  const raw = Buffer.concat(chunks).toString('utf-8')

  // Garante o campo `cwd` no payload (RepoScanner da Fase 4 depende dele).
  // O Claude Code costuma injetar cwd; se faltar, usa o diretório do processo,
  // que é a raiz do projeto onde o hook roda.
  let payload = raw
  try {
    const obj = JSON.parse(raw)
    payload = JSON.stringify(preparePayload(obj)) // §10.1: corta na origem
  } catch (_) {
    // payload não-JSON: encaminha cru (nunca bloqueia o Claude Code)
  }

  // Sempre exit 0 — nunca bloqueia o Claude Code.
  // Precisa esperar o request terminar: process.exit() imediato mata
  // o socket antes de ele ser enviado e o evento se perde.
  const done = () => process.exit(0)

  try {
    const url = new URL('/hook', OFFICE3D_URL)
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port) || 3001,
        path: url.pathname,
        method: 'POST',
        family: 4, // força IPv4 mesmo se alguém apontar OFFICE3D_URL p/ localhost
        timeout: 1000, // backend lento nunca trava o Claude Code
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.resume() // drena a resposta para o socket fechar
        res.on('end', done)
      }
    )
    req.on('error', done) // backend off — segue a vida
    req.on('timeout', () => req.destroy())
    req.write(payload)
    req.end()
  } catch (_) {
    done()
  }
})
}

// Só lê stdin quando executado como hook de verdade; sob `require()` (testes)
// fica inerte, senão o processo de teste travaria esperando stdin fechar.
if (require.main === module) main()
