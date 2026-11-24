import { describe, expect, it } from 'vitest'
import { contextPercentage, estimatedModelMemory, ollamaRequestMetrics } from './metrics.js'
import { aggregateModelPerformance } from './performance.js'
import type { InferenceSession } from './session.js'
import { formatTokenCount } from '../utils/format.js'

describe('Ollama metrics', () => {
  it('converts nanoseconds and keeps prefill separate from generation', () => {
    const result = ollamaRequestMetrics({
      prompt_eval_count: 3000,
      prompt_eval_duration: 2_000_000_000,
      eval_count: 120,
      eval_duration: 1_500_000_000,
      total_duration: 4_000_000_000,
      load_duration: 500_000_000,
    })
    expect(result.prefillSpeed.value).toBe(1500)
    expect(result.generationSpeed.value).toBe(80)
    expect(result.totalDuration.value).toBe(4)
    expect(result.modelLoadDuration.value).toBe(0.5)
  })

  it('excludes prompt-cache hits from prefill speed', () => {
    const partial = ollamaRequestMetrics({ prompt_eval_count: 3000, prompt_eval_cached_count: 1000, prompt_eval_duration: 1_000_000_000 })
    expect(partial.prefillSpeed.value).toBe(2000)
    const nearlyCached = ollamaRequestMetrics({ prompt_eval_count: 23, prompt_eval_cached_count: 22, prompt_eval_duration: 16_625 })
    expect(nearlyCached.prefillSpeed.value).toBeNull()
    expect(nearlyCached.prefillSpeed.source).toBe('ollama_prompt_mostly_cached')
    expect(nearlyCached.promptTokens.value).toBe(23)
    expect(ollamaRequestMetrics({ prompt_eval_count: 12, prompt_eval_cached_count: 0, prompt_eval_duration: 150_000_000 }).prefillSpeed.value).toBe(80)
  })

  it('keeps TTFT unavailable unless a stream first-content time was measured', () => {
    const result = ollamaRequestMetrics({ eval_count: 10, eval_duration: 1_000_000_000 })
    expect(result.ttft.value).toBeNull()
    expect(result.ttft.quality).toBe('unavailable')
    expect(ollamaRequestMetrics({}, 183).ttft.value).toBe(183)
  })

  it('calculates context percentage and marks model size as estimated', () => {
    expect(contextPercentage(16_384, 262_144).value).toBe(6.25)
    expect(formatTokenCount(262_144)).toBe('256K')
    expect(contextPercentage(1, null).quality).toBe('unavailable')
    expect(estimatedModelMemory(24_000).quality).toBe('estimated')
    expect(estimatedModelMemory(undefined).value).toBeNull()
  })
})

describe('model performance baselines', () => {
  const session = (id: string, speed: number): InferenceSession => {
    const metrics = ollamaRequestMetrics({ eval_count: 100, eval_duration: 1_000_000_000 }, 100)
    metrics.generationSpeed.value = speed
    return { id, model: 'model-a', startedAt: 1, metrics, ollamaVersion: 'test' }
  }

  it('requires three measured requests before setting a machine-local baseline', () => {
    expect(aggregateModelPerformance([session('1', 70), session('2', 80)])[0].baselineMinimum).toBeNull()
    const summary = aggregateModelPerformance([session('1', 70), session('2', 80), session('3', 75)])[0]
    expect(summary.baselineMinimum).toBe(70)
    expect(summary.baselineMaximum).toBe(80)
    expect(summary.averageGeneration).toBe(75)
    expect(summary.peakGeneration).toBe(80)
  })
})