import type { Metric, RequestMetrics } from './metrics.js'

export const benchmarkContexts = [1024, 4096, 8192, 16384, 32768, 65536] as const

export interface BenchmarkConfig {
  model: string
  prompt: string
  contextSize: number
  runs: number
  outputTokens: number
  warmup: boolean
}

export interface BenchmarkSample {
  index: number
  mode: 'cold_start' | 'warm_run'
  metrics: RequestMetrics
}

export interface BenchmarkResult {
  id: string
  model: string
  contextSize: number
  startedAt: number
  finishedAt: number
  status: 'success' | 'cancelled' | 'failed'
  failureReason: string | null
  samples: BenchmarkSample[]
  peakMemoryBytes: Metric<number>
  peakTemperature: Metric<number>
  averageFanRpm: Metric<number>
  peakFanRpm: Metric<number>
  averagePowerWatts: Metric<number>
  thermalPressure: Metric<string>
  ollamaVersion: string | null
}

export interface BenchmarkState {
  running: boolean
  model: string | null
  completed: number
  total: number
  phase: string
  warning: string | null
}