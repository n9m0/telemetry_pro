import { useEffect, useState } from 'react'
import { AlertTriangle, Download, Gauge, Square } from 'lucide-react'
import { benchmarkContexts } from '../shared/benchmark'
import type { BenchmarkConfig, BenchmarkResult, BenchmarkState } from '../shared/benchmark'
import { formatBytes, formatClock, formatDuration, formatMetricValue, formatRate } from '../utils/format'

interface InstalledModel { name: string; size: number | null }

const initialConfig: BenchmarkConfig = {
  model: '',
  prompt: 'Explain how unified memory affects local language model inference. Give a concise answer with three key points.',
  contextSize: 4096,
  runs: 3,
  outputTokens: 128,
  warmup: true,
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  return response.json() as Promise<T>
}

export function BenchmarkView() {
  const [models, setModels] = useState<InstalledModel[]>([])
  const [results, setResults] = useState<BenchmarkResult[]>([])
  const [state, setState] = useState<BenchmarkState>({ running: false, model: null, completed: 0, total: 0, phase: 'idle', warning: null })
  const [config, setConfig] = useState(initialConfig)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const loadInitial = async () => {
      const [modelResult, resultResult, stateResult] = await Promise.allSettled([
        readJson<InstalledModel[]>('/api/models'),
        readJson<BenchmarkResult[]>('/api/benchmark/results'),
        readJson<BenchmarkState>('/api/benchmark/status'),
      ])
      if (!mounted) return
      if (modelResult.status === 'fulfilled') {
        setModels(modelResult.value)
        setConfig((current) => current.model || !modelResult.value[0] ? current : { ...current, model: modelResult.value[0].name })
      }
      if (resultResult.status === 'fulfilled') setResults(resultResult.value)
      if (stateResult.status === 'fulfilled') setState(stateResult.value)
    }
    void loadInitial()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!state.running) return
    let mounted = true
    const timer = window.setInterval(() => {
      void readJson<BenchmarkState>('/api/benchmark/status').then(async (next) => {
        if (!mounted) return
        setState(next)
        if (!next.running) setResults(await readJson<BenchmarkResult[]>('/api/benchmark/results'))
      }).catch(() => undefined)
    }, 900)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [state.running])

  const setField = <Key extends keyof BenchmarkConfig>(key: Key, value: BenchmarkConfig[Key]) => {
    setConfig((current) => ({ ...current, [key]: value }))
  }
  const runBenchmark = async () => {
    setError(null)
    try {
      const response = await fetch('/api/benchmark', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Benchmark could not be started.')
      setState({ running: true, model: config.model, completed: 0, total: config.runs, phase: 'validating', warning: null })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Benchmark could not be started.')
    }
  }
  const stopBenchmark = async () => {
    await fetch('/api/benchmark/cancel', { method: 'POST' })
  }
  const exportResults = (format: 'json' | 'csv') => {
    const content = format === 'json'
      ? JSON.stringify(results, null, 2)
      : [
        'model,context,run,mode,prefill_tok_s,generation_tok_s,ttft_ms,total_seconds,peak_memory_bytes,peak_temperature_c,average_fan_rpm,peak_fan_rpm,average_power_w,thermal_pressure,status,ollama_version',
        ...results.flatMap((result) => result.samples.length ? result.samples.map((sample) => [result.model, result.contextSize, sample.index, sample.mode, sample.metrics.prefillSpeed.value ?? '', sample.metrics.generationSpeed.value ?? '', sample.metrics.ttft.value ?? '', sample.metrics.totalDuration.value ?? '', result.peakMemoryBytes.value ?? '', result.peakTemperature.value ?? '', result.averageFanRpm.value ?? '', result.peakFanRpm.value ?? '', result.averagePowerWatts.value ?? '', result.thermalPressure.value ?? '', result.status, result.ollamaVersion ?? ''].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')) : [[result.model, result.contextSize, '', '', '', '', '', '', result.peakMemoryBytes.value ?? '', result.peakTemperature.value ?? '', result.averageFanRpm.value ?? '', result.peakFanRpm.value ?? '', result.averagePowerWatts.value ?? '', result.thermalPressure.value ?? '', result.status, result.ollamaVersion ?? ''].join(',')]),
      ].join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `mac-system-monitor-benchmarks.${format}`
    link.click()
    URL.revokeObjectURL(url)
  }

  return <>
    <section className="page-intro detail-intro">
      <div><span className="eyebrow">LOCAL · SEQUENTIAL · READ-ONLY</span><h1>Benchmark</h1><p>Compare installed Ollama models under repeatable settings.</p></div>
      <Gauge className="benchmark-mark" size={22} />
    </section>

    <div className="benchmark-layout">
      <section className="benchmark-controls">
        <div className="section-title compact"><div><span className="eyebrow">TEST CONFIGURATION</span><h2>Inference run</h2></div></div>
        {models.length ? <>
          <label className="form-field"><span>MODEL</span><select value={config.model} onChange={(event) => setField('model', event.target.value)} disabled={state.running}>{models.map((model) => <option key={model.name} value={model.name}>{model.name} · {formatBytes(model.size)}</option>)}</select></label>
          <label className="form-field"><span>PROMPT</span><textarea value={config.prompt} onChange={(event) => setField('prompt', event.target.value)} maxLength={4000} disabled={state.running} /></label>
          <div className="form-row">
            <label className="form-field"><span>CONTEXT SIZE</span><select value={config.contextSize} onChange={(event) => setField('contextSize', Number(event.target.value))} disabled={state.running}>{benchmarkContexts.map((context) => <option key={context} value={context}>{context >= 1024 ? `${context / 1024}K` : context}</option>)}</select></label>
            <label className="form-field"><span>RUNS</span><select value={config.runs} onChange={(event) => setField('runs', Number(event.target.value))} disabled={state.running}>{[1, 3, 5, 10].map((runs) => <option key={runs} value={runs}>{runs}</option>)}</select></label>
          </div>
          <label className="form-field token-field"><span>OUTPUT TOKEN TARGET</span><input type="number" min={1} max={1024} step={16} value={config.outputTokens} onChange={(event) => setField('outputTokens', Number(event.target.value))} disabled={state.running} /></label>
          <label className="check-field"><input type="checkbox" checked={config.warmup} onChange={(event) => setField('warmup', event.target.checked)} disabled={state.running} /><span>Warm-up before timed runs</span></label>
          {error && <div className="benchmark-error"><AlertTriangle size={14} />{error}</div>}
          {state.warning && <div className="benchmark-warning"><AlertTriangle size={14} />{state.warning}</div>}
          {state.running ? <div className="benchmark-running"><div><span className="loading-pulse" /><strong>{state.phase === 'warmup' ? 'Warming model' : 'Benchmark in progress'}</strong><span>{state.completed} / {state.total} runs</span></div><div className="benchmark-progress"><i style={{ width: `${state.total ? state.completed / state.total * 100 : 0}%` }} /></div><button className="stop-button" onClick={() => void stopBenchmark()}><Square size={13} fill="currentColor" />Stop benchmark</button></div>
            : <button className="run-button" onClick={() => void runBenchmark()} disabled={!config.model}><Gauge size={15} />Run benchmark</button>}
        </> : <div className="benchmark-no-model"><Gauge size={20} /><strong>No installed models found</strong><span>Start Ollama and install a model before running a benchmark. This tool never downloads models.</span></div>}
        <p className="benchmark-footnote">Benchmarks do not change fan speed, processor limits, or system power settings. Sensor values are included only when macOS exposes them.</p>
      </section>

      <section className="benchmark-results"><div className="section-title compact"><div><span className="eyebrow">ON-DEVICE RESULTS</span><h2>Recent benchmark runs</h2></div><div className="export-actions"><button className="icon-button" title="Export CSV" onClick={() => exportResults('csv')} disabled={!results.length}><Download size={15} /></button><button className="icon-button" title="Export JSON" onClick={() => exportResults('json')} disabled={!results.length}><Gauge size={15} /></button></div></div>
        {results.length ? <div className="benchmark-result-list">{results.map((result) => <article className="benchmark-result" key={result.id}>
          <div className="benchmark-result-head"><div><strong>{result.model}</strong><span>{result.contextSize / 1024}K context · {formatClock(result.startedAt)}</span></div><span className={`result-status result-${result.status}`}>{result.status}</span></div>
          {result.failureReason && <p className="benchmark-failure">{result.failureReason}</p>}
          {result.samples.length > 0 && <div className="table-wrap"><table><thead><tr><th>RUN</th><th>MODE</th><th>PREFILL</th><th>GENERATION</th><th>TTFT</th><th>TOTAL</th></tr></thead><tbody>{result.samples.map((sample) => <tr key={sample.index}><td>{sample.index}</td><td>{sample.mode === 'cold_start' ? 'Cold start' : 'Warm run'}</td><td>{formatRate(sample.metrics.prefillSpeed.value, 'tok/s')}</td><td>{formatRate(sample.metrics.generationSpeed.value, 'tok/s')}</td><td>{formatMetricValue(sample.metrics.ttft)}</td><td>{formatDuration(sample.metrics.totalDuration.value)}</td></tr>)}</tbody></table></div>}
          <div className="benchmark-sensors"><span>PEAK MEMORY <strong>{formatMetricValue(result.peakMemoryBytes)}</strong></span><span>PEAK TEMP <strong>{formatMetricValue(result.peakTemperature)}</strong></span><span>AVG FAN <strong>{formatMetricValue(result.averageFanRpm)}</strong></span><span>PEAK FAN <strong>{formatMetricValue(result.peakFanRpm)}</strong></span><span>AVG POWER <strong>{formatMetricValue(result.averagePowerWatts)}</strong></span><span>THERMAL <strong>{result.thermalPressure.value ?? 'Unavailable'}</strong></span></div>
          <small className="benchmark-version">Ollama {result.ollamaVersion ?? 'version unavailable'} · {formatDuration((result.finishedAt - result.startedAt) / 1000)} elapsed</small>
        </article>)}</div> : <div className="empty-panel compact-empty"><Gauge size={20} /><strong>No benchmark results</strong><span>Completed and stopped runs are saved on this Mac.</span></div>}
      </section>
    </div>
  </>
}