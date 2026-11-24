import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { InferenceSession } from '../src/shared/session.js'

export class SessionHistory {
  private readonly file = join(homedir(), '.mac-system-monitor', 'llm-history.json')
  private sessions: InferenceSession[] = []
  private loaded = false
  // Bumped on every change so clients can refetch when the snapshot stream reports a new value.
  revision = 0
  private writeQueue: Promise<void> = Promise.resolve()

  async list(): Promise<InferenceSession[]> {
    await this.load()
    // Log-derived sessions are inserted when the request finishes, so order by start time.
    return [...this.sessions].sort((a, b) => b.startedAt - a.startedAt)
  }

  async add(session: InferenceSession): Promise<void> {
    await this.load()
    this.sessions.push(session)
    this.sessions = this.sessions.slice(-200)
    this.revision += 1
    await this.persist()
  }

  async clear(): Promise<void> {
    await this.load()
    this.sessions = []
    this.revision += 1
    await this.persist()
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const contents = await readFile(this.file, 'utf8')
      const data: unknown = JSON.parse(contents)
      if (Array.isArray(data)) this.sessions = data.slice(-200) as InferenceSession[]
    } catch {
      this.sessions = []
    }
  }

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      const temporary = `${this.file}.tmp`
      await writeFile(temporary, JSON.stringify(this.sessions), { mode: 0o600 })
      await rename(temporary, this.file)
    })
    await this.writeQueue
  }
}