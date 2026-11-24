import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { estimatedModelMemory, metric } from '../src/shared/metrics.js'
import type { Metric } from '../src/shared/metrics.js'
import type { LoadedModel, OllamaInfo } from './types.js'

const execFileAsync = promisify(execFile)
const defaultHost = 'http://127.0.0.1:11434'

function localOllamaHost(configured: string | undefined): string {
  if (!configured) return defaultHost
  try {
    const url = new URL(configured.includes('://') ? configured : `http://${configured}`)
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) {
      throw new Error('Remote Ollama hosts are blocked; use a loopback address only.')
    }
    return url.origin
  } catch (error) {
    if (error instanceof Error && error.message.includes('blocked')) throw error
    throw new Error('OLLAMA_HOST must be a valid localhost URL.')
  }
}

function loadedModel(value: Record<string, unknown>): LoadedModel {
  const details = typeof value.details === 'object' && value.details !== null
    ? value.details as Record<string, unknown>
    : {}
  const rawBackend = details.backend ?? details.processor ?? value.backend
  const backend = typeof rawBackend === 'string' && rawBackend.length > 0
    ? metric(rawBackend, '', 'measured', 'ollama_runtime_backend')
    : metric<string>(null, '', 'unavailable', 'ollama_backend_not_reported')
  const sizeBytes = typeof value.size === 'number' ? estimatedModelMemory(value.size) : estimatedModelMemory(null)
  const vramBytes: Metric<number> = typeof value.size_vram === 'number'
    ? metric(value.size_vram, 'bytes', 'measured', 'ollama_size_vram')
    : metric<number>(null, 'bytes', 'unavailable', 'ollama_size_vram_not_reported')

  return {
    name: typeof value.name === 'string' ? value.name : typeof value.model === 'string' ? value.model : 'Unknown model',
    sizeBytes,
    vramBytes,
    family: typeof details.family === 'string' ? details.family : null,
    parameterSize: typeof details.parameter_size === 'string' ? details.parameter_size : null,
    quantization: typeof details.quantization_level === 'string' ? details.quantization_level : null,
    contextLength: typeof value.context_length === 'number'
      ? metric(value.context_length, 'tokens', 'measured', 'ollama_context_length')
      : metric<number>(null, 'tokens', 'unavailable', 'ollama_context_length_not_reported'),
    expiresAt: typeof value.expires_at === 'string' ? value.expires_at : null,
    backend,
  }
}

async function jsonRequest(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(1200) })
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`)
  return response.json()
}

export class OllamaCollector {
  readonly host: string
  private configurationError: string | null = null
  private installed: boolean | null = null
  private version: string | null = null
  private checkedInstall = false
  activeRequests = 0
  requestStatus: OllamaInfo['status'] = 'IDLE'
  private lastModels: LoadedModel[] = []
  private lastError: string | null = null

  constructor(configuredHost = process.env.OLLAMA_HOST) {
    try {
      this.host = localOllamaHost(configuredHost)
    } catch (error) {
      this.host = defaultHost
      this.configurationError = error instanceof Error ? error.message : 'Invalid Ollama host configuration.'
    }
  }

  private async detectInstallation(): Promise<void> {
    if (this.checkedInstall) return
    this.checkedInstall = true
    try {
      const { stdout } = await execFileAsync('/usr/bin/which', ['ollama'], { timeout: 1000 })
      this.installed = stdout.trim().length > 0
      if (this.installed) {
        const result = await execFileAsync(stdout.trim(), ['--version'], { timeout: 1500 })
        this.version = result.stdout.trim() || result.stderr.trim() || null
      }
    } catch {
      this.installed = false
    }
  }

  async sample(): Promise<OllamaInfo> {
    await this.detectInstallation()
    if (this.configurationError) {
      this.lastError = this.configurationError
      this.lastModels = []
      return this.snapshot(false)
    }
    try {
      const [ps, version] = await Promise.all([
        jsonRequest(`${this.host}/api/ps`) as Promise<{ models?: unknown[] }>,
        jsonRequest(`${this.host}/api/version`) as Promise<{ version?: string }>,
      ])
      this.lastModels = Array.isArray(ps.models)
        ? ps.models.filter((model): model is Record<string, unknown> => typeof model === 'object' && model !== null).map(loadedModel)
        : []
      this.version = typeof version.version === 'string' ? version.version : this.version
      this.installed = true
      this.lastError = null
      return this.snapshot(true)
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Ollama is not responding on localhost.'
      this.lastModels = []
      return this.snapshot(false)
    }
  }

  snapshot(running: boolean): OllamaInfo {
    return {
      installed: this.installed,
      running,
      version: this.version,
      models: this.lastModels,
      status: this.activeRequests > 0 ? this.requestStatus : this.lastError && this.installed ? 'ERROR' : 'IDLE',
      activeRequests: this.activeRequests,
      error: running ? null : this.lastError,
    }
  }
}

export const ollamaInternals = { localOllamaHost, loadedModel }