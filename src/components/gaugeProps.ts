import type { GaugeProps } from './Gauge'

export function fanGaugeProps(fan: { rpm: number; minRpm: number | null; maxRpm: number | null }, index: number): GaugeProps {
  const scaleMax = Math.max(1000, Math.ceil((fan.maxRpm ?? Math.max(fan.rpm, 1000)) / 1000) * 1000)
  const percent = Math.round(Math.min(1, fan.rpm / (fan.maxRpm ?? scaleMax)) * 100)
  return {
    label: `FAN ${index + 1}`,
    value: fan.rpm,
    unit: 'RPM',
    scaleMax,
    tickStep: 1000,
    tickDivisor: 1000,
    tickSuffix: 'k',
    floor: fan.minRpm,
    caption: `${percent}% of ${Math.round(fan.maxRpm ?? scaleMax).toLocaleString()} max`,
    amberAt: 0.45,
    redAt: 0.75,
  }
}
