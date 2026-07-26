#!/usr/bin/env node
/**
 * Office3D Hook — Codex.
 * Recebe o JSON de hook do Codex via stdin, normaliza para o contrato interno
 * do Office3D e encaminha para POST /hook.
 */

const http = require('http')
const OFFICE3D_URL = process.env.OFFICE3D_URL || 'http://127.0.0.1:3001'

const FIELD_MAX = 2000
const PAYLOAD_MAX = 256 * 1024
const KNOWN_EVENTS = new Set([
  'SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit',
  'Notification', 'Stop', 'SessionEnd', 'SubagentStart', 'SubagentStop',
])
const EVENT_ALIASES = {
  sessionstart: 'SessionStart',
  session_start: 'SessionStart',
  userpromptsubmit: 'UserPromptSubmit',
  user_prompt_submit: 'UserPromptSubmit',
  pretooluse: 'PreToolUse',
  pre_tool_use: 'PreToolUse',
  beforetooluse: 'PreToolUse',
  before_tool_use: 'PreToolUse',
  posttooluse: 'PostToolUse',
  post_tool_use: 'PostToolUse',
  aftertooluse: 'PostToolUse',
  after_tool_use: 'PostToolUse',
  notification: 'Notification',
  stop: 'Stop',
  sessionend: 'SessionEnd',
  session_end: 'SessionEnd',
  subagentstart: 'SubagentStart',
  subagent_start: 'SubagentStart',
  subagentstop: 'SubagentStop',
  subagent_stop: 'SubagentStop',
}
const TOOL_ALIASES = {
  'functions.exec_command': 'Bash',
  exec_command: 'Bash',
  'functions.write_stdin': 'Bash',
  write_stdin: 'Bash',
  'functions.apply_patch': 'apply_patch',
  apply_patch: 'apply_patch',
  'functions.view_image': 'view_image',
  view_image: 'view_image',
  'functions.update_plan': 'update_plan',
  update_plan: 'update_plan',
  'functions.get_goal': 'get_goal',
  get_goal: 'get_goal',
  'functions.update_goal': 'update_goal',
  update_goal: 'update_goal',
  'tool_search.tool_search_tool': 'tool_search_tool',
  tool_search_tool: 'tool_search_tool',
  'multi_tool_use.parallel': 'parallel',
  parallel: 'parallel',
  'image_gen.imagegen': 'imagegen',
  imagegen: 'imagegen',
  'web.run': 'WebSearch',
}

const cut = (s, max) => (s.length > max ? s.slice(0, max) + '…' : s)

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

function pickToolName(obj) {
  return (
    obj.tool_name ??
    obj.toolName ??
    obj.tool ??
    obj.name ??
    obj.params?.tool_name ??
    obj.params?.toolName ??
    obj.params?.tool
  )
}

function pickToolInput(obj) {
  return (
    obj.tool_input ??
    obj.toolInput ??
    obj.arguments ??
    obj.args ??
    obj.input ??
    obj.params?.tool_input ??
    obj.params?.arguments ??
    obj.params?.args ??
    {}
  )
}

function pickToolResponse(obj) {
  return (
    obj.tool_response ??
    obj.toolResponse ??
    obj.result ??
    obj.output ??
    obj.params?.tool_response ??
    obj.params?.result ??
    obj.params?.output
  )
}

function normalizeToolName(name) {
  if (typeof name !== 'string') return undefined
  const raw = name.trim()
  if (!raw) return undefined
  if (TOOL_ALIASES[raw]) return TOOL_ALIASES[raw]
  const bare = raw.includes('.') ? raw.split('.').pop() : raw
  return TOOL_ALIASES[bare] ?? raw
}

function canonicalEventName(value) {
  if (typeof value !== 'string') return undefined
  const raw = value.trim()
  if (!raw) return undefined
  if (KNOWN_EVENTS.has(raw)) return raw
  const compact = raw.replace(/[-\s]+/g, '_').toLowerCase()
  return EVENT_ALIASES[compact] ?? EVENT_ALIASES[compact.replace(/_/g, '')] ?? raw
}

function pickEventName(obj, fallback) {
  const candidates = [
    obj.hook_event_name,
    obj.event_name,
    obj.hookEventName,
    obj.hookEvent,
    obj.event,
    obj.params?.hook_event_name,
    obj.params?.event_name,
    obj.params?.hookEventName,
    fallback,
  ]
  const hit = candidates.find((v) => typeof v === 'string' && v.trim())
  return canonicalEventName(hit)
}

function normalize(obj) {
  const fallbackEvent = process.argv[2]
  const toolInput = pickToolInput(obj)
  const out = {
    ...obj,
    provider: 'codex',
    hook_event_name: pickEventName(obj, fallbackEvent),
    session_id: obj.session_id,
    cwd: obj.cwd || process.cwd(),
    transcript_path: obj.transcript_path ?? null,
    model: obj.model,
    permission_mode: obj.permission_mode,
    tool_name: normalizeToolName(pickToolName(obj)),
    tool_input: slimValue(toolInput, FIELD_MAX),
    tool_response: slimValue(pickToolResponse(obj), FIELD_MAX),
    prompt: obj.prompt ?? obj.user_prompt ?? obj.message ?? obj.params?.prompt,
    message: obj.message,
    subagent_type: obj.subagent_type ?? obj.params?.subagent_type,
  }

  if (Buffer.byteLength(JSON.stringify(out)) > PAYLOAD_MAX) {
    return {
      hook_event_name: out.hook_event_name,
      provider: 'codex',
      session_id: out.session_id,
      cwd: out.cwd,
      tool_name: out.tool_name,
      _truncated: true,
    }
  }
  return out
}

module.exports = { normalize, slimValue }

function main() {
  const chunks = []
  process.stdin.on('data', (d) => chunks.push(d))
  process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf-8')
    let payload = raw
    try {
      payload = JSON.stringify(normalize(JSON.parse(raw)))
    } catch (_) {
      // payload não JSON: encaminha cru e nunca bloqueia Codex.
    }

    const done = () => process.exit(0)

    try {
      const url = new URL('/hook', OFFICE3D_URL)
      const req = http.request(
        {
          hostname: url.hostname,
          port: Number(url.port) || 3001,
          path: url.pathname,
          method: 'POST',
          family: 4,
          timeout: 1000,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          res.resume()
          res.on('end', done)
        }
      )
      req.on('error', done)
      req.on('timeout', () => req.destroy())
      req.write(payload)
      req.end()
    } catch (_) {
      done()
    }
  })
}

if (require.main === module) main()
