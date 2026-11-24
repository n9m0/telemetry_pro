import type { Metric } from '../src/shared/metrics.js'

export interface ProcessInfo {
  pid: number
  name: string
  cpuPercent: number
  memoryBytes: number
  runtimeSeconds: number | null
  command: string
  llmRelated: boolean
}

export interface LoadedModel {
  name: string
  sizeBytes: Metric<number>
  vramBytes: Metric<number>
  family: string | null
  parameterSize: string | null
  quantization: string | null
  contextLength: Metric<number>
  expiresAt: string | null
  backend: Metric<string>
}

export interface OllamaInfo {
  installed: boolean | null
  running: boolean
  version: string | null
  models: LoadedModel[]
  status: 'IDLE' | 'LOADING' | 'PREFILL' | 'GENERATING' | 'UNLOADING' | 'ERROR'
  activeRequests: number
  error: string | null
}

export interface Snapshot {
  timestamp: number
  hardware: {
    model: string | null
    chip: string | null
    architecture: string
    hostname: string
    macOS: string | null
    cpuCores: number
    performanceCores: number | null
    efficiencyCores: number | null
    totalMemoryBytes: number
    uptimeSeconds: number
  }
  cpu: {
    total: Metric<number>
    user: Metric<number>
    system: Metric<number>
    idle: Metric<number>
    perCore: Metric<number>[]
    temperature: Metric<number>
    frequency: Metric<number>
  }
  gpu: {
    utilization: Metric<number>
    temperature: Metric<number>
    cores: Metric<number>
  }
  memory: {
    totalBytes: Metric<number>
    usedBytes: Metric<number>
    availableBytes: Metric<number>
    wiredBytes: Metric<number>
    compressedBytes: Metric<number>
    cachedBytes: Metric<number>
    swapBytes: Metric<number>
    pressure: Metric<string>
  }
  disk: {
    name: string | null
    mount: string
    totalBytes: Metric<number>
    usedBytes: Metric<number>
    availableBytes: Metric<number>
    readBytesPerSecond: Metric<number>
    writeBytesPerSecond: Metric<number>
  }
  network: {
    interface: string | null
    localAddress: string | null
    receivedBytesPerSecond: Metric<number>
    sentBytesPerSecond: Metric<number>
  }
  thermal: {
    cpuTemperature: Metric<number>
    gpuTemperature: Metric<number>
    batteryTemperature: Metric<number>
    fanRpm: Metric<number>
    fans: Array<{ rpm: number; minRpm: number | null; maxRpm: number | null }>
    pressure: Metric<string>
    powerWatts: Metric<number>
  }
  battery: {
    percent: Metric<number>
    state: Metric<string>
    cycleCount: Metric<number>
  }
  processes: ProcessInfo[]
  ollama: OllamaInfo
  liveGeneration: Metric<number>
  historyRevision: number
  history: Array<{ timestamp: number; cpu: number | null; gpu: number | null; memory: number | null; swap: number | null; generation: number | null }>
}