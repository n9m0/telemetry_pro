const TUBE_TOP = 22
const TUBE_BOTTOM = 138
const TUBE_X = 100
const TUBE_WIDTH = 22
const BULB_RADIUS = 21

export interface ThermometerProps {
  label: string
  celsius: number
  scaleMax?: number
  caption: string
  amberAt?: number
  redAt?: number
}

export function Thermometer({ label, celsius, scaleMax = 120, caption, amberAt = 0.5, redAt = 0.75 }: ThermometerProps) {
  const fraction = Math.min(1, Math.max(0, celsius / scaleMax))
  const color = fraction < amberAt ? '#93e5bd' : fraction < redAt ? '#e4b86c' : '#e07a7a'
  const fillTop = TUBE_BOTTOM - (TUBE_BOTTOM - TUBE_TOP) * fraction
  const ticks = Array.from({ length: scaleMax / 10 + 1 }, (_, tick) => tick * 10)
  const left = TUBE_X - TUBE_WIDTH / 2
  const bulbCenter = TUBE_BOTTOM + BULB_RADIUS - 4

  return (
    <figure className="fan-gauge" aria-label={label}>
      <svg viewBox="-16 -12 232 204" role="img" aria-label={`${celsius.toFixed(1)} °C of ${scaleMax} °C scale`}>
        <rect x={left} y={TUBE_TOP - TUBE_WIDTH / 2} width={TUBE_WIDTH} height={TUBE_BOTTOM - TUBE_TOP + TUBE_WIDTH / 2 + 6} rx={TUBE_WIDTH / 2} className="thermo-glass" />
        <circle cx={TUBE_X} cy={bulbCenter} r={BULB_RADIUS} className="thermo-glass" />
        <rect x={left + 5} y={fillTop} width={TUBE_WIDTH - 10} height={bulbCenter - fillTop} rx="3" className="thermo-fill" style={{ fill: color }} />
        <circle cx={TUBE_X} cy={bulbCenter} r={BULB_RADIUS - 5} className="thermo-fill" style={{ fill: color }} />
        {ticks.map((tick) => {
          const y = TUBE_BOTTOM - ((TUBE_BOTTOM - TUBE_TOP) * tick) / scaleMax
          const major = tick % 20 === 0
          return (
            <g key={tick}>
              <line x1={left + TUBE_WIDTH + 5} y1={y} x2={left + TUBE_WIDTH + (major ? 15 : 10)} y2={y} className={major ? 'gauge-tick major' : 'gauge-tick'} />
              {major && <text x={left + TUBE_WIDTH + 20} y={y} className="gauge-label" dominantBaseline="middle">{tick}</text>}
            </g>
          )
        })}
        <line x1={left - 14} y1={fillTop} x2={left - 3} y2={fillTop} className="thermo-pointer" style={{ stroke: color }} />
        <text x={left - 20} y={fillTop} className="thermo-reading" textAnchor="end" dominantBaseline="middle" style={{ fill: color }}>{celsius.toFixed(1)}°</text>
      </svg>
      <figcaption>
        <strong>{label}</strong>
        <span>{caption}</span>
      </figcaption>
    </figure>
  )
}
