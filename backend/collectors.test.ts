import { describe, expect, it } from 'vitest'
import { collectorInternals } from './collectors.js'

describe('macOS collector parsers', () => {
  it('parses byte sizes and elapsed process time', () => {
    expect(collectorInternals.parseBytes('1.5G')).toBe(1.5 * 1024 ** 3)
    expect(collectorInternals.parseBytes('500K')).toBe(500 * 1024)
    expect(collectorInternals.runtimeSeconds('1-02:03:04')).toBe(93_784)
  })

  it('identifies LLM processes narrowly without grouping arbitrary Python', () => {
    const rows = collectorInternals.parseProcesses([
      '8241 1 34.0 2400000 00:42:18 /Applications/Ollama.app/Contents/Resources/ollama serve --api-key very-secret',
      '8242 1 2.0 800000 00:02 /usr/bin/python unrelated.py',
    ].join('\n'))
    expect(rows[0].llmRelated).toBe(true)
    expect(rows[0].name).toBe('ollama')
    expect(rows[0].command).not.toContain('very-secret')
    expect(rows[0].command).toContain('[redacted]')
    expect(rows[1].llmRelated).toBe(false)
    expect(rows[0].memoryBytes).toBe(2_457_600_000)
  })

  it('selects physical network counters and ignores virtual interfaces', () => {
    const parsed = collectorInternals.parseNetwork([
      'Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll',
      'lo0        16384 <Link#1>                        10     0       1000       10     0       1000     0',
      'en3        1500  <Link#7>    46:5d:a7:dd:43:28        0     0          0        0     0          0     0',
      'en0        1500  <Link#16>   b6:57:7e:57:44:4e   768571     0  719718500   332590     0  181752087     0',
      'en0        1500  192.168.0     192.168.0.10      768571     -  719718500   332590     -  181752087     -',
      'utun2      1500  <Link#9>                        90     0       9000       70     0       7000     0',
    ].join('\n'))
    expect(parsed).toEqual({ name: 'en0', received: 719718500, sent: 181752087 })
  })

  it('derives app names containing spaces from the full arguments', () => {
    const rows = collectorInternals.parseProcesses(
      '2450 1 12.3 260944 02:39:58 /Applications/Visual Studio Code.app/Contents/MacOS/Code --type=renderer',
    )
    expect(rows[0].name).toBe('Code')
    const helper = collectorInternals.parseProcesses(
      '9 1 1.0 100 00:10 /A/Code Helper (Renderer).app/Contents/MacOS/Code Helper (Renderer) --type=renderer',
    )
    expect(helper[0].name).toBe('Code Helper (Renderer)')
  })

  it('parses GPU utilization from ioreg accelerator statistics', () => {
    const parsed = collectorInternals.parseGpu('"gpu-core-count" = 16\n"PerformanceStatistics" = {"Renderer Utilization %"=56,"Device Utilization %"=57}')
    expect(parsed).toEqual({ utilization: 57, cores: 16 })
    expect(collectorInternals.parseGpu('nothing')).toBeNull()
  })

  it('derives SoC and battery temperatures while ignoring PMU delta sensors', () => {
    const parsed = collectorInternals.parseThermal([
      'PMU tdie1\t45.50', 'PMU tdie2\t47.25', 'PMU tdev1\t-9201.14', 'PMU tcal\t51.82',
      'gas gauge battery\t31.10', 'NAND CH0 temp\t36.00',
    ].join('\n'))
    expect(parsed).toEqual({ soc: 47.25, battery: 31.1 })
    expect(collectorInternals.parseThermal('')).toEqual({ soc: null, battery: null })
  })

  it('parses fan speeds and skips unreadable fans', () => {
    const fans = collectorInternals.parseFans('fans\t3\nfan0\t2323\t2317\t7826\nfan1\t2505\t-1\t-1\nfan2\t-1\t0\t0')
    expect(fans).toEqual([
      { rpm: 2323, minRpm: 2317, maxRpm: 7826 },
      { rpm: 2505, minRpm: null, maxRpm: null },
    ])
  })

  it('parses vm_stat page counts into byte metrics', () => {
    const parsed = collectorInternals.parseVmStat([
      'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
      'Pages active: 1,395,873.',
      'Pages wired down: 213,790.',
      'Pages occupied by compressor: 27,121.',
      'File-backed pages: 1,238,940.',
    ].join('\n'))
    expect(parsed).toEqual({
      pageSize: 16384,
      activeBytes: 1_395_873 * 16384,
      wiredBytes: 213_790 * 16384,
      compressedBytes: 27_121 * 16384,
      cachedBytes: 1_238_940 * 16384,
    })
  })
})