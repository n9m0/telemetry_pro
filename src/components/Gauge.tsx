const START_ANGLE = -135
const SWEEP = 270
const CENTER = 100
const RADIUS = 74

function polar(angle: number, radius: number): { x: number; y: number } {
  const radians = ((angle - 90) * Math.PI) / 180
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) }
}

function arc(fromAngle: number, toAngle: number, radius = RADIUS): string {
  const start = polar(fromAngle, radius)
  const end = polar(toAngle, radius)
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${toAngle - fromAngle > 180 ? 1 : 0} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

export interface GaugeProps {
  label: string
  value: number
  unit: string
  scaleMax: number
  // Distance between minor ticks; every second tick is labelled.
  tickStep: number
  tickSuffix?: string
  tickDivisor?: number
  floor?: number | null
  floorLabel?: string
  caption: string
  // Fractions of the scale where the arc turns amber and red.
  amberAt: number
  redAt: number
  decimals?: number
}

export function SpeedGauge({ label, value, unit, scaleMax, tickStep, tickSuffix = '', tickDivisor = 1, floor = null, floorLabel = 'Minimum', caption, amberAt, redAt, decimals = 0 }: GaugeProps) {
  const fraction = Math.min(1, Math.max(0, value / scaleMax))
  const valueAngle = START_ANGLE + SWEEP * fraction
  const floorFraction = floor === null ? null : Math.min(1, Math.max(0, floor / scaleMax))
  const ticks = Array.from({ length: Math.round(scaleMax / tickStep) + 1 }, (_, tick) => tick)
  const color = fraction < amberAt ? '#93e5bd' : fraction < redAt ? '#e4b86c' : '#e07a7a'
  const reading = decimals ? value.toFixed(decimals) : Math.round(value).toLocaleString()

  return (
    <figure className="fan-gauge" aria-label={label}>
      <svg viewBox="-16 -12 232 204" role="img" aria-label={`${reading} ${unit} of ${scaleMax} ${unit} scale`}>
        <path d={arc(START_ANGLE, START_ANGLE + SWEEP)} className="gauge-track" />
        {fraction > 0 && <path d={arc(START_ANGLE, valueAngle)} className="gauge-value" style={{ stroke: color }} />}
        {ticks.map((tick) => {
          const angle = START_ANGLE + (SWEEP * tick * tickStep) / scaleMax
          const major = tick % 2 === 0
          const outer = polar(angle, RADIUS + 7)
          const inner = polar(angle, RADIUS + (major ? 14 : 11))
          const labelPoint = polar(angle, RADIUS + 24)
          return (
            <g key={tick}>
              <line x1={outer.x} y1={outer.y} x2={inner.x} y2={inner.y} className={major ? 'gauge-tick major' : 'gauge-tick'} />
              {major && <text x={labelPoint.x} y={labelPoint.y} className="gauge-label" textAnchor="middle" dominantBaseline="middle">{(tick * tickStep) / tickDivisor}{tickSuffix}</text>}
            </g>
          )
        })}
        {floorFraction !== null && (
          <circle cx={polar(START_ANGLE + SWEEP * floorFraction, RADIUS).x} cy={polar(START_ANGLE + SWEEP * floorFraction, RADIUS).y} r="3" className="gauge-min">
            <title>{floorLabel} {Math.round(floor ?? 0)} {unit}</title>
          </circle>
        )}
        <g className="gauge-needle" style={{ transform: `rotate(${valueAngle}deg)`, transformOrigin: `${CENTER}px ${CENTER}px` }}>
          <polygon points={`${CENTER - 3},${CENTER} ${CENTER + 3},${CENTER} ${CENTER},${CENTER - RADIUS + 8}`} style={{ fill: color }} />
        </g>
        <circle cx={CENTER} cy={CENTER} r="7" className="gauge-hub" />
        <text x={CENTER} y={CENTER + 38} className="gauge-reading" textAnchor="middle">{reading}</text>
        <text x={CENTER} y={CENTER + 52} className="gauge-unit" textAnchor="middle">{unit}</text>
      </svg>
      <figcaption>
        <strong>{label}</strong>
        <span>{caption}</span>
      </figcaption>
    </figure>
  )
}
