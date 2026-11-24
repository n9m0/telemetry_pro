import type { RequestMetrics } from './metrics.js'

export interface InferenceSession {
  id: string
  model: string
  startedAt: number
  metrics: RequestMetrics
  ollamaVersion: string | null
  // Absent for proxied requests; 'server_log' sessions are estimated from Ollama's own log.
  origin?: 'server_log'
}