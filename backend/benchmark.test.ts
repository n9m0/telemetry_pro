import { describe, expect, it, vi } from 'vitest'
import { BenchmarkRunner } from './benchmark.js'
import type { BenchmarkDependencies } from './benchmark.js'
import { metric } from '../src/shared/metrics.js'

const configuration = {
  model: 'model-a',
  prompt: 'Write a short test response.',
  contextSize: 4096,
  runs: 2,
  outputTokens: 32,
  warmup: false,
}

function dependencies(overrides: Partial<BenchmarkDependencies> = {}): BenchmarkDependencies {
  return {
    installedModels: async () => ['model-a'],
    modelIsLoaded: async () => false,
    generate: async () => ({ eval_count: 24, eval_duration: 400_000_000, prompt_eval_count: 100, prompt_eval_duration: 50_000_000, total_duration: 500_000_000, ttftMs: 90 }),
    telemetry: () => ({
      memory: metric<number>(null, 'bytes', 'unavailable', 'test'),
      temperature: metric<number>(null, 'celsius', 'unavailable', 'test'),
      fanRpm: metric<number>(null, 'RPM', 'unavailable', 'test'),
      powerWatts: metric<number>(null, 'W', 'unavailable', 'test'),
      thermalPressure: metric<string>(null, '', 'unavailable', 'test'),
    }),
    version: () => 'test-version',
    save: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('local benchmark runner', () => {
  it('runs model requests sequentially and records cold then warm runs', async () => {
    let active = 0
    let peakActive = 0
    const runner = new BenchmarkRunner(dependencies({
      generate: async () => {
        active += 1
        peakActive = Math.max(peakActive, active)
        await Promise.resolve()
        active -= 1
        return { eval_count: 24, eval_duration: 400_000_000, ttftMs: 90 }
      },
    }))
    runner.start(configuration)
    await vi.waitFor(() => expect(runner.state.running).toBe(false))
    expect(peakActive).toBe(1)
    expect(runner.history[0].samples.map((sample) => sample.mode)).toEqual(['cold_start', 'warm_run'])
    expect(runner.history[0].peakTemperature.value).toBeNull()
    expect(runner.history[0].peakTemperature.quality).toBe('unavailable')
  })

  it('cancels the active request cleanly', async () => {
    const runner = new BenchmarkRunner(dependencies({
      generate: (_model, _prompt, _context, _tokens, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    }))
    runner.start(configuration)
    runner.cancel()
    await vi.waitFor(() => expect(runner.state.running).toBe(false))
    expect(runner.history[0].status).toBe('cancelled')
  })

  it('records missing-model benchmark failures without downloading a model', async () => {
    const runner = new BenchmarkRunner(dependencies({ installedModels: async () => [] }))
    runner.start(configuration)
    await vi.waitFor(() => expect(runner.state.running).toBe(false))
    expect(runner.history[0].status).toBe('failed')
    expect(runner.history[0].failureReason).toContain('never pull models')
    expect(runner.history[0].samples).toHaveLength(0)
  })

  it('stops when macOS reports serious thermal pressure', async () => {
    const generate = vi.fn(async () => ({ eval_count: 20, eval_duration: 1_000_000_000, ttftMs: null }))
    const runner = new BenchmarkRunner(dependencies({
      telemetry: () => ({
        memory: metric<number>(null, 'bytes', 'unavailable', 'test'),
        temperature: metric<number>(null, 'celsius', 'unavailable', 'test'),
        fanRpm: metric<number>(null, 'RPM', 'unavailable', 'test'),
        powerWatts: metric<number>(null, 'W', 'unavailable', 'test'),
        thermalPressure: metric('critical', '', 'measured', 'macos_thermal_pressure'),
      }),
      generate,
    }))
    runner.start(configuration)
    await vi.waitFor(() => expect(runner.state.running).toBe(false))
    expect(runner.history[0].status).toBe('cancelled')
    expect(runner.history[0].failureReason).toContain('critical thermal pressure')
    expect(generate).not.toHaveBeenCalled()
  })
})