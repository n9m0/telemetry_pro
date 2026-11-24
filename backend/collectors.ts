import os from 'node:os'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { metric } from '../src/shared/metrics.js'
import type { Metric } from '../src/shared/metrics.js'
import type { ProcessInfo, Snapshot } from './types.js'

const execFileAsync = promisify(execFile)
const unavailable = <T>(unit: string, source = 'not_exposed_by_macos'): Metric<T> =>
  metric<T>(null, unit, 'unavailable', source)

async function command(file: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(file, args, { timeout: 2500, maxBuffer: 1024 * 1024 })
    return stdout.trim()
  } catch {
    return null
  }
}

function parseBytes(value: string): number | null {
  const match = value.match(/^([\d.]+)([KMGT])?$/i)
  if (!match) return null
  const multiplier = ({ K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 } as Record<string, number>)[
    (match[2] ?? '').toUpperCase()
  ] ?? 1
  return Number(match[1]) * multiplier
}

function runtimeSeconds(value: string): number | null {
  const daysSplit = value.split('-')
  const clock = daysSplit.at(-1)?.split(':').map(Number)
  if (!clock || clock.some((part) => !Number.isFinite(part))) return null
  const seconds = clock.pop() ?? 0
  const minutes = clock.pop() ?? 0
  const hours = clock.pop() ?? 0
  return (Number(daysSplit[0] && daysSplit.length > 1 ? daysSplit[0] : 0) * 86400) + hours * 3600 + minutes * 60 + seconds
}

const secretWords = 'password|passwd|pass|pwd|token|secret|api[-_]?key|access[-_]?key|private[-_]?key|credential|auth|authorization'

function redactCommand(command: string): string {
  const scrubbed = command
    .replace(/\b((?:proxy-)?authorization)\s*[:=]\s*(?:(?:bearer|basic|token)\s+)?\S+/gi, '$1: [redacted]')
    .replace(/\bbearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1[redacted]@')
    .replace(new RegExp(`((?:^|\\s)-{0,2}[\\w.-]*(?:${secretWords})[\\w.-]*=)\\S*`, 'gi'), '$1[redacted]')
    .replace(/\b(?:sk-|ghp_|gho_|ghs_|github_pat_|xox[baprs]-|AKIA)[\w-]{8,}/g, '[redacted]')
  const secretFlag = new RegExp(`^(?:--?[\\w-]*(?:${secretWords})[\\w-]*|-p)$`, 'i')
  const safe: string[] = []
  let redactNext = false
  for (const field of scrubbed.split(/\s+/)) {
    if (redactNext) {
      safe.push('[redacted]')
      redactNext = false
      continue
    }
    safe.push(field)
    redactNext = secretFlag.test(field)
  }
  return safe.join(' ')
}

function parseProcesses(output: string): ProcessInfo[] {
  return output.split('\n').flatMap((line) => {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 6) return []
    const pid = Number(fields[0])
    const cpuPercent = Number(fields[2])
    const rssKilobytes = Number(fields[3])
    if (!Number.isInteger(pid) || !Number.isFinite(cpuPercent) || !Number.isFinite(rssKilobytes)) return []
    const command = fields.slice(5).join(' ')
    // `comm` is truncated and split on spaces by ps, so the name is derived from the full arguments.
    const name = command.match(/\/Contents\/MacOS\/(.+?)(?=\s+--?\w|$)/)?.[1]
      ?? command.match(/^\S+/)?.[0].split('/').at(-1)
      ?? 'unknown'
    const llmRelated = /(^|[\s/])(ollama|ollama_llama_server|llama-server|llama\.server|llama\.cpp|mlx(?:_lm)?|lmstudio|lm studio)(?:[\s/]|$)/i.test(
      `${name} ${command}`,
    )
    return [{
      pid,
      name,
      cpuPercent,
      memoryBytes: rssKilobytes * 1024,
      runtimeSeconds: runtimeSeconds(fields[4]),
      command: redactCommand(command),
      llmRelated,
    }]
  }).sort((a, b) => b.cpuPercent - a.cpuPercent)
}

function cpuSample(previous: ReturnType<typeof os.cpus>): { total: number; user: number; system: number; idle: number; perCore: number[] } {
  const current = os.cpus()
  const perCore = current.map((cpu, index) => {
    const old = previous[index]?.times
    if (!old) return 0
    const total = Object.keys(cpu.times).reduce((sum, key) => sum + cpu.times[key as keyof typeof cpu.times] - old[key as keyof typeof old], 0)
    return total > 0 ? (1 - (cpu.times.idle - old.idle) / total) * 100 : 0
  })
  const deltas = current.map((cpu, index) => {
    const old = previous[index]?.times ?? cpu.times
    return Object.fromEntries(Object.keys(cpu.times).map((key) => [
      key,
      cpu.times[key as keyof typeof cpu.times] - old[key as keyof typeof old],
    ])) as Record<keyof typeof cpu.times, number>
  })
  const total = deltas.reduce((sum, times) => sum + Object.values(times).reduce((a, b) => a + b, 0), 0)
  const sum = (key: keyof typeof current[number]['times']) => deltas.reduce((value, times) => value + times[key], 0)
  return {
    total: total > 0 ? ((total - sum('idle')) / total) * 100 : 0,
    user: total > 0 ? ((sum('user') + sum('nice')) / total) * 100 : 0,
    system: total > 0 ? (sum('sys') / total) * 100 : 0,
    idle: total > 0 ? (sum('idle') / total) * 100 : 0,
    perCore,
  }
}

function parseNetwork(output: string): { name: string; received: number; sent: number } | null {
  const lines = output.split('\n').map((line) => line.trim().split(/\s+/))
  const header = lines.find((fields) => fields[0] === 'Name')
  // Columns are located from the end of the row because the Address column may be empty.
  const fromEnd = (column: string, fallback: number) => {
    const index = header?.indexOf(column) ?? -1
    return index < 0 || !header ? fallback : index - header.length
  }
  const receivedIndex = fromEnd('Ibytes', -5)
  const sentIndex = fromEnd('Obytes', -2)
  const candidates = lines.flatMap((fields) => {
    if (!/^en\d+$/.test(fields[0] ?? '') || !fields.some((field) => /^<?link#\d+>?$/i.test(field))) return []
    const received = Number(fields.at(receivedIndex))
    const sent = Number(fields.at(sentIndex))
    return Number.isFinite(received) && Number.isFinite(sent) ? [{ name: fields[0], received, sent }] : []
  })
  return candidates.find((entry) => entry.name === 'en0') ?? candidates[0] ?? null
}

function parseGpu(output: string): { utilization: number; cores: number | null } | null {
  const utilization = output.match(/"Device Utilization %"\s*=\s*(\d+(?:\.\d+)?)/)
  if (!utilization) return null
  const cores = output.match(/"gpu-core-count"\s*=\s*(\d+)/)
  return { utilization: Math.min(100, Number(utilization[1])), cores: cores ? Number(cores[1]) : null }
}

export interface ThermalReading { soc: number | null; battery: number | null }

// Sensors report one line per service as "<name>\t<celsius>". The PMU tdev* sensors are
// deltas rather than temperatures, so only plausible tdie* (SoC die) and battery readings are used.
function parseThermal(output: string): ThermalReading {
  const soc: number[] = []
  const battery: number[] = []
  for (const line of output.split('\n')) {
    const [name, raw] = line.split('\t')
    const value = Number(raw)
    if (!name || !Number.isFinite(value) || value <= 0 || value >= 150) continue
    if (/^PMU tdie\d+$/.test(name)) soc.push(value)
    else if (name === 'gas gauge battery') battery.push(value)
  }
  return { soc: soc.length ? Math.max(...soc) : null, battery: battery.length ? Math.max(...battery) : null }
}

export interface FanReading { rpm: number; minRpm: number | null; maxRpm: number | null }

// Output is "fans\t<count>" followed by "fan<N>\t<actual>\t<min>\t<max>" lines; -1 marks an unreadable key.
function parseFans(output: string): FanReading[] {
  const fans: FanReading[] = []
  for (const line of output.split('\n')) {
    const [name, actual, min, max] = line.split('\t')
    if (!/^fan\d+$/.test(name ?? '')) continue
    const rpm = Number(actual)
    if (!Number.isFinite(rpm) || rpm < 0 || rpm > 30_000) continue
    const optional = (value: string | undefined) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null
    fans.push({ rpm, minRpm: optional(min), maxRpm: optional(max) })
  }
  return fans
}

const helperDirectory = join(os.homedir(), '.mac-system-monitor')
const helperFrameworks = { thermal: ['CoreFoundation', 'IOKit'], fans: ['IOKit'] } as const
type HelperName = keyof typeof helperFrameworks
const helperReady = new Map<HelperName, Promise<string | null>>()

// Native helpers read sensors without elevated privileges. Each is compiled locally once
// (requires Xcode command line tools); if that is not possible the metrics stay unavailable.
function ensureHelper(name: HelperName): Promise<string | null> {
  let ready = helperReady.get(name)
  if (!ready) {
    ready = (async () => {
      if (process.platform !== 'darwin') return null
      const sourcePath = fileURLToPath(new URL(`./native/${name}.c`, import.meta.url))
      const binaryPath = join(helperDirectory, `${name}-helper`)
      try {
        const [source, binary] = await Promise.all([stat(sourcePath), stat(binaryPath).catch(() => null)])
        if (binary && binary.mtimeMs >= source.mtimeMs) return binaryPath
        await mkdir(helperDirectory, { recursive: true })
        const frameworks = helperFrameworks[name].flatMap((framework) => ['-framework', framework])
        await execFileAsync('/usr/bin/clang', ['-O2', sourcePath, '-o', binaryPath, ...frameworks], { timeout: 30_000 })
        return binaryPath
      } catch {
        return null
      }
    })()
    helperReady.set(name, ready)
  }
  return ready
}

function parseVmStat(output: string): { pageSize: number; activeBytes: number; wiredBytes: number; compressedBytes: number; cachedBytes: number } | null {
  const pageSizeMatch = output.match(/page size of ([\d,]+) bytes/i)
  if (!pageSizeMatch) return null
  const pageSize = Number(pageSizeMatch[1].replaceAll(',', ''))
  const pages = (label: string) => {
    const match = output.match(new RegExp(`^${label}:\\s*([\\d,]+)`, 'm'))
    return match ? Number(match[1].replaceAll(',', '')) : null
  }
  const active = pages('Pages active')
  const wired = pages('Pages wired down')
  const compressed = pages('Pages occupied by compressor')
  const fileBacked = pages('File-backed pages')
  if ([active, wired, compressed, fileBacked].some((value) => value === null)) return null
  return {
    pageSize,
    activeBytes: (active ?? 0) * pageSize,
    wiredBytes: (wired ?? 0) * pageSize,
    compressedBytes: (compressed ?? 0) * pageSize,
    cachedBytes: (fileBacked ?? 0) * pageSize,
  }
}

export class MacCollector {
  private previousCpus = os.cpus()
  private previousNetwork: { received: number; sent: number; at: number } | null = null
  private processCache: ProcessInfo[] = []
  private processAt = 0
  private diskCache: { total: number; used: number; available: number } | null = null
  private diskAt = 0
  private thermalCache: ThermalReading | null = null
  private thermalAt = 0
  private fansCache: FanReading[] = []
  private fansAt = 0
  private vmStatCache: ReturnType<typeof parseVmStat> = null
  private vmStatAt = 0
  private hardwareCache: Snapshot['hardware'] | null = null

  private async hardware(): Promise<Snapshot['hardware']> {
    if (this.hardwareCache) return this.hardwareCache
    const [model, chip, macOS, performance, efficiency] = await Promise.all([
      command('/usr/sbin/sysctl', ['-n', 'hw.model']),
      command('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string']),
      command('/usr/bin/sw_vers', ['-productVersion']),
      command('/usr/sbin/sysctl', ['-n', 'hw.perflevel0.physicalcpu']),
      command('/usr/sbin/sysctl', ['-n', 'hw.perflevel1.physicalcpu']),
    ])
    this.hardwareCache = {
      model,
      chip,
      architecture: os.arch(),
      hostname: os.hostname(),
      macOS,
      cpuCores: os.cpus().length,
      performanceCores: performance ? Number(performance) || null : null,
      efficiencyCores: efficiency ? Number(efficiency) || null : null,
      totalMemoryBytes: os.totalmem(),
      uptimeSeconds: os.uptime(),
    }
    return this.hardwareCache
  }

  private async processes(now: number): Promise<ProcessInfo[]> {
    if (now - this.processAt < 2500) return this.processCache
    const output = await command('/bin/ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,etime=,args='])
    if (output !== null) this.processCache = parseProcesses(output).slice(0, 30)
    this.processAt = now
    return this.processCache
  }

  private async disk(now: number): Promise<{ total: number; used: number; available: number } | null> {
    if (now - this.diskAt < 60_000) return this.diskCache
    const output = await command('/bin/df', ['-kP', '/'])
    const fields = output?.split('\n').at(-1)?.trim().split(/\s+/)
    if (fields && fields.length >= 5) {
      const total = Number(fields[1]) * 1024
      const available = Number(fields[3]) * 1024
      // On APFS the root snapshot's own "Used" column excludes data volumes, so derive usage from capacity.
      const used = total - available
      if ([total, used, available].every(Number.isFinite)) this.diskCache = { total, used, available }
    }
    this.diskAt = now
    return this.diskCache
  }

  private async vmStat(now: number): Promise<ReturnType<typeof parseVmStat>> {
    if (now - this.vmStatAt < 5000) return this.vmStatCache
    const output = await command('/usr/bin/vm_stat', [])
    this.vmStatCache = output ? parseVmStat(output) : null
    this.vmStatAt = now
    return this.vmStatCache
  }

  private async thermal(now: number): Promise<ThermalReading | null> {
    if (now - this.thermalAt < 2000) return this.thermalCache
    this.thermalAt = now
    const binary = await ensureHelper('thermal')
    const output = binary ? await command(binary, []) : null
    this.thermalCache = output ? parseThermal(output) : null
    return this.thermalCache
  }

  private async fans(now: number): Promise<FanReading[]> {
    if (now - this.fansAt < 2000) return this.fansCache
    this.fansAt = now
    const binary = await ensureHelper('fans')
    const output = binary ? await command(binary, []) : null
    this.fansCache = output ? parseFans(output) : []
    return this.fansCache
  }

  async sample(networkOutput?: string | null): Promise<Omit<Snapshot, 'ollama' | 'history' | 'historyRevision' | 'liveGeneration'>> {
    const now = Date.now()
    const [hardware, processes, disk, swapOutput, batteryOutput, networkData, vmStat, gpuOutput, thermal, fans] = await Promise.all([
      this.hardware(),
      this.processes(now),
      this.disk(now),
      command('/usr/sbin/sysctl', ['-n', 'vm.swapusage']),
      command('/usr/bin/pmset', ['-g', 'batt']),
      networkOutput === undefined ? command('/usr/sbin/netstat', ['-ibn']) : Promise.resolve(networkOutput),
      this.vmStat(now),
      command('/usr/sbin/ioreg', ['-r', '-d', '1', '-w0', '-c', 'IOAccelerator']),
      this.thermal(now),
      this.fans(now),
    ])
    const gpu = gpuOutput ? parseGpu(gpuOutput) : null
    const cpu = cpuSample(this.previousCpus)
    this.previousCpus = os.cpus()
    const totalMemory = os.totalmem()
    const freeMemory = os.freemem()
    const usedMemory = vmStat ? vmStat.activeBytes + vmStat.wiredBytes + vmStat.compressedBytes : totalMemory - freeMemory
    const availableMemory = totalMemory - usedMemory
    const network = networkData ? parseNetwork(networkData) : null
    const elapsed = this.previousNetwork ? (now - this.previousNetwork.at) / 1000 : 0
    const receivedRate = network && this.previousNetwork && elapsed > 0
      ? Math.max(0, (network.received - this.previousNetwork.received) / elapsed)
      : null
    const sentRate = network && this.previousNetwork && elapsed > 0
      ? Math.max(0, (network.sent - this.previousNetwork.sent) / elapsed)
      : null
    if (network) this.previousNetwork = { received: network.received, sent: network.sent, at: now }

    const swapMatch = swapOutput?.match(/used\s*=\s*([\d.]+[KMGTP]?)/i)
    const swapBytes = swapMatch ? parseBytes(swapMatch[1]) : null
    const batteryPercent = batteryOutput?.match(/(\d+)%/)
    const batteryState = batteryOutput?.match(/;\s*([^;]+);/)
    const socTemperature = thermal?.soc != null
      ? metric(thermal.soc, 'celsius', 'measured', 'iohid_pmu_tdie_hottest')
      : unavailable<number>('celsius')
    const notMac = process.platform !== 'darwin'

    return {
      timestamp: now,
      hardware: { ...hardware, uptimeSeconds: os.uptime() },
      cpu: {
        total: metric(cpu.total, '%', 'calculated', 'os_cpu_time_delta'),
        user: metric(cpu.user, '%', 'calculated', 'os_cpu_time_delta'),
        system: metric(cpu.system, '%', 'calculated', 'os_cpu_time_delta'),
        idle: metric(cpu.idle, '%', 'calculated', 'os_cpu_time_delta'),
        perCore: cpu.perCore.map((value) => metric(value, '%', 'calculated', 'os_cpu_time_delta')),
        temperature: socTemperature,
        frequency: unavailable('MHz'),
      },
      gpu: {
        utilization: gpu ? metric(gpu.utilization, '%', 'measured', 'ioreg_accelerator_device_utilization') : unavailable('%', notMac ? 'macos_only' : 'ioreg_unavailable'),
        temperature: unavailable('celsius'),
        cores: gpu?.cores != null ? metric(gpu.cores, 'cores', 'measured', 'ioreg_gpu_core_count') : unavailable('cores'),
      },
      memory: {
        totalBytes: metric(totalMemory, 'bytes', 'measured', 'os_totalmem'),
        usedBytes: metric(usedMemory, 'bytes', 'calculated', vmStat ? 'vm_stat_active_wired_compressed' : 'os_totalmem_minus_freemem'),
        availableBytes: metric(availableMemory, 'bytes', 'calculated', vmStat ? 'os_totalmem_minus_vm_stat_used' : 'os_freemem'),
        wiredBytes: vmStat ? metric(vmStat.wiredBytes, 'bytes', 'measured', 'vm_stat_pages_wired_down') : unavailable('bytes', 'vm_stat_unavailable'),
        compressedBytes: vmStat ? metric(vmStat.compressedBytes, 'bytes', 'measured', 'vm_stat_pages_compressed') : unavailable('bytes', 'vm_stat_unavailable'),
        cachedBytes: vmStat ? metric(vmStat.cachedBytes, 'bytes', 'measured', 'vm_stat_file_backed_pages') : unavailable('bytes', 'vm_stat_unavailable'),
        swapBytes: swapBytes === null ? unavailable('bytes', notMac ? 'macos_only' : 'sysctl_unavailable') : metric(swapBytes, 'bytes', 'measured', 'sysctl_vm.swapusage'),
        pressure: unavailable('state', notMac ? 'macos_only' : 'pressure_api_unavailable'),
      },
      disk: {
        name: disk ? 'Startup volume' : null,
        mount: '/',
        totalBytes: disk ? metric(disk.total, 'bytes', 'measured', 'df') : unavailable('bytes', 'df_unavailable'),
        usedBytes: disk ? metric(disk.used, 'bytes', 'calculated', 'df_total_minus_available') : unavailable('bytes', 'df_unavailable'),
        availableBytes: disk ? metric(disk.available, 'bytes', 'measured', 'df') : unavailable('bytes', 'df_unavailable'),
        readBytesPerSecond: unavailable('bytes/s', 'disk_io_counters_unavailable'),
        writeBytesPerSecond: unavailable('bytes/s', 'disk_io_counters_unavailable'),
      },
      network: {
        interface: network?.name ?? null,
        localAddress: network?.name ? Object.values(os.networkInterfaces()[network.name] ?? []).find((entry) => entry.family === 'IPv4' && !entry.internal)?.address ?? null : null,
        receivedBytesPerSecond: receivedRate === null ? unavailable('bytes/s', 'netstat_counter_baseline') : metric(receivedRate, 'bytes/s', 'calculated', 'netstat_interface_counters'),
        sentBytesPerSecond: sentRate === null ? unavailable('bytes/s', 'netstat_counter_baseline') : metric(sentRate, 'bytes/s', 'calculated', 'netstat_interface_counters'),
      },
      thermal: {
        cpuTemperature: socTemperature,
        gpuTemperature: unavailable('celsius', 'no_dedicated_gpu_sensor'),
        batteryTemperature: thermal?.battery != null ? metric(thermal.battery, 'celsius', 'measured', 'iohid_gas_gauge_battery') : unavailable('celsius'),
        fanRpm: fans.length
          ? metric(fans.reduce((sum, fan) => sum + fan.rpm, 0) / fans.length, 'RPM', 'measured', 'applesmc_fan_actual_average')
          : unavailable('RPM', notMac ? 'macos_only' : 'fan_sensor_unavailable'),
        fans,
        pressure: unavailable('state', notMac ? 'macos_only' : 'thermal_pressure_not_exposed'),
        powerWatts: unavailable('W', 'powermetrics_not_configured'),
      },
      battery: {
        percent: batteryPercent ? metric(Number(batteryPercent[1]), '%', 'measured', 'pmset') : unavailable('%', 'battery_not_detected'),
        state: batteryState ? metric(batteryState[1].trim(), '', 'measured', 'pmset') : unavailable('', 'battery_not_detected'),
        cycleCount: unavailable('cycles', 'battery_cycle_count_not_exposed'),
      },
      processes,
    }
  }
}

export const collectorInternals = { parseFans, parseThermal, parseGpu, parseBytes, parseProcesses, parseNetwork, parseVmStat, runtimeSeconds, cpuSample, redactCommand }