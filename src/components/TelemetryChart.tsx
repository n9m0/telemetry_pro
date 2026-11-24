import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface ChartPoint {
  timestamp: number
  [key: string]: number | null
}

export interface TelemetryChartProps {
  title: string
  data: ChartPoint[]
  series: Array<{ key: string; name: string; color: string }>
  unit: string
  area?: boolean
  // When set, the chart is a fixed-width live window that scrolls with the newest sample.
  windowMs?: number
}

export function TelemetryChart({ title, data, series, unit, area = false, windowMs }: TelemetryChartProps) {
  const latest = data.at(-1)?.timestamp ?? 0
  const visible = windowMs ? data.filter((point) => point.timestamp >= latest - windowMs) : data
  const xAxisProps = windowMs
    ? {
        type: 'number' as const,
        domain: [latest - windowMs, latest] as [number, number],
        allowDataOverflow: true,
        ticks: Array.from({ length: 7 }, (_, index) => latest - windowMs + (index * windowMs) / 6),
        tickFormatter: (value: number) => {
          const seconds = Math.round((latest - value) / 1000)
          return seconds === 0 ? 'now' : `-${seconds}s`
        },
      }
    : {
        tickFormatter: (value: number) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        minTickGap: 30,
      }
  const Chart = area ? AreaChart : LineChart
  return (
    <section className="chart-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">LIVE TELEMETRY</span>
          <h3>{title}</h3>
        </div>
        <div className="chart-legend">
          {series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.name}</span>)}
        </div>
      </div>
      {visible.length < 2 ? (
        <div className="chart-empty">Collecting samples</div>
      ) : (
        <div className="chart-area">
          <ResponsiveContainer width="100%" height="100%">
            <Chart data={visible} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#26302d" strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="timestamp" {...xAxisProps} tick={{ fill: '#77817b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#77817b', fontSize: 10 }} axisLine={false} tickLine={false} width={unit === '%' || unit === 'GB' ? 46 : 62} unit={unit} domain={unit === '%' ? [0, 100] : [0, (dataMax: number) => Math.max(10, Math.ceil(dataMax / 10) * 10)]} tickFormatter={(value: number) => String(Math.round(value))} />
              <Tooltip labelFormatter={(value) => new Date(Number(value)).toLocaleTimeString()} formatter={(value, name) => [value === null ? 'Unavailable' : `${Number(value).toFixed(1)} ${unit}`, name]} contentStyle={{ background: '#171e1b', border: '1px solid #303a35', borderRadius: 4, color: '#e9eee9' }} />
              {series.map((item) => area
                ? <Area key={item.key} type="monotone" dataKey={item.key} name={item.name} stroke={item.color} fill={item.color} fillOpacity={0.09} strokeWidth={2} isAnimationActive={false} connectNulls={false} />
                : <Line key={item.key} type="monotone" dataKey={item.key} name={item.name} stroke={item.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />)}
            </Chart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}