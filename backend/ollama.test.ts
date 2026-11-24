import { afterEach, describe, expect, it, vi } from 'vitest'
import { OllamaCollector, ollamaInternals } from './ollama.js'
import { estimateLogMetrics, parseGoDuration, parseOllamaLog } from './ollama-log.js'

afterEach(() => vi.unstubAllGlobals())

describe('Ollama local detection', () => {
  it('accepts loopback hosts and refuses remote endpoints', () => {
    expect(ollamaInternals.localOllamaHost('localhost:11434')).toBe('http://localhost:11434')
    expect(() => ollamaInternals.localOllamaHost('https://example.com')).toThrow('Remote Ollama hosts are blocked')
  })

  it('fails closed when a remote Ollama host is configured', async () => {
    const collector = new OllamaCollector('https://example.com')
    expect(collector.host).toBe('http://127.0.0.1:11434')
    const result = await collector.sample()
    expect(result.running).toBe(false)
    expect(result.error).toContain('Remote Ollama hosts are blocked')
  })

  it('parses multiple loaded models without guessing the backend from the name', () => {
    const models = [
      ollamaInternals.loadedModel({ name: 'qwen-mlx:35b', size: 20_000, details: { family: 'qwen', parameter_size: '35B', quantization_level: 'Q4_K_M' }, context_length: 262144 }),
      ollamaInternals.loadedModel({ name: 'gemma:12b', size_vram: 10_000, details: { family: 'gemma', backend: 'MLX' } }),
    ]
    expect(models).toHaveLength(2)
    expect(models[0].backend.value).toBeNull()
    expect(models[0].contextLength.value).toBe(262144)
    expect(models[0].contextLength.quality).toBe('measured')
    expect(models[0].sizeBytes.quality).toBe('estimated')
    expect(models[1].backend.value).toBe('MLX')
    expect(models[1].backend.quality).toBe('measured')
    expect(models[1].vramBytes.value).toBe(10_000)
  })

  it('uses mocked localhost API responses to report the running and unavailable states', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/ps')) return Response.json({ models: [{ name: 'model-a', size: 4096 }] })
      return Response.json({ version: '0.test' })
    }))
    const running = await new OllamaCollector().sample()
    expect(running.running).toBe(true)
    expect(running.models).toHaveLength(1)
    expect(running.version).toBe('0.test')

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused') }))
    const unavailable = await new OllamaCollector().sample()
    expect(unavailable.running).toBe(false)
    expect(unavailable.models).toEqual([])
    expect(unavailable.error).toContain('connection refused')
  })
})
describe('Ollama server log capture', () => {
  const log = [
    'time=2026-10-24T22:18:00.100-06:00 level=TRACE source=routes.go:3349 msg="builtin parser output" parser=qwen3.5 content="" thinking=The toolCalls=[] done=false',
    'time=2026-10-24T22:18:00.200-06:00 level=TRACE source=routes.go:3349 msg="builtin parser output" parser=qwen3.5 content="" thinking=" user" toolCalls=[] done=false',
    'time=2026-10-24T22:18:00.300-06:00 level=TRACE source=routes.go:3349 msg="builtin parser output" parser=qwen3.5 content=" hi" thinking="" toolCalls=[] done=false',
    'time=2026-10-24T22:18:00.400-06:00 level=TRACE source=routes.go:3349 msg="builtin parser output" parser=qwen3.5 content="" thinking="" toolCalls=[] done=true',
    '[GIN] 2026/10/24 - 22:18:01 | 200 |    1.5s |       127.0.0.1 | POST     "/api/chat"',
    '[GIN] 2026/10/24 - 22:18:02 | 200 |    51.6ms |       127.0.0.1 | GET      "/api/ps"',
  ].join('\n')

  it('extracts completed inference requests and streamed chunks', () => {
    const parsed = parseOllamaLog(log)
    expect(parsed.tokens).toHaveLength(3)
    expect(parsed.requests).toHaveLength(1)
    expect(parsed.requests[0].durationMs).toBe(1500)
    expect(parsed.requests[0].path).toBe('/api/chat')
  })

  it('estimates generation speed from chunk timestamps and labels it estimated', () => {
    const parsed = parseOllamaLog(log)
    const request = { endedAt: Date.parse('2026-10-24T22:18:01.000-06:00'), durationMs: 1500, path: '/api/chat' }
    const metrics = estimateLogMetrics(request, parsed.tokens)
    expect(metrics.outputTokens.value).toBe(3)
    expect(metrics.outputTokens.quality).toBe('estimated')
    expect(metrics.generationSpeed.value).toBeCloseTo(10, 0)
    expect(metrics.prefillSpeed.value).toBeNull()
  })

  it('parses Go durations', () => {
    expect(parseGoDuration('1m30.5s')).toBe(90_500)
    expect(parseGoDuration('644.6ms')).toBeCloseTo(644.6)
    expect(parseGoDuration('17.292µs')).toBeCloseTo(0.017292)
    expect(parseGoDuration('bogus')).toBeNull()
  })
})
