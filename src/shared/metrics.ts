export type MetricQuality = 'measured' | 'calculated' | 'estimated' | 'unavailable'

export interface Metric<T> {
  value: T | null
  unit: string
  quality: MetricQuality
  source: string
}

export interface OllamaTimings {
  prompt_eval_count?: number
  prompt_eval_cached_count?: number
  eval_count?: number
  prompt_eval_duration?: number
  eval_duration?: number
  total_duration?: number
  load_duration?: number
}

export interface RequestMetrics {
  promptTokens: Metric<number>
  outputTokens: Metric<number>
  prefillSpeed: Metric<number>
  generationSpeed: Metric<number>
  totalDuration: Metric<number>
  modelLoadDuration: Metric<number>
  ttft: Metric<number>
}

const calculated = (value: number | null, unit: string, source: string): Metric<number> => ({
  value: value !== null && Number.isFinite(value) ? value : null,
  unit,
  quality: value !== null && Number.isFinite(value) ? 'calculated' : 'unavailable',
  source,
})

export function ollamaRequestMetrics(stats: OllamaTimings, measuredTtftMs?: number): RequestMetrics {
  const promptDurationSeconds = (stats.prompt_eval_duration ?? 0) / 1e9
  const generationDurationSeconds = (stats.eval_duration ?? 0) / 1e9
  // prompt_eval_count includes tokens served from Ollama's prompt cache, which were not actually
  // prefilled, so only the uncached tokens can be divided by the prefill duration.
  const uncachedPromptTokens = typeof stats.prompt_eval_count === 'number'
    ? Math.max(0, stats.prompt_eval_count - (stats.prompt_eval_cached_count ?? 0))
    : null
  // A handful of uncached tokens (Ollama always re-evaluates at least the last one) timed in
  // microseconds is noise, not a prefill rate.
  const prefillReliable = uncachedPromptTokens !== null
    && (stats.prompt_eval_cached_count ?? 0) === 0
      ? uncachedPromptTokens > 0
      : uncachedPromptTokens !== null && uncachedPromptTokens >= 8

  return {
    promptTokens: calculated(
      typeof stats.prompt_eval_count === 'number' ? stats.prompt_eval_count : null,
      'tokens',
      'ollama_prompt_eval_count',
    ),
    outputTokens: calculated(
      typeof stats.eval_count === 'number' ? stats.eval_count : null,
      'tokens',
      'ollama_eval_count',
    ),
    prefillSpeed: calculated(
      promptDurationSeconds > 0 && prefillReliable && uncachedPromptTokens !== null
        ? uncachedPromptTokens / promptDurationSeconds
        : null,
      'tok/s',
      prefillReliable || uncachedPromptTokens === null ? 'ollama_prompt_eval_statistics' : 'ollama_prompt_mostly_cached',
    ),
    generationSpeed: calculated(
      generationDurationSeconds > 0 && typeof stats.eval_count === 'number'
        ? stats.eval_count / generationDurationSeconds
        : null,
      'tok/s',
      'ollama_eval_statistics',
    ),
    totalDuration: calculated(
      typeof stats.total_duration === 'number' ? stats.total_duration / 1e9 : null,
      's',
      'ollama_total_duration',
    ),
    modelLoadDuration: calculated(
      typeof stats.load_duration === 'number' ? stats.load_duration / 1e9 : null,
      's',
      'ollama_load_duration',
    ),
    ttft: calculated(typeof measuredTtftMs === 'number' ? measuredTtftMs : null, 'ms', 'stream_first_content'),
  }
}

export function contextPercentage(usedTokens: number, maximumTokens: number | null): Metric<number> {
  return calculated(
    maximumTokens && maximumTokens > 0 ? Math.min(100, (usedTokens / maximumTokens) * 100) : null,
    '%',
    'ollama_context_window',
  )
}

export function estimatedModelMemory(sizeBytes: number | null | undefined): Metric<number> {
  return {
    value: typeof sizeBytes === 'number' && sizeBytes >= 0 ? sizeBytes : null,
    unit: 'bytes',
    quality: typeof sizeBytes === 'number' && sizeBytes >= 0 ? 'estimated' : 'unavailable',
    source: 'ollama_model_size',
  }
}

export function metric<T>(value: T | null, unit: string, quality: MetricQuality, source: string): Metric<T> {
  return { value, unit, quality: value === null ? 'unavailable' : quality, source }
}