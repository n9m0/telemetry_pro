import { randomUUID } from 'node:crypto'
import { metric, ollamaRequestMetrics } from '../src/shared/metrics.js'
import type { Metric, OllamaTimings } from '../src/shared/metrics.js'
import { benchmarkContexts } from '../src/shared/benchmark.js'
import type { BenchmarkConfig, BenchmarkResult, BenchmarkState } from '../src/shared/benchmark.js'

export interface BenchmarkTelemetry {
  memory: Metric<number>
  temperature: Metric<number>
  fanRpm: Metric<number>
  powerWatts: Metric<number>
  thermalPressure: Metric<string>
}

export interface BenchmarkDependencies {
  installedModels: () => Promise<string[]>
  modelIsLoaded: (model: string) => Promise<boolean>
  generate: (model: string, prompt: string, context: number, outputTokens: number, signal: AbortSignal) => Promise<OllamaTimings & { ttftMs: number | null }>
  telemetry: () => BenchmarkTelemetry
  version: () => string | null
  save: (result: BenchmarkResult) => Promise<void>
}

interface TelemetrySample {
  memory: Metric<number>
  temperature: Metric<number>
  fanRpm: Metric<number>
  powerWatts: Metric<number>
  thermalPressure: Metric<string>
}

export function validateBenchmarkConfig(value: unknown): BenchmarkConfig {
  if (!value || typeof value !== 'object') throw new Error('Benchmark settings are required.')
  const config = value as Partial<BenchmarkConfig>
  if (typeof config.model !== 'string' || config.model.length < 1 || config.model.length > 200) throw new Error('Select an installed model.')
  if (typeof config.prompt !== 'string' || config.prompt.trim().length < 1 || config.prompt.length > 4000) throw new Error('Prompt must contain 1 to 4,000 characters.')
  const contextSize = config.contextSize
  const runs = config.runs
  const outputTokens = config.outputTokens
  if (typeof contextSize !== 'number' || !benchmarkContexts.includes(contextSize as typeof benchmarkContexts[number])) throw new Error('Unsupported context preset.')
  if (typeof runs !== 'number' || !Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('Run count must be between 1 and 10.')
  if (typeof outputTokens !== 'number' || !Number.isInteger(outputTokens) || outputTokens < 1 || outputTokens > 1024) throw new Error('Output target must be between 1 and 1,024 tokens.')
  return {
    model: config.model,
    prompt: config.prompt.trim(),
    contextSize,
    runs,
    outputTokens,
    warmup: config.warmup === true,
  }
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null)
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null
}

function summarize(values: Metric<number>[], unit: string, reducer: (samples: number[]) => number): Metric<number> {
  const available = values.filter((value) => value.value !== null)
  return metric(
    available.length ? reducer(available.map((value) => value.value as number)) : null,
    unit,
    available[0]?.quality ?? 'unavailable',
    available[0]?.source ?? 'sensor_unavailable',
  )
}

export class BenchmarkRunner {
  private controller: AbortController | null = null
  private currentState: BenchmarkState = { running: false, model: null, completed: 0, total: 0, phase: 'idle', warning: null }
  private results: BenchmarkResult[] = []

  constructor(private readonly dependencies: BenchmarkDependencies) {}

  get state(): BenchmarkState { return { ...this.currentState } }
  get history(): BenchmarkResult[] { return [...this.results].reverse() }

  start(input: unknown): void {
    if (this.controller) throw new Error('A benchmark is already running.')
    const config = validateBenchmarkConfig(input)
    this.controller = new AbortController()
    this.currentState = { running: true, model: config.model, completed: 0, total: config.runs, phase: 'validating', warning: null }
    void this.execute(config, this.controller.signal).finally(() => { this.controller = null })
  }

  cancel(): void {
    this.controller?.abort(new Error('Benchmark stopped by user.'))
  }

  private async execute(config: BenchmarkConfig, signal: AbortSignal): Promise<void> {
    const startedAt = Date.now()
    const samples: BenchmarkResult['samples'] = []
    const telemetry: TelemetrySample[] = []
    const captureTelemetry = () => {
      const sample = this.dependencies.telemetry()
      telemetry.push(sample)
      const state = sample.thermalPressure.value?.toLowerCase()
      if (state === 'serious' || state === 'critical') {
        this.currentState.warning = `macOS reports ${state} thermal pressure.`
        this.cancel()
      }
    }
    captureTelemetry()
    const telemetryTimer = setInterval(captureTelemetry, 1000)
    let resultStatus: BenchmarkResult['status'] = 'success'
    let failureReason: string | null = null
    let modelLoaded = false

    try {
      const installed = await this.dependencies.installedModels()
      if (!installed.includes(config.model)) throw new Error('The selected model is not installed locally; benchmarks never pull models.')
      modelLoaded = await this.dependencies.modelIsLoaded(config.model)
      if (config.warmup) {
        this.currentState.phase = 'warmup'
        await this.dependencies.generate(config.model, config.prompt, config.contextSize, 1, signal)
        modelLoaded = true
      }

      this.currentState.phase = 'running'
      for (let index = 0; index < config.runs; index += 1) {
        if (signal.aborted) throw signal.reason
        const stats = await this.dependencies.generate(config.model, config.prompt, config.contextSize, config.outputTokens, signal)
        samples.push({
          index: index + 1,
          mode: !config.warmup && index === 0 && !modelLoaded ? 'cold_start' : 'warm_run',
          metrics: ollamaRequestMetrics(stats, stats.ttftMs ?? undefined),
        })
        modelLoaded = true
        this.currentState.completed = index + 1
        this.currentState.phase = 'running'
      }
    } catch (error) {
      resultStatus = signal.aborted ? 'cancelled' : 'failed'
      failureReason = signal.aborted ? (this.currentState.warning ?? 'Benchmark stopped.') : error instanceof Error ? error.message : 'Benchmark failed.'
    } finally {
      clearInterval(telemetryTimer)
      captureTelemetry()
      const values = (selector: (sample: TelemetrySample) => Metric<number>) => telemetry.map(selector)
      const thermalStates = telemetry.map((sample) => sample.thermalPressure).filter((state) => state.value !== null)
      const result: BenchmarkResult = {
        id: randomUUID(),
        model: config.model,
        contextSize: config.contextSize,
        startedAt,
        finishedAt: Date.now(),
        status: resultStatus,
        failureReason,
        samples,
        peakMemoryBytes: summarize(values((sample) => sample.memory), 'bytes', (samples) => Math.max(...samples)),
        peakTemperature: summarize(values((sample) => sample.temperature), 'celsius', (samples) => Math.max(...samples)),
        averageFanRpm: summarize(values((sample) => sample.fanRpm), 'RPM', (samples) => average(samples) ?? 0),
        peakFanRpm: summarize(values((sample) => sample.fanRpm), 'RPM', (samples) => Math.max(...samples)),
        averagePowerWatts: summarize(values((sample) => sample.powerWatts), 'W', (samples) => average(samples) ?? 0),
        thermalPressure: thermalStates.at(-1) ?? metric<string>(null, '', 'unavailable', 'macos_thermal_pressure_unavailable'),
        ollamaVersion: this.dependencies.version(),
      }
      this.results.push(result)
      this.results = this.results.slice(-100)
      await this.dependencies.save(result).catch(() => undefined)
      this.currentState = { running: false, model: config.model, completed: samples.length, total: config.runs, phase: resultStatus, warning: this.currentState.warning }
    }
  }
}