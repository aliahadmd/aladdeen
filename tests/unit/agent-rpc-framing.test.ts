// @vitest-environment node
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { JsonlDecoder, PiRpcClient } from '@main/services/agent-rpc'

describe('pi RPC JSONL framing', () => {
  it('decodes UTF-8 across chunks, accepts CRLF, and splits only on LF', () => {
    const decoder = new JsonlDecoder()
    const records: string[] = []
    decoder.on('record', (record: string) => records.push(record))
    const payload = Buffer.from('{"text":"hello 🌍"}\r\n{"text":"line\u2028inside"}\n{"done":true}')

    decoder.push(payload.subarray(0, 17))
    decoder.push(payload.subarray(17, 21))
    decoder.push(payload.subarray(21, 47))
    decoder.end(payload.subarray(47))

    expect(records.map((record) => JSON.parse(record))).toEqual([
      { text: 'hello 🌍' },
      { text: 'line\u2028inside' },
      { done: true }
    ])
  })

  it('correlates responses by id while forwarding unrelated events', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const client = new PiRpcClient(stdin, stdout, { timeoutMs: 100 })
    const events: unknown[] = []
    client.on('event', (event) => events.push(event))

    const commandLine = new Promise<string>((resolve) => stdin.once('data', (chunk) => resolve(String(chunk))))
    const pending = client.send({ type: 'get_state' })
    const command = JSON.parse(await commandLine) as { id: string }
    stdout.write('{"type":"agent_start"}\n')
    stdout.write(`${JSON.stringify({ type: 'response', id: command.id, command: 'get_state', success: true, data: {} })}\n`)

    await expect(pending).resolves.toMatchObject({ success: true, id: command.id })
    expect(events).toEqual([{ type: 'agent_start' }])
    client.close()
  })

  it('times out unanswered commands', async () => {
    const client = new PiRpcClient(new PassThrough(), new PassThrough(), { timeoutMs: 10 })
    await expect(client.send({ type: 'get_state' })).rejects.toThrow(/timed out/i)
    client.close()
  })
})
