import { lazy, Suspense, useEffect, useState } from 'react'
import { Activity, ArrowDown, ArrowUp, BrainCircuit, ChevronRight, Cpu, Download, Gauge, HardDrive, LayoutDashboard, MemoryStick, Radio, Trash2, Waves, Zap } from 'lucide-react'
import { MetricTile } from './components/MetricTile'
import { SpeedGauge } from './components/Gauge'
import { Thermometer } from './components/Thermometer'
import { fanGaugeProps } from './components/gaugeProps'
import { LazyTelemetryChart as TelemetryChart } from './components/LazyTelemetryChart'
import type { ChartPoint } from './components/TelemetryChart'
import { aggregateModelPerformance } from './shared/performance'
import type { Snapshot, ProcessInfo } from '../backend/types'
import type { InferenceSession } from './shared/session'
import { formatAge, formatBytes, formatClock, formatDuration, formatMetricValue, formatRate, formatTokenCount } from './utils/format'
import './App.css'

type Page = 'overview' | 'workloads' | 'sessions' | 'benchmark'
type ProcessSort = 'cpuPercent' | 'memoryBytes' | 'name'
const BenchmarkView = lazy(() => import('./components/BenchmarkView').then((module) => ({ default: module.BenchmarkView })))

function useTelemetry() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const stream = new EventSource('/api/stream')
    stream.onopen = () => setConnected(true)
    stream.onerror = () => setConnected(false)
    stream.onmessage = (event) => {
      try {
        setSnapshot(JSON.parse(event.data) as Snapshot)
      } catch {
        setConnected(false)
      }
    }
    return () => stream.close()
  }, [])

  return { snapshot, connected }
}

function MetricPlaceholder({ label, value }: { label: string; value: string }) {
  return <div className="stat-pair"><span>{label}</span><strong className={value === 'Unavailable' ? 'unavailable' : ''}>{value}</strong></div>
}

function App() {
  const { snapshot, connected } = useTelemetry()
  const [page, setPage] = useState<Page>('overview')
  const [sessions, setSessions] = useState<InferenceSession[]>([])
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<ProcessSort>('cpuPercent')

  const historyRevision = snapshot?.historyRevision
  useEffect(() => {
    const load = () => void fetch('/api/history', { cache: 'no-store' }).then((response) => response.ok ? response.json() as Promise<InferenceSession[]> : []).then(setSessions).catch(() => undefined)
    load()
    const timer = window.setInterval(load, 4000)
    return () => window.clearInterval(timer)
  }, [historyRevision])

  const systemHistory: ChartPoint[] = snapshot?.history.map((point) => ({
    timestamp: point.timestamp,
    cpu: point.cpu,
    gpu: point.gpu,
    memory: point.memory === null ? null : point.memory / 1024 ** 3,
    swap: point.swap === null ? null : point.swap / 1024 ** 3,
    live: point.generation,
  })) ?? []
  const performanceHistory: ChartPoint[] = [...sessions].reverse().map((session) => ({
    timestamp: session.startedAt,
    generation: session.metrics.generationSpeed.value,
    prefill: session.metrics.prefillSpeed.value,
  }))
  const models = snapshot?.ollama.models ?? []
  const llmProcesses = snapshot?.processes.filter((process) => process.llmRelated) ?? []
  const latestSession = sessions[0]
  const focusedModel = models[0]?.name ?? null
  const hasLlmRunner = llmProcesses.some((process) => !/^ollama$/i.test(process.name))
  const showWorkloadMemory = models.length > 0 || snapshot?.ollama.activeRequests || hasLlmRunner
  const measuredContextUsed = latestSession && latestSession.metrics.promptTokens.value !== null && latestSession.metrics.outputTokens.value !== null
    ? latestSession.metrics.promptTokens.value + latestSession.metrics.outputTokens.value
    : null
  const contextModel = latestSession ? models.find((model) => model.name === latestSession.model) : models[0]
  const contextMaximum = contextModel?.contextLength.value ?? null
  const filteredProcesses = [...(snapshot?.processes ?? [])]
    .filter((process) => `${process.name} ${process.command}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((left, right) => sort === 'name' ? left.name.localeCompare(right.name) : right[sort] - left[sort])
    .slice(0, 20)

  const navigate = (next: Page) => setPage(next)
  const clearHistory = async () => {
    if (!window.confirm('Clear locally stored LLM session history?')) return
    await fetch('/api/history', { method: 'DELETE' })
    setSessions([])
  }
  const exportHistory = (format: 'json' | 'csv') => {
    const content = format === 'json'
      ? JSON.stringify(sessions, null, 2)
      : [
        'model,started,duration_seconds,prompt_tokens,output_tokens,prefill_tok_s,generation_tok_s,ttft_ms,ollama_version',
        ...sessions.map((session) => [session.model, new Date(session.startedAt).toISOString(), session.metrics.totalDuration.value ?? '', session.metrics.promptTokens.value ?? '', session.metrics.outputTokens.value ?? '', session.metrics.prefillSpeed.value ?? '', session.metrics.generationSpeed.value ?? '', session.metrics.ttft.value ?? '', session.ollamaVersion ?? ''].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')),
      ].join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `mac-system-monitor-sessions.${format}`
    link.click()
    URL.revokeObjectURL(url)
  }
  const changeSort = (next: ProcessSort) => setSort(next)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-symbol"><Activity size={17} strokeWidth={2.3} /></div>
          <div><strong>FIELDNOTE</strong><span>SYSTEM MONITOR</span></div>
        </div>
        <div className="nav-caption">MONITOR</div>
        <nav aria-label="Main navigation">
          <button className={page === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('overview')}><LayoutDashboard size={16} />Overview</button>
          <button className={page === 'workloads' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('workloads')}><BrainCircuit size={16} />AI workloads<span className="nav-count">{models.length}</span></button>
          <button className={page === 'sessions' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('sessions')}><Waves size={16} />Model performance</button>
          <button className={page === 'benchmark' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('benchmark')}><Gauge size={16} />Benchmark</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-device"><span className="device-dot" /><div><strong>{snapshot?.hardware.model ?? 'Mac device'}</strong><small>{snapshot?.hardware.chip ?? 'Hardware discovery'}</small></div></div>
          <div className="privacy-note"><span>LOCAL ONLY</span><p>Telemetry stays on this Mac.</p></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>MAC SYSTEM MONITOR</span><ChevronRight size={13} /><strong>{page === 'overview' ? 'Overview' : page === 'workloads' ? 'AI workloads' : page === 'sessions' ? 'Model performance' : 'Benchmark'}</strong></div>
          <div className="topbar-status">
            <span className={`connection-state ${connected ? 'online' : ''}`}><i />{connected ? 'LIVE' : 'RECONNECTING'}</span>
            <span className="updated-at">{snapshot ? `Updated ${formatClock(snapshot.timestamp)}` : 'Waiting for telemetry'}</span>
          </div>
        </header>

        {!snapshot ? (
          <div className="loading-state"><span className="loading-pulse" /><p>Connecting to the local telemetry service</p></div>
        ) : (
          <div className="page-content">
            {page === 'overview' && <>
              <section className="page-intro">
                <div><span className="eyebrow">YOUR MACHINE, IN CONTEXT</span><h1>System overview</h1><p>{snapshot.hardware.model ?? snapshot.hardware.hostname} <span>/</span> {snapshot.hardware.chip ?? 'Chip unavailable'} <span>/</span> {formatBytes(snapshot.hardware.totalMemoryBytes)} unified memory</p></div>
                <div className="intro-side"><span className="live-mark" />{snapshot.hardware.macOS ? `macOS ${snapshot.hardware.macOS}` : 'macOS version unavailable'}<small>UPTIME {formatDuration(snapshot.hardware.uptimeSeconds)}</small></div>
              </section>

              <section className="summary-grid" aria-label="System summary">
                <MetricTile label="CPU LOAD" value={snapshot.cpu.total} color="mint" detail={`${snapshot.hardware.cpuCores} cores · ${formatMetricValue(snapshot.cpu.user)} user`} />
                <MetricTile label="GPU LOAD" value={snapshot.gpu.utilization} color="orange" detail="Apple GPU utilization" />
                <MetricTile label="UNIFIED MEMORY" value={snapshot.memory.usedBytes} unit="bytes" color="lime" total={snapshot.memory.totalBytes} detail={`${formatBytes(snapshot.memory.availableBytes.value)} available`} />
                <MetricTile label="CPU TEMPERATURE" value={snapshot.thermal.cpuTemperature} unit="celsius" color="rose" detail="hottest SoC die sensor" />
                <MetricTile label="STARTUP DISK" value={snapshot.disk.usedBytes} unit="bytes" color="lime" total={snapshot.disk.totalBytes} detail={`${formatBytes(snapshot.disk.availableBytes.value)} available`} />
                {snapshot.battery.percent.value !== null && <MetricTile label="BATTERY" value={snapshot.battery.percent} unit="%" color="orange" detail={snapshot.battery.state.value ?? 'state unavailable'} />}
              </section>

              <section className="memory-detail-strip" aria-label="Memory breakdown">
                <div title={`${snapshot.memory.wiredBytes.quality} · ${snapshot.memory.wiredBytes.source}`}><span>WIRED</span><strong>{formatBytes(snapshot.memory.wiredBytes.value)}</strong></div>
                <div title={`${snapshot.memory.compressedBytes.quality} · ${snapshot.memory.compressedBytes.source}`}><span>COMPRESSED</span><strong>{formatBytes(snapshot.memory.compressedBytes.value)}</strong></div>
                <div title={`${snapshot.memory.cachedBytes.quality} · ${snapshot.memory.cachedBytes.source}`}><span>FILE-BACKED</span><strong>{formatBytes(snapshot.memory.cachedBytes.value)}</strong></div>
                <div title={`${snapshot.memory.swapBytes.quality} · ${snapshot.memory.swapBytes.source}`}><span>SWAP USED</span><strong>{formatBytes(snapshot.memory.swapBytes.value)}</strong></div>
                <div title={`${snapshot.memory.pressure.quality} · ${snapshot.memory.pressure.source}`}><span>MEMORY PRESSURE</span><strong>{snapshot.memory.pressure.value ?? 'Unavailable'}</strong></div>
              </section>

              <section className="cooling-panel" aria-label="Cooling" title={`${snapshot.thermal.fanRpm.quality.toUpperCase()} · ${snapshot.thermal.fanRpm.source}`}>
                <div className="panel-heading"><div><span className="eyebrow">COOLING · MEASURED</span><h3>Fan speed &amp; temperature</h3></div><span className="range-label">{snapshot.thermal.fans.length ? `${formatMetricValue(snapshot.thermal.fanRpm, 'RPM')} AVG` : 'FANS UNAVAILABLE'}</span></div>
                {snapshot.thermal.fans.length || snapshot.thermal.cpuTemperature.value !== null
                  ? <div className="fan-gauges">
                    {snapshot.thermal.fans.map((fan, index) => <SpeedGauge key={`fan-${index}`} {...fanGaugeProps(fan, index)} />)}
                    {snapshot.thermal.cpuTemperature.value !== null && <Thermometer label="CPU" celsius={snapshot.thermal.cpuTemperature.value} caption="SoC die · 0–120 °C" />}
                  </div>
                  : <p className="inline-note">Fan and temperature telemetry are unavailable on this Mac.</p>}
              </section>

              <section className={`llm-summary ${models.length || snapshot.ollama.activeRequests || hasLlmRunner ? 'has-workload' : ''}`}>
                <div className="llm-summary-main">
                  <div className="llm-icon"><BrainCircuit size={20} /></div>
                  <div><span className="eyebrow">LOCAL INFERENCE</span><h2>LLM monitor</h2><p>{focusedModel ?? 'No active model'}</p></div>
                  <span className={`state-pill state-${snapshot.ollama.status.toLowerCase()}`}><i />{snapshot.ollama.status}</span>
                </div>
                <div className="llm-summary-metrics">
                  <div><span>{snapshot.liveGeneration.value !== null ? 'GENERATION · LIVE' : 'GENERATION'}</span><strong>{snapshot.liveGeneration.value !== null ? formatRate(snapshot.liveGeneration.value, 'tok/s') : latestSession ? formatRate(latestSession.metrics.generationSpeed.value, 'tok/s') : 'Unavailable'}</strong><small>{snapshot.liveGeneration.value !== null ? 'streaming now · estimated' : latestSession ? `${latestSession.model} · ${formatAge(latestSession.startedAt)}${latestSession.origin === 'server_log' ? ' · est.' : ''}` : 'route requests through local proxy'}</small></div>
                  <div><span>WORKLOAD MEMORY</span><strong>{showWorkloadMemory && llmProcesses.length ? formatBytes(llmProcesses.reduce((sum, process) => sum + process.memoryBytes, 0)) : models[0]?.sizeBytes.value ? `~${formatBytes(models[0].sizeBytes.value)}` : 'Unavailable'}</strong><small>{showWorkloadMemory && llmProcesses.length ? 'measured process RSS' : models.length ? 'estimated model size' : 'no active workload'}</small></div>
                  <div><span>OLLAMA</span><strong>{snapshot.ollama.version ?? (snapshot.ollama.running ? 'Version unavailable' : 'Not detected')}</strong><small>{snapshot.ollama.running ? `${models.length} loaded model${models.length === 1 ? '' : 's'}` : snapshot.ollama.installed ? 'installed · service offline' : 'local API unavailable'}</small></div>
                  <div><span>CONTEXT · LAST REQUEST</span><strong>{measuredContextUsed !== null && contextMaximum ? `${formatTokenCount(measuredContextUsed)} / ${formatTokenCount(contextMaximum)}` : 'Unavailable'}</strong><small>prompt + output tokens</small></div>
                  <div><span>THERMAL PRESSURE</span><strong>{formatMetricValue(snapshot.thermal.pressure)}</strong><small>{snapshot.thermal.pressure.quality}</small></div>
                  <button className="text-action" onClick={() => navigate('workloads')}>Open monitor <ChevronRight size={14} /></button>
                </div>
                {snapshot.ollama.error && <p className="inline-note">{snapshot.ollama.error}</p>}
              </section>

              <div className="section-title"><div><span className="eyebrow">REAL-TIME</span><h2>System activity</h2></div><span className="range-label"><Radio size={13} />LIVE · LAST 60 SEC</span></div>
              <section className="chart-grid">
                <TelemetryChart title="CPU utilization" data={systemHistory} series={[{ key: 'cpu', name: 'CPU', color: '#93e5bd' }]} unit="%" area windowMs={60_000} />
                <TelemetryChart title="GPU utilization" data={systemHistory} series={[{ key: 'gpu', name: 'GPU', color: '#f0a35e' }]} unit="%" area windowMs={60_000} />
                <div className="chart-wide"><TelemetryChart title="Unified memory & swap" data={systemHistory} series={[{ key: 'memory', name: 'Used', color: '#e4b86c' }, { key: 'swap', name: 'Swap', color: '#e07a7a' }]} unit="GB" windowMs={60_000} /></div>
              </section>

              <section className="resource-strip">
                <div className="resource-head"><div className="resource-icon"><HardDrive size={16} /></div><div><span className="eyebrow">STARTUP VOLUME</span><h3>{snapshot.disk.name ?? 'Storage'}</h3></div></div>
                <div className="storage-summary"><strong>{formatBytes(snapshot.disk.usedBytes.value)}</strong><span>used of {formatBytes(snapshot.disk.totalBytes.value)}</span></div>
                <div className="storage-track"><i style={{ width: snapshot.disk.totalBytes.value && snapshot.disk.usedBytes.value !== null ? `${Math.min(100, snapshot.disk.usedBytes.value / snapshot.disk.totalBytes.value * 100)}%` : '0%' }} /></div>
                <div className="network-stats"><span><ArrowDown size={13} />{formatRate(snapshot.network.receivedBytesPerSecond.value, 'bytes/s')}</span><span><ArrowUp size={13} />{formatRate(snapshot.network.sentBytesPerSecond.value, 'bytes/s')}</span><small>{snapshot.network.interface ?? 'Interface unavailable'} · {snapshot.network.localAddress ?? 'IP unavailable'}</small></div>
              </section>

              <section className="process-section">
                <div className="section-title compact"><div><span className="eyebrow">TOP PROCESSES</span><h2>Process activity</h2></div><label className="search-box"><span className="sr-only">Filter processes</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter processes" /></label></div>
                <ProcessTable processes={filteredProcesses} sort={sort} onSort={changeSort} />
              </section>
            </>}

            {page === 'workloads' && <>
              <section className="page-intro detail-intro"><div><span className="eyebrow">OLLAMA · MLX · LOCAL RUNTIMES</span><h1>AI / LLM workloads</h1><p>Runtime state and system impact, collected from this machine.</p></div><span className={`connection-state ${snapshot.ollama.running ? 'online' : ''}`}><i />{snapshot.ollama.running ? 'OLLAMA CONNECTED' : 'OLLAMA UNAVAILABLE'}</span></section>
              <div className="section-title"><div><span className="eyebrow">RUNTIME</span><h2>Active models</h2></div><span className="range-label">{models.length} LOADED</span></div>
              {models.length ? <section className="model-list">{models.map((model) => <article className="model-row" key={model.name}>
                <div className="model-mark"><BrainCircuit size={18} /></div><div className="model-identity"><h3>{model.name}</h3><p>{[model.family, model.parameterSize, model.quantization].filter(Boolean).join(' · ') || 'Model metadata unavailable'}</p></div>
                <div className="model-spec"><span>MODEL SIZE</span><strong>{model.sizeBytes.value === null ? 'Unavailable' : `~${formatBytes(model.sizeBytes.value)}`}</strong></div>
                <div className="model-spec"><span>BACKEND</span><strong>{model.backend.value ?? 'Unavailable'}</strong><small>{model.backend.quality}</small></div>
                <div className="model-spec" title={`${model.contextLength.quality} · ${model.contextLength.source}`}><span>CONTEXT</span><strong>{model.contextLength.value ? formatTokenCount(model.contextLength.value) : 'Unavailable'}</strong></div>
                <div className="model-spec"><span>EXPIRES</span><strong>{model.expiresAt ? new Date(model.expiresAt).toLocaleTimeString() : 'Unavailable'}</strong></div>
              </article>)}</section> : <div className="empty-panel"><BrainCircuit size={22} /><strong>No loaded Ollama models</strong><span>{snapshot.ollama.installed ? 'Ollama is installed but no model is currently loaded.' : 'No local Ollama installation was detected.'}</span></div>}
              {measuredContextUsed !== null && contextMaximum && <section className="context-monitor"><div><span className="eyebrow">LAST MEASURED CONTEXT</span><strong>{formatTokenCount(measuredContextUsed)} / {formatTokenCount(contextMaximum)}</strong></div><span>{Math.min(100, measuredContextUsed / contextMaximum * 100).toFixed(1)}%</span><div className="context-track"><i style={{ width: `${Math.min(100, measuredContextUsed / contextMaximum * 100)}%` }} /></div></section>}

              <div className="detail-columns">
                <section className="detail-panel"><div className="panel-heading"><div><span className="eyebrow">MEASURED REQUESTS</span><h3>Inference performance</h3></div><Zap size={16} /></div>
                  <div className="performance-values">
                    <MetricPlaceholder label="Generation · live" value={snapshot.liveGeneration.value !== null ? `${formatRate(snapshot.liveGeneration.value, 'tok/s')} (est.)` : 'Idle'} />
                    <MetricPlaceholder label="Generation · last request" value={latestSession ? formatRate(latestSession.metrics.generationSpeed.value, 'tok/s') : 'Unavailable'} />
                    <MetricPlaceholder label="Prefill · last request" value={latestSession ? formatRate(latestSession.metrics.prefillSpeed.value, 'tok/s') : 'Unavailable'} />
                    <MetricPlaceholder label="Time to first token" value={latestSession?.metrics.ttft.value === null || !latestSession ? 'Unavailable' : `${latestSession.metrics.ttft.value.toFixed(0)} ms`} />
                    <MetricPlaceholder label="Prompt / output tokens" value={latestSession ? `${latestSession.metrics.promptTokens.value ?? 'Unavailable'} / ${latestSession.metrics.outputTokens.value ?? 'Unavailable'}` : 'Unavailable'} />
                  </div>
                  <p className="panel-footnote">{latestSession ? `Last request: ${latestSession.model}, ${formatAge(latestSession.startedAt)}${focusedModel && focusedModel !== latestSession.model ? ` — not the loaded model (${focusedModel})` : ''}. ` : ''}Proxied requests are measured exactly. Direct requests are estimated from Ollama's server log (token counts and speed need Ollama trace logging; otherwise only duration). Prefill excludes prompt-cached tokens.</p>
                </section>
                <section className="detail-panel"><div className="panel-heading"><div><span className="eyebrow">HARDWARE IMPACT</span><h3>Current system state</h3></div><Cpu size={16} /></div>
                  <div className="impact-grid">
                    <MetricTile label="CPU" value={snapshot.cpu.total} unit="%" color="mint" />
                    <MetricTile label="GPU" value={snapshot.gpu.utilization} unit="%" color="orange" />
                    <MetricTile label="TEMPERATURE" value={snapshot.thermal.cpuTemperature} unit="celsius" color="rose" />
                    <MetricTile label="FAN" value={snapshot.thermal.fanRpm} unit="RPM" color="lime" />
                    <MetricTile label="THERMAL PRESSURE" value={snapshot.thermal.pressure} color="rose" />
                    <MetricTile label="POWER" value={snapshot.thermal.powerWatts} unit="W" color="orange" />
                  </div>
                  <div className="memory-impact"><MemoryStick size={14} /><span>Unified memory</span><strong>{formatBytes(snapshot.memory.usedBytes.value)} / {formatBytes(snapshot.memory.totalBytes.value)}</strong></div>
                </section>
              </div>

              <section className="chart-grid workload-charts">
                <div className="chart-wide"><TelemetryChart title="Live generation speed" data={systemHistory} series={[{ key: 'live', name: 'Generation (est.)', color: '#93e5bd' }]} unit="tok/s" windowMs={60_000} area /></div>
                <TelemetryChart title="Generation throughput by request" data={performanceHistory} series={[{ key: 'generation', name: 'Generation', color: '#93e5bd' }]} unit="tok/s" />
                <TelemetryChart title="Prompt processing by request" data={performanceHistory} series={[{ key: 'prefill', name: 'Prefill', color: '#e4b86c' }]} unit="tok/s" />
              </section>
              <section className="correlation-note"><div className="note-icon"><Activity size={15} /></div><div><span className="eyebrow">PERFORMANCE / THERMAL CORRELATION</span><p>Thermal pressure, temperature, fan speed and power are unavailable from the current unprivileged sensor interfaces. The dashboard does not infer throttling from temperature or CPU usage.</p></div></section>
              <section className="process-section"><div className="section-title compact"><div><span className="eyebrow">RELATED RUNTIMES</span><h2>LLM processes</h2></div></div><ProcessTable processes={llmProcesses} sort={sort} onSort={changeSort} /></section>
              <section className="proxy-instructions"><span className="eyebrow">CAPTURE REQUEST METRICS LOCALLY</span><p>Point an Ollama-compatible client to this local proxy to record timing statistics and TTFT:</p><code>http://127.0.0.1:4174/ollama</code><small>Requests stay on this Mac. The proxy forwards only to Ollama on loopback; no cloud services are contacted.</small></section>
            </>}

            {page === 'sessions' && <>
              <section className="page-intro detail-intro"><div><span className="eyebrow">LOCAL MEASUREMENTS ONLY</span><h1>Model performance</h1><p>Comparison and history from requests observed on this Mac.</p></div><div className="export-actions"><button className="icon-button" title="Export CSV" onClick={() => exportHistory('csv')}><Download size={15} /></button><button className="icon-button" title="Export JSON" onClick={() => exportHistory('json')}><Activity size={15} /></button><button className="icon-button danger" title="Clear history" onClick={() => void clearHistory()}><Trash2 size={15} /></button></div></section>
              <section className="chart-grid workload-charts"><TelemetryChart title="Generation speed" data={performanceHistory} series={[{ key: 'generation', name: 'Generation', color: '#93e5bd' }]} unit="tok/s" /><TelemetryChart title="Prefill speed" data={performanceHistory} series={[{ key: 'prefill', name: 'Prefill', color: '#e4b86c' }]} unit="tok/s" /></section>
              <section className="history-section"><div className="section-title compact"><div><span className="eyebrow">OBSERVED SAMPLES</span><h2>Model comparison</h2></div><span className="range-label">{sessions.length} REQUESTS</span></div><ModelComparison sessions={sessions} /></section>
              <section className="history-section"><div className="section-title compact"><div><span className="eyebrow">ON-DEVICE STORAGE</span><h2>Recent requests</h2></div></div><SessionTable sessions={sessions} />
                <p className="panel-footnote">Only requests routed through the local proxy are included. History is stored locally and capped at 200 requests.</p>
              </section>
            </>}

            {page === 'benchmark' && <Suspense fallback={<div className="loading-state">Loading benchmark</div>}><BenchmarkView /></Suspense>}

            <footer className="page-footer"><span>FIELDNOTE · LOCAL MONITORING</span><span>{snapshot.hardware.architecture} · {snapshot.hardware.hostname}</span></footer>
          </div>
        )}
      </main>
    </div>
  )
}

function ProcessTable({ processes, sort, onSort }: { processes: ProcessInfo[]; sort: ProcessSort; onSort: (sort: ProcessSort) => void }) {
  return <div className="table-wrap"><table><thead><tr>
    <th><button onClick={() => onSort('name')}>PROCESS {sort === 'name' ? '↓' : ''}</button></th><th>PID</th><th><button onClick={() => onSort('cpuPercent')}>CPU {sort === 'cpuPercent' ? '↓' : ''}</button></th><th><button onClick={() => onSort('memoryBytes')}>MEMORY {sort === 'memoryBytes' ? '↓' : ''}</button></th><th>RUNTIME</th>
  </tr></thead><tbody>{processes.length ? processes.map((process) => <tr key={process.pid} className={process.llmRelated ? 'process-highlight' : ''}>
    <td><div className="process-name">{process.llmRelated && <BrainCircuit size={13} />}{process.name}</div><small>{process.command.slice(0, 90)}</small></td><td>{process.pid}</td><td>{process.cpuPercent.toFixed(1)}%</td><td>{formatBytes(process.memoryBytes)}</td><td>{formatDuration(process.runtimeSeconds)}</td>
  </tr>) : <tr><td colSpan={5} className="empty-table">No matching processes</td></tr>}</tbody></table></div>
}

function ModelComparison({ sessions }: { sessions: InferenceSession[] }) {
  const models = aggregateModelPerformance(sessions)
  if (!models.length) return <div className="empty-panel compact-empty"><Waves size={20} /><strong>No measured requests yet</strong><span>Route an Ollama request through the local proxy to start a machine-specific comparison.</span></div>
  return <div className="table-wrap"><table><thead><tr><th>MODEL</th><th>SAMPLES</th><th>AVG GENERATION</th><th>AVG PREFILL</th><th>AVG TTFT</th><th>AVG OUTPUT</th><th>PEAK</th><th>BASELINE</th></tr></thead><tbody>{models.map((summary) => {
    const range = summary.baselineMinimum !== null && summary.baselineMaximum !== null
      ? `${summary.baselineMinimum.toFixed(1)}–${summary.baselineMaximum.toFixed(1)} tok/s`
      : `Needs 3 samples (${summary.samples}/3)`
    return <tr key={summary.model}><td>{summary.model}</td><td>{summary.samples}</td><td>{formatRate(summary.averageGeneration, 'tok/s')}</td><td>{formatRate(summary.averagePrefill, 'tok/s')}</td><td>{summary.averageTtft?.toFixed(0) ?? 'Unavailable'}{summary.averageTtft !== null ? ' ms' : ''}</td><td>{summary.averageOutputTokens?.toFixed(0) ?? 'Unavailable'}</td><td>{formatRate(summary.peakGeneration, 'tok/s')}</td><td>{range}</td></tr>
  })}</tbody></table></div>
}

function SessionTable({ sessions }: { sessions: InferenceSession[] }) {
  if (!sessions.length) return <div className="empty-panel compact-empty"><Waves size={20} /><strong>No session history</strong><span>Measured generation requests will appear here.</span></div>
  return <div className="table-wrap"><table><thead><tr><th>MODEL</th><th>STARTED</th><th>DURATION</th><th>PROMPT</th><th>OUTPUT</th><th>PREFILL</th><th>GENERATION</th><th>TTFT</th></tr></thead><tbody>{sessions.map((session) => <tr key={session.id}>
    <td>{session.model}<small>{session.origin === 'server_log' ? 'estimated from Ollama log' : session.ollamaVersion ?? 'Ollama version unavailable'}</small></td><td>{formatClock(session.startedAt)}</td><td>{formatDuration(session.metrics.totalDuration.value)}</td><td>{session.metrics.promptTokens.value?.toLocaleString() ?? 'Unavailable'}</td><td>{session.metrics.outputTokens.value?.toLocaleString() ?? 'Unavailable'}</td><td>{formatRate(session.metrics.prefillSpeed.value, 'tok/s')}</td><td>{formatRate(session.metrics.generationSpeed.value, 'tok/s')}</td><td>{session.metrics.ttft.value === null ? 'Unavailable' : `${session.metrics.ttft.value.toFixed(0)} ms`}</td>
  </tr>)}</tbody></table></div>
}

export default App