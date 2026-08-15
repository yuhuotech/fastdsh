import { fork, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { findFreePort } from './port.js'

const require = createRequire(import.meta.url)

export type HarnessState = 'stopped' | 'starting' | 'ready' | 'failed'

export interface HarnessEvents {
  onStateChange: (state: HarnessState, detail?: string) => void
}

/**
 * Owns the DeepSeek Harness child process lifecycle.
 *
 * The Harness CLI (`@deepseek-ai/dsh`, bin: lib/bin.js) runs on Electron's
 * embedded Node, so end users never need a system Node.js. The child is
 * forked with the Electron binary itself plus ELECTRON_RUN_AS_NODE=1, NOT
 * via Electron's `utilityProcess`: Cordis HMR inside dsh requires Node's
 * `--expose-internals`, and in packaged apps a utility-process child never
 * actually enables it (the flag shows up in process.execArgv but internal
 * modules stay hidden), while a plain run-as-Node child honors it.
 * `DSH_HOME` points into Electron's userData directory so profiles,
 * sessions and credentials survive app upgrades.
 */
export class Harness {
  private child: ChildProcess | null = null
  private logStream: WriteStream | null = null
  private state: HarnessState = 'stopped'
  private stopping = false

  readonly host = '127.0.0.1'
  port = 0

  constructor (
    private readonly dshHome: string,
    private readonly logFile: string,
    private readonly events: HarnessEvents
  ) {}

  get url (): string {
    return `http://${this.host}:${this.port}`
  }

  get currentState (): HarnessState {
    return this.state
  }

  async start (): Promise<void> {
    if (this.child !== null) return
    this.setState('starting')
    this.stopping = false

    this.port = await findFreePort()
    mkdirSync(this.dshHome, { recursive: true })
    mkdirSync(path.dirname(this.logFile), { recursive: true })
    this.logStream = createWriteStream(this.logFile, { flags: 'a' })

    const entry = require.resolve('@deepseek-ai/dsh/lib/bin.js')
    this.log(`[fastdsh] starting harness: ${entry} web --host ${this.host} --port ${this.port}`)

    const child = fork(
      entry,
      ['web', '--host', this.host, '--port', String(this.port)],
      {
        // process.execPath is the Electron binary; ELECTRON_RUN_AS_NODE
        // makes the child behave as plain Node.js.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: this.dshHome },
        // Cordis HMR inside dsh requires --expose-internals; grant it to the
        // child only, never to the renderer.
        execArgv: ['--expose-internals'],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      }
    )
    this.child = child

    child.stdout?.on('data', (chunk: Buffer) => this.log(chunk))
    child.stderr?.on('data', (chunk: Buffer) => this.log(chunk))
    child.once('exit', (code) => {
      this.log(`[fastdsh] harness exited with code ${code}`)
      this.child = null
      this.logStream?.end()
      this.logStream = null
      if (!this.stopping) {
        this.setState('failed', `Harness exited unexpectedly (code ${code}). See the log for details.`)
      } else {
        this.setState('stopped')
      }
    })

    try {
      await this.waitUntilReady(60_000)
      if (this.child !== child) return // exited while waiting; exit handler already ran
      this.setState('ready')
    } catch (err) {
      await this.stop()
      this.setState('failed', err instanceof Error ? err.message : String(err))
    }
  }

  async stop (): Promise<void> {
    if (this.child === null) return
    this.stopping = true
    const child = this.child
    await new Promise<void>((resolve) => {
      // Ask nicely first (SIGTERM); if the child ignores it, force it down
      // after a short grace period.
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 5_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill()
    })
  }

  async restart (): Promise<void> {
    await this.stop()
    await this.start()
  }

  private setState (state: HarnessState, detail?: string): void {
    this.state = state
    this.events.onStateChange(state, detail)
  }

  private log (chunk: Buffer | string): void {
    this.logStream?.write(chunk)
  }

  /** Poll the web UI until it answers HTTP, or throw on timeout/early exit. */
  private async waitUntilReady (timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (this.child === null) {
        throw new Error('Harness exited before becoming ready. See the log for details.')
      }
      try {
        const response = await fetch(this.url, { signal: AbortSignal.timeout(2_000) })
        if (response.ok) return
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) {
        throw new Error('Harness did not become ready within 60s. See the log for details.')
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
}
