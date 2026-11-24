import { lazy, Suspense } from 'react'
import type { TelemetryChartProps } from './TelemetryChart'

const Chart = lazy(() => import('./TelemetryChart').then((module) => ({ default: module.TelemetryChart })))

export function LazyTelemetryChart(props: TelemetryChartProps) {
  return <Suspense fallback={<div className="chart-empty">Loading chart</div>}><Chart {...props} /></Suspense>
}