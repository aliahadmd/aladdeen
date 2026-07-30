import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { Readable, Writable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

export type PiRpcRecord = Record<string, unknown> & { type?: string; id?: string }

export class JsonlDecoder extends EventEmitter {
  private readonly decoder = new StringDecoder('utf8')
  private buffered = ''
  private ended = false

  push(chunk: Buffer | Uint8Array | string): void {
    if (this.ended) throw new Error('Cannot push data after the JSONL decoder has ended.')
    this.buffered += typeof chunk === 'string' ? chunk : this.decoder.write(Buffer.from(chunk))
    this.drain(false)
  }

  end(chunk?: Buffer | Uint8Array | string): void {
    if (this.ended) return
    if (chunk !== undefined) this.push(chunk)
    this.buffered += this.decoder.end()
    this.ended = true
    this.drain(true)
  }

  private drain(flush: boolean): void {
    let newline = this.buffered.indexOf('\n')
    while (newline >= 0) {
      const record = this.buffered.slice(0, newline).replace(/\r$/, '')
      this.buffered = this.buffered.slice(newline + 1)
      if (record.length > 0) this.emit('record', record)
      newline = this.buffered.indexOf('\n')
    }
    if (flush && this.buffered.length > 0) {
      const record = this.buffered.replace(/\r$/, '')
      this.buffered = ''
      if (record.length > 0) this.emit('record', record)
    }
  }
}

interface PendingRequest {
  resolve(value: PiRpcRecord): void
  reject(error: Error): void
  timeout: NodeJS.Timeout
}

interface PiRpcClientOptions {
  timeoutMs?: number
  parseFailureLimit?: number
}

export class PiRpcClient extends EventEmitter {
  private readonly decoder = new JsonlDecoder()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly timeoutMs: number
  private readonly parseFailureLimit: number
  private consecutiveParseFailures = 0
  private closed = false

  constructor(
    private readonly stdin: Writable,
    stdout: Readable,
    options: PiRpcClientOptions = {}
  ) {
    super()
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.parseFailureLimit = options.parseFailureLimit ?? 5
    this.decoder.on('record', (line: string) => this.handleLine(line))
    stdout.on('data', (chunk: Buffer | string) => this.decoder.push(chunk))
    stdout.on('end', () => this.decoder.end())
    stdout.on('error', (error) => this.fail(error))
    stdin.on('error', (error) => this.fail(error))
  }

  send(command: PiRpcRecord, timeoutMs = this.timeoutMs): Promise<PiRpcRecord> {
    if (this.closed) return Promise.reject(new Error('The pi RPC connection is closed.'))
    const id = typeof command.id === 'string' ? command.id : randomUUID()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Pi RPC command "${String(command.type ?? 'unknown')}" timed out.`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timeout })
      this.write({ ...command, id }).catch((error: unknown) => {
        const request = this.pending.get(id)
        if (!request) return
        clearTimeout(request.timeout)
        this.pending.delete(id)
        request.reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  notify(message: PiRpcRecord): Promise<void> {
    if (this.closed) return Promise.reject(new Error('The pi RPC connection is closed.'))
    return this.write(message)
  }

  close(reason = 'The pi RPC connection closed.'): void {
    if (this.closed) return
    this.closed = true
    const error = new Error(reason)
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout)
      request.reject(error)
    }
    this.pending.clear()
  }

  private write(message: PiRpcRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const payload = `${JSON.stringify(message)}\n`
      this.stdin.write(payload, 'utf8', (error?: Error | null) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private handleLine(line: string): void {
    let record: PiRpcRecord
    try {
      const parsed: unknown = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Pi RPC emitted a non-object JSON record.')
      }
      record = parsed as PiRpcRecord
      this.consecutiveParseFailures = 0
    } catch (error) {
      this.consecutiveParseFailures += 1
      this.emit('parse-error', error, line)
      if (this.consecutiveParseFailures >= this.parseFailureLimit) {
        this.emit('protocol-error', new Error('Pi RPC emitted too many malformed records.'))
      }
      return
    }

    if (record.type === 'response' && typeof record.id === 'string') {
      const request = this.pending.get(record.id)
      if (!request) {
        this.emit('event', record)
        return
      }
      clearTimeout(request.timeout)
      this.pending.delete(record.id)
      if (record.success === false) {
        request.reject(new Error(typeof record.error === 'string' ? record.error : 'Pi rejected the command.'))
      } else {
        request.resolve(record)
      }
      return
    }
    this.emit('event', record)
  }

  private fail(error: Error): void {
    this.close(error.message)
    this.emit('error', error)
  }
}
