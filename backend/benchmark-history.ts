import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { BenchmarkResult } from '../src/shared/benchmark.js'

export class BenchmarkHistory {
  private readonly file = join(homedir(), '.mac-system-monitor', 'benchmark-history.json')
  private results: BenchmarkResult[] = []
  private loaded = false

  async list(): Promise<BenchmarkResult[]> {
    await this.load()
    return [...this.results].reverse()
  }

  async add(result: BenchmarkResult): Promise<void> {
    await this.load()
    this.results.push(result)
    this.results = this.results.slice(-100)
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, JSON.stringify(this.results), { mode: 0o600 })
    await rename(temporary, this.file)
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (Array.isArray(value)) this.results = value.slice(-100) as BenchmarkResult[]
    } catch {
      this.results = []
    }
  }
}