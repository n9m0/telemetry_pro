import { open, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { metric } from '../src/shared/metrics.js'
import type { RequestMetrics } from '../src/shared/metrics.js'

export interface LogRequest {
  endedAt: number
  durationMs: number
  path: string
}

export interface LogTokenEvent { at: number }

const INFERENCE_PATHS = new Set(['/api/chat', '/api/generate', '/v1/chat/completions', '/v1/completions'])
const DURATION_UNITS: Record<string, number> = { 'ns': 1e-6, 'µs': 1e-3, 'us': 1e-3, 'ms': 1, 's': 1000, 'm': 60_000, 'h': 3_600_000 }

export function parseGoDuration(value: string): number | null {
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ns|µs|us|ms|s|m|h)/g)]
  if (!parts.length || parts.map((part) => part[0]).join('') !== value.trim()) return null
  return parts.reduce((sum, part) => sum + Number(part[1]) * DURATION_UNITS[part[2]], 0)
}

// Ollama's server log is the only place direct (non-proxied) requests leave a trace. Completed
// requests appear as `[GIN] 2026/10/24 - 22:18:46 | 200 | 29.87s | 127.0.0.1 | POST "/api/chat"`
// (local time, second resolution), and when trace logging is enabled every streamed chunk is logged
// as `builtin parser output`.
export function parseOllamaLog(text: string): { requests: LogRequest[]; tokens: LogTokenEvent[] } {
  const requests: LogRequest[] = []
  const tokens: LogTokenEvent[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith('[GIN]')) {
      const gin = line.match(/^\[GIN\] (\d{4})\/(\d{2})\/(\d{2}) - (\d{2}):(\d{2}):(\d{2}) \|\s*(\d{3}) \|\s*(\S+) \|[^|]*\|\s*POST\s+"([^"?]+)/)
      if (!gin || gin[7] !== '200' || !INFERENCE_PATHS.has(gin[9])) continue
      const durationMs = parseGoDuration(gin[8])
      const endedAt = new Date(Number(gin[1]), Number(gin[2]) - 1, Number(gin[3]), Number(gin[4]), Number(gin[5]), Number(gin[6])).getTime()
      if (durationMs !== null && Number.isFinite(endedAt)) requests.push({ endedAt, durationMs, path: gin[9] })
      continue
    }
    if (!line.includes('msg="builtin parser output"')) continue
    const at = Date.parse(line.match(/^time=(\S+)/)?.[1] ?? '')
    if (!Number.isFinite(at)) continue
    const content = line.match(/ content=("(?:[^"\\]|\\.)*"|\S*)/)?.[1] ?? '""'
    const thinking = line.match(/ thinking=("(?:[^"\\]|\\.)*"|\S*)/)?.[1] ?? '""'
    if (content !== '""' || thinking !== '""') tokens.push({ at })
  }
  return { requests, tokens }
}

// Estimates request metrics from the streamed-chunk timestamps inside the request window.
// Chunk counts approximate tokens, so everything derived from them is labelled estimated.
export function estimateLogMetrics(request: LogRequest, tokens: LogTokenEvent[]): RequestMetrics {
  const startedAt = request.endedAt - request.durationMs
  const inWindow = tokens.filter((token) => token.at >= startedAt - 1000 && token.at <= request.endedAt + 1000)
  const unavailable = (unit: string, source: string) => metric<number>(null, unit, 'unavailable', source)
  const estimated = (value: number, unit: string) => metric(value, unit, 'estimated', 'ollama_server_log_stream_chunks')
  const first = inWindow[0]?.at
  const last = inWindow.at(-1)?.at
  const generationMs = first !== undefined && last !== undefined ? last - first : 0
  return {
    promptTokens: unavailable('tokens', 'ollama_server_log_has_no_prompt_counts'),
    outputTokens: inWindow.length ? estimated(inWindow.length, 'tokens') : unavailable('tokens', 'ollama_trace_logging_disabled'),
    prefillSpeed: unavailable('tok/s', 'ollama_server_log_has_no_prompt_counts'),
    generationSpeed: inWindow.length > 1 && generationMs > 0 ? estimated(((inWindow.length - 1) / generationMs) * 1000, 'tok/s') : unavailable('tok/s', 'ollama_trace_logging_disabled'),
    totalDuration: metric(request.durationMs / 1000, 's', 'measured', 'ollama_server_log_request_time'),
    modelLoadDuration: unavailable('s', 'ollama_server_log_has_no_load_time'),
    // A first chunk before the request began belongs to another concurrent stream.
    ttft: first !== undefined && first >= startedAt ? estimated(Math.max(0, first - startedAt), 'ms') : unavailable('ms', 'ollama_trace_logging_disabled'),
  }
}

export interface LogCapture { request: LogRequest; metrics: RequestMetrics }

export class OllamaLogWatcher {
  private offset: number | null = null
  private tokens: LogTokenEvent[] = []
  private pendingRequests: LogRequest[] = []
  private reading = false

  constructor(
    private readonly onRequest: (capture: LogCapture) => Promise<void> | void,
    private readonly file = join(homedir(), '.ollama', 'logs', 'server.log'),
  ) {}

  // Live generation rate from streamed chunks seen in the last few seconds; null when none were seen.
  liveRate(now = Date.now(), windowMs = 3000): number | null {
    const count = this.tokens.reduce((sum, token) => sum + (token.at > now - windowMs && token.at <= now + 1000 ? 1 : 0), 0)
    return count > 0 ? count / (windowMs / 1000) : null
  }

  // Reads only what was appended since the last poll; history from before startup is ignored.
  async poll(): Promise<void> {
    if (this.reading) return
    this.reading = true
    try {
      const info = await stat(this.file).catch(() => null)
      if (!info) return
      if (this.offset === null || info.size < this.offset) {
        this.offset = this.offset === null ? info.size : 0
        if (this.offset === info.size) return
      }
      const length = Math.min(info.size - this.offset, 16 * 1024 * 1024)
      if (length <= 0) return
      const handle = await open(this.file, 'r')
      try {
        const buffer = Buffer.alloc(length)
        await handle.read(buffer, 0, length, this.offset)
        const text = buffer.toString('utf8')
        // Hold back a trailing partial line until the next poll.
        const complete = text.lastIndexOf('\n') + 1
        this.offset += Buffer.byteLength(text.slice(0, complete))
        const parsed = parseOllamaLog(text.slice(0, complete))
        this.tokens.push(...parsed.tokens)
        this.pendingRequests.push(...parsed.requests)
      } finally {
        await handle.close()
      }
      const horizon = Date.now() - 30 * 60_000
      this.tokens = this.tokens.filter((token) => token.at >= horizon)
      const requests = this.pendingRequests
      this.pendingRequests = []
      for (const request of requests) {
        const metrics = estimateLogMetrics(request, this.tokens)
        // Sub-second requests without streamed output are keep-alive or unload pings, not inference.
        if (metrics.outputTokens.value === null && request.durationMs < 1000) continue
        await this.onRequest({ request, metrics })
      }
    } catch {
      // The log is optional; failures leave proxy-based capture unaffected.
    } finally {
      this.reading = false
    }
  }
}
