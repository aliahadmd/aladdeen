import type { IWorkbookData } from '@univerjs/core'
import type {
  XlsxLoadResult,
  XlsxWorkerRequest,
  XlsxWorkerResponse
} from './xlsx-worker-protocol'

type XlsxWorkerPayload =
  | { type: 'load'; data: ArrayBuffer; name: string }
  | { type: 'serialize'; snapshot: IWorkbookData }

export class XlsxWorkerClient {
  private readonly worker = new Worker(
    new URL('./xlsx-codec.worker.ts', import.meta.url),
    { type: 'module', name: 'aladdeen-xlsx-codec' }
  )
  private nextId = 0
  private readonly pending = new Map<number, {
    resolve(value: unknown): void
    reject(error: Error): void
  }>()

  constructor() {
    this.worker.addEventListener('message', (event: MessageEvent<XlsxWorkerResponse>) => {
      const pending = this.pending.get(event.data.id)
      if (!pending) return
      this.pending.delete(event.data.id)
      if (event.data.ok) pending.resolve(event.data.value)
      else pending.reject(new Error(event.data.error))
    })
    this.worker.addEventListener('error', (event) => {
      const error = new Error(event.message || 'The XLSX conversion worker stopped.')
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    })
  }

  load(data: ArrayBuffer, name: string): Promise<XlsxLoadResult> {
    return this.request<XlsxLoadResult>({ type: 'load', data, name }, [data])
  }

  serialize(snapshot: IWorkbookData): Promise<ArrayBuffer> {
    return this.request<ArrayBuffer>({ type: 'serialize', snapshot })
  }

  dispose(): void {
    this.worker.terminate()
    const error = new Error('The XLSX conversion worker was disposed.')
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private request<T>(
    payload: XlsxWorkerPayload,
    transfer: Transferable[] = []
  ): Promise<T> {
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      })
      this.worker.postMessage({ ...payload, id } as XlsxWorkerRequest, transfer)
    })
  }
}
