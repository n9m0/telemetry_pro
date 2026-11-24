import type { InferenceSession } from './session.js'

export interface ModelPerformance {
  model: string
  samples: number
  averageGeneration: number | null
  averagePrefill: number | null
  averageTtft: number | null
  averagePromptTokens: number | null
  averageOutputTokens: number | null
  peakGeneration: number | null
  baselineMinimum: number | null
  baselineMaximum: number | null
}

export function aggregateModelPerformance(sessions: InferenceSession[]): ModelPerformance[] {
  return [...new Set(sessions.map((session) => session.model))].map((model) => {
    const rows = sessions.filter((session) => session.model === model)
    const average = (select: (session: InferenceSession) => number | null): number | null => {
      const values = rows.map(select).filter((value): value is number => value !== null)
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
    }
    const generationValues = rows.map((session) => session.metrics.generationSpeed.value).filter((value): value is number => value !== null)
    const baselineEstablished = generationValues.length >= 3
    return {
      model,
      samples: rows.length,
      averageGeneration: average((session) => session.metrics.generationSpeed.value),
      averagePrefill: average((session) => session.metrics.prefillSpeed.value),
      averageTtft: average((session) => session.metrics.ttft.value),
      averagePromptTokens: average((session) => session.metrics.promptTokens.value),
      averageOutputTokens: average((session) => session.metrics.outputTokens.value),
      peakGeneration: generationValues.length ? Math.max(...generationValues) : null,
      baselineMinimum: baselineEstablished ? Math.min(...generationValues) : null,
      baselineMaximum: baselineEstablished ? Math.max(...generationValues) : null,
    }
  })
}