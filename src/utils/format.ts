import type { Metric } from '../shared/metrics.js'

export function formatBytes(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable'
  if (value < 1024) return `${Math.round(value)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let scaled = value / 1024
  let index = 0
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024
    index += 1
  }
  return `${scaled.toFixed(decimals)} ${units[index]}`
}

export function formatRate(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable'
  if (unit === 'tok/s') return `${value.toFixed(1)} tok/s`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB/s`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB/s`
  return `${value.toFixed(0)} B/s`
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'Unavailable'
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = Math.floor(seconds % 60)
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${remainder}s`
}

export function formatTokenCount(value: number): string {
  if (value < 1024) return Math.round(value).toLocaleString()
  const scaled = value / 1024
  return `${Number.isInteger(scaled) ? scaled.toFixed(0) : scaled.toFixed(1)}K`
}

export function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(timestamp)
}

export function formatMetricValue(value: Metric<number | string>, unit = value.unit): string {
  if (value.value === null) return 'Unavailable'
  if (typeof value.value === 'string') return value.value
  if (unit === 'bytes') return formatBytes(value.value)
  if (unit === 'celsius') return `${value.value.toFixed(1)}°C`
  if (unit === 'RPM') return `${Math.round(value.value).toLocaleString()} RPM`
  if (unit === 'W') return `${value.value.toFixed(1)} W`
  if (unit === '%') return `${value.value.toFixed(0)}%`
  if (unit === 'tok/s') return `${value.value.toFixed(1)} tok/s`
  if (unit === 'MHz') return `${Math.round(value.value)} MHz`
  return `${value.value.toLocaleString()} ${unit}`.trim()
}
export function formatAge(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}
