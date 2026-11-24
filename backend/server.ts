import express from 'express'
import { createServer } from 'node:http'
import { performance } from 'node:perf_hooks'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { BenchmarkHistory } from './benchmark-history.js'
import { BenchmarkRunner } from './benchmark.js'
import { MacCollector } from './collectors.js'
import { SessionHistory } from './history.js'
import { OllamaCollector } from './ollama.js'
import { OllamaLogWatcher } from './ollama-log.js'
import type { Snapshot } from './types.js'
import { metric, ollamaRequestMetrics } from '../src/shared/metrics.js'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 4174)
if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
  throw new Error('The monitoring server only supports loopback HOST values.')
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.')

const collector = new MacCollector()
const ollama = new OllamaCollector()
const history = new SessionHistory()
const app = express()
const server = createServer(app)
const clients = new Set<express.Response>()
const chartHistory: Snapshot['history'] = []
let snapshot: Snapshot | null = null
let latestVersion: string | null = null
const benchmarkHistory = new BenchmarkHistory()
const benchmark = new BenchmarkRunner({
  installedModels: async () => {
    const response = await fetch(`${ollama.host}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status} while listing installed models.`)
    const data = await response.json() as { models?: Array<{ name?: string; model?: string }> }
    return (data.models ?? []).flatMap((model) => typeof model.name === 'string' ? [model.name] : typeof model.model === 'string' ? [model.model] : [])
  },
  modelIsLoaded: async (model) => (await ollama.sample()).models.some((entry) => entry.name === model),
  generate: async (model, prompt, context, outputTokens, signal) => {
    const started = performance.now()
    const response = await fetch(`${ollama.host}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: true, options: { num_ctx: context, num_predict: outputTokens } }),
      signal,
    })
    if (!response.ok) throw new Error(`Ollama benchmark request failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
    if (!response.body) throw new Error('Ollama returned no benchmark response stream.')
    const decoder = new StringDecoder('utf8')
    let remainder = ''
    let firstContentAt: number | null = null
    let finalEvent: Record<string, unknown> | null = null
    const handleLine = (line: string) => {
      try {
        const event = JSON.parse(line) as Record<string, unknown>
        if (typeof event.response === 'string' && event.response.length > 0 && firstContentAt === null) firstContentAt = performance.now()
        if (event.done === true) finalEvent = event
      } catch {
        // Keep partial transport lines until the next chunk.
      }
    }
    for await (const chunk of response.body) {
      remainder += decoder.write(Buffer.from(chunk))
      const lines = remainder.split('\n')
      remainder = lines.pop() ?? ''
      for (const line of lines) handleLine(line.trim())
    }
    remainder += decoder.end()
    if (remainder) handleLine(remainder.trim())
    if (!finalEvent) throw new Error('Ollama finished without returning timing statistics.')
    return {
      ...(finalEvent as Record<string, unknown>),
      ttftMs: firstContentAt === null ? null : firstContentAt - started,
    }
  },
  telemetry: () => ({
    memory: snapshot?.memory.usedBytes ?? metric<number>(null, 'bytes', 'unavailable', 'system_sample_unavailable'),
    temperature: snapshot?.thermal.cpuTemperature ?? metric<number>(null, 'celsius', 'unavailable', 'system_sample_unavailable'),
    fanRpm: snapshot?.thermal.fanRpm ?? metric<number>(null, 'RPM', 'unavailable', 'system_sample_unavailable'),
    powerWatts: snapshot?.thermal.powerWatts ?? metric<number>(null, 'W', 'unavailable', 'system_sample_unavailable'),
    thermalPressure: snapshot?.thermal.pressure ?? metric<string>(null, '', 'unavailable', 'system_sample_unavailable'),
  }),
  version: () => latestVersion,
  save: (result) => benchmarkHistory.add(result),
})

let lastBenchmarkActivity = 0
const logWatcher = new OllamaLogWatcher(async ({ request, metrics }) => {
  if (benchmark.state.running || Date.now() - lastBenchmarkActivity < 5000) return
  const known = await history.list()
  // Requests forwarded by the proxy are also logged by Ollama; the proxy's exact record wins.
  const duplicate = known.some((session) => session.origin !== 'server_log'
    && Math.abs(session.startedAt + (session.metrics.totalDuration.value ?? 0) * 1000 - request.endedAt) <= 2500)
  if (duplicate) return
  // The most recently used loaded model has the latest keep-alive expiry.
  const loaded = (await ollama.sample()).models
  const model = [...loaded].sort((a, b) => Date.parse(b.expiresAt ?? '') - Date.parse(a.expiresAt ?? ''))[0]?.name ?? 'Unknown model'
  await history.add({
    id: randomUUID(),
    model,
    startedAt: request.endedAt - request.durationMs,
    metrics,
    ollamaVersion: latestVersion,
    origin: 'server_log',
  })
})

app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))

function publish(): void {
  if (!snapshot) return
  const frame = `data: ${JSON.stringify(snapshot)}\n\n`
  for (const client of clients) client.write(frame)
}

async function refresh(): Promise<void> {
  const [system, modelState] = await Promise.all([
    collector.sample().catch(() => null),
    ollama.sample(),
  ])
  if (!system) return
  latestVersion = modelState.version
  const liveRate = logWatcher.liveRate()
  const liveGeneration = liveRate === null
    ? metric<number>(null, 'tok/s', 'unavailable', 'no_streamed_chunks_in_ollama_log')
    : metric(liveRate, 'tok/s', 'estimated', 'ollama_server_log_stream_chunks')
  // Streams that bypass the proxy are only visible through the log's chunk activity.
  if (liveRate !== null && modelState.status === 'IDLE') modelState.status = 'GENERATING'
  chartHistory.push({
    timestamp: system.timestamp,
    cpu: system.cpu.total.value,
    gpu: system.gpu.utilization.value,
    memory: system.memory.usedBytes.value,
    swap: system.memory.swapBytes.value,
    generation: liveRate ?? 0,
  })
  if (chartHistory.length > 300) chartHistory.shift()
  snapshot = { ...system, ollama: modelState, liveGeneration, historyRevision: history.revision, history: [...chartHistory] }
  publish()
}

app.get('/api/health', (_request, response) => response.json({ ok: true, host, port }))
app.get('/api/snapshot', async (_request, response) => {
  if (!snapshot) await refresh()
  response.json(snapshot)
})
app.get('/api/stream', async (_request, response) => {
  response.setHeader('Content-Type', 'text/event-stream')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('Connection', 'keep-alive')
  response.flushHeaders()
  clients.add(response)
  if (!snapshot) await refresh()
  if (snapshot) response.write(`data: ${JSON.stringify(snapshot)}\n\n`)
  response.on('close', () => clients.delete(response))
})
app.get('/api/history', async (_request, response) => response.json(await history.list()))
app.delete('/api/history', async (_request, response) => {
  await history.clear()
  response.status(204).end()
})
app.get('/api/models', async (_request, response) => {
  try {
    const upstream = await fetch(`${ollama.host}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!upstream.ok) throw new Error(`Ollama returned HTTP ${upstream.status}`)
    const data = await upstream.json() as { models?: Array<{ name?: string; model?: string; size?: number }> }
    response.json((data.models ?? []).flatMap((model) => {
      const name = typeof model.name === 'string' ? model.name : model.model
      return typeof name === 'string' ? [{ name, size: model.size ?? null }] : []
    }))
  } catch {
    response.status(503).json({ error: 'Ollama is unavailable on localhost.' })
  }
})
app.get('/api/benchmark/status', (_request, response) => response.json(benchmark.state))
app.get('/api/benchmark/results', async (_request, response) => response.json(await benchmarkHistory.list()))
app.post('/api/benchmark', (request, response) => {
  try {
    benchmark.start(request.body)
    response.status(202).json(benchmark.state)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Benchmark could not be started.'
    response.status(message.includes('already running') ? 409 : 400).json({ error: message })
  }
})
app.post('/api/benchmark/cancel', (_request, response) => {
  benchmark.cancel()
  response.status(202).json(benchmark.state)
})

app.use('/ollama', async (request, response) => {
  const path = request.originalUrl.slice('/ollama'.length)
  if (!path.startsWith('/api/')) {
    response.status(404).json({ error: 'Only Ollama API routes are proxied.' })
    return
  }
  const isInference = request.method === 'POST' && /^\/api\/(generate|chat)$/.test(path.split('?')[0])
  const startedAt = Date.now()
  const startClock = performance.now()
  const body = request.method === 'GET' ? undefined : JSON.stringify(request.body ?? {})
  const controller = new AbortController()
  response.on('close', () => {
    if (!response.writableEnded) controller.abort()
  })
  if (isInference) {
    ollama.activeRequests += 1
    ollama.requestStatus = request.body?.stream === false ? 'LOADING' : 'PREFILL'
  }
  try {
    const upstream = await fetch(`${ollama.host}${path}`, {
      method: request.method,
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    })
    response.status(upstream.status)
    const contentType = upstream.headers.get('content-type')
    if (contentType) response.setHeader('content-type', contentType)
    if (!isInference || !upstream.body) {
      if (upstream.body) for await (const chunk of upstream.body) response.write(chunk)
      response.end()
      return
    }

    let remainder = ''
    const decoder = new StringDecoder('utf8')
    let firstContentAt: number | undefined
    let result: Record<string, unknown> | null = null
    const model = typeof request.body?.model === 'string' ? request.body.model : 'Unknown model'
    const handleLine = (line: string) => {
      try {
        const event = JSON.parse(line) as Record<string, unknown>
        const message = typeof event.message === 'object' && event.message !== null
          ? event.message as Record<string, unknown>
          : null
        const text = typeof event.response === 'string' ? event.response : typeof message?.content === 'string' ? message.content : ''
        if (text && firstContentAt === undefined) {
          firstContentAt = performance.now()
          ollama.requestStatus = 'GENERATING'
        }
        if (event.done === true) result = event
      } catch {
        // Ignore partial or non-JSON lines while preserving the original stream.
      }
    }

    for await (const chunk of upstream.body) {
      const data = Buffer.from(chunk)
      response.write(data)
      remainder += decoder.write(data)
      const lines = remainder.split('\n')
      remainder = lines.pop() ?? ''
      for (const line of lines) handleLine(line.trim())
    }
    remainder += decoder.end()
    if (remainder) handleLine(remainder.trim())
    response.end()
    if (result) {
      const measuredTtft = firstContentAt === undefined ? undefined : firstContentAt - startClock
      await history.add({
        id: randomUUID(),
        model,
        startedAt,
        metrics: ollamaRequestMetrics(result, measuredTtft),
        ollamaVersion: latestVersion,
      })
    }
  } catch (error) {
    if (!response.headersSent) response.status(502).json({ error: error instanceof Error ? error.message : 'Ollama proxy failed.' })
  else response.end()
  } finally {
    if (isInference) {
      ollama.activeRequests = Math.max(0, ollama.activeRequests - 1)
      if (ollama.activeRequests === 0) ollama.requestStatus = 'IDLE'
    }
  }
})

if (process.env.NODE_ENV === 'production') {
  const dist = join(process.cwd(), 'dist')
  app.use(express.static(dist))
  app.use((_request, response) => response.sendFile(join(dist, 'index.html')))
}

server.listen(port, host, () => {
  console.log(`Mac System Monitor listening at http://${host}:${port}`)
})

void refresh()
const sampleTimer = setInterval(() => void refresh(), 1000)
const logTimer = setInterval(() => {
  if (benchmark.state.running) lastBenchmarkActivity = Date.now()
  void logWatcher.poll()
}, 1000)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(sampleTimer)
    clearInterval(logTimer)
    for (const client of clients) client.end()
    server.close(() => process.exit(0))
  })
}