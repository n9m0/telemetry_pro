import type { Metric } from '../shared/metrics'
import { formatMetricValue } from '../utils/format'

interface MetricTileProps {
  label: string
  value: Metric<number | string>
  unit?: string
  color?: string
  total?: Metric<number>
  detail?: string
}

export function MetricTile({ label, value, unit, color = 'mint', total, detail }: MetricTileProps) {
  const percentage = typeof value.value === 'number' && total?.value
    ? Math.min(100, Math.max(0, (value.value / total.value) * 100))
    : null
  const provenance = `${value.quality.toUpperCase()} · ${value.source}`

  return (
    <article className={`metric-tile tone-${color}`} title={provenance}>
      <div className="tile-heading">
        <span>{label}</span>
        <span className={`quality quality-${value.quality}`} aria-label={value.quality}>{value.quality}</span>
      </div>
      <strong className={value.value === null ? 'unavailable' : ''}>{formatMetricValue(value, unit)}</strong>
      {detail && <small>{detail}</small>}
      {percentage !== null && (
        <div className="meter-track" aria-label={`${percentage.toFixed(0)} percent`}>
          <span style={{ width: `${percentage}%` }} />
        </div>
      )}
    </article>
  )
}