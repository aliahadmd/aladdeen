import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupDocumentRuntime,
  registerDocumentRuntime
} from '@renderer/document-adapters/runtime'
import { useAppStore } from '@renderer/store/app-store'
import type { AladdeenApi, FileRevision, OpenDocument, Result } from '@shared/contracts'
import { DOCUMENT_CAPABILITIES } from '@shared/documents'

const fileId = '11111111-1111-4111-8111-111111111111'
const environmentId = '22222222-2222-4222-8222-222222222222'

function revision(sequence: number): FileRevision {
  return {
    mtimeMs: sequence,
    size: sequence,
    sha256: String(sequence).padStart(64, '0'),
    lineEnding: 'LF',
    hasBom: false
  }
}

function document(content: string, savedContent: string): OpenDocument {
  return {
    id: fileId,
    environmentId,
    name: 'queued-save.md',
    location: '~/Notes',
    fullPath: '/Users/test/Notes/queued-save.md',
    documentKind: 'markdown',
    encoding: 'utf-8',
    capabilities: DOCUMENT_CAPABILITIES.markdown,
    content,
    savedContent,
    status: 'editing',
    editorScrollTop: 0,
    editorSelection: 0,
    revision: revision(1)
  }
}

function binaryDocument(adapterRevision = 1): OpenDocument {
  return {
    id: fileId,
    environmentId,
    name: 'proposal.docx',
    location: '~/Notes',
    fullPath: '/Users/test/Notes/proposal.docx',
    documentKind: 'docx',
    capabilities: DOCUMENT_CAPABILITIES.docx,
    session: {
      id: '33333333-3333-4333-8333-333333333333',
      url: 'aladdeen-document://session/33333333-3333-4333-8333-333333333333',
      byteLength: 128
    },
    binaryDirty: true,
    adapterRevision,
    status: 'editing',
    editorScrollTop: 0,
    editorSelection: 0,
    revision: revision(1)
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

describe('document save serialization', () => {
  const save = vi.fn()

  beforeEach(() => {
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: { document: { save } } as unknown as AladdeenApi
    })
    useAppStore.setState({
      documents: [document('first edit', 'original')],
      activeFileId: fileId,
      conflictFileId: null
    })
  })

  afterEach(() => {
    cleanupDocumentRuntime(fileId)
    vi.clearAllMocks()
  })

  it('queues an edit made during an in-flight save and flushes the newest content', async () => {
    const firstSave = deferred<Result<FileRevision>>()
    const secondSave = deferred<Result<FileRevision>>()
    save
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise)

    const initial = useAppStore.getState().saveDocument(fileId)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))

    useAppStore.getState().updateContent(fileId, 'second edit')
    const flush = useAppStore.getState().flushDocuments()
    expect(save).toHaveBeenCalledTimes(1)

    firstSave.resolve({ ok: true, value: revision(2) })
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2)
      expect(save.mock.calls[1]?.[0]).toMatchObject({
        content: 'second edit',
        expectedRevision: revision(2)
      })
    })

    secondSave.resolve({ ok: true, value: revision(3) })
    await expect(initial).resolves.toBe(true)
    await expect(flush).resolves.toBe(true)
    expect(useAppStore.getState().documents[0]).toMatchObject({
      content: 'second edit',
      savedContent: 'second edit',
      revision: revision(3),
      status: 'saved'
    })
  })

  it('keeps a binary document dirty when it changes during serialization', async () => {
    const serialization = deferred<ArrayBuffer>()
    const saveBinary = vi.fn().mockResolvedValue({
      ok: true,
      value: revision(2)
    } satisfies Result<FileRevision>)
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: { document: { save, saveBinary } } as unknown as AladdeenApi
    })
    useAppStore.setState({
      documents: [binaryDocument()],
      activeFileId: fileId,
      conflictFileId: null
    })
    registerDocumentRuntime(fileId, {
      serialize: () => serialization.promise,
      cleanup: () => undefined
    })

    const saving = useAppStore.getState().saveDocument(fileId)
    await vi.waitFor(() => {
      expect(useAppStore.getState().documents[0]?.status).toBe('saving')
    })
    useAppStore.getState().markBinaryDirty(fileId)
    serialization.resolve(new ArrayBuffer(128))

    await expect(saving).resolves.toBe(true)
    expect(saveBinary).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().documents[0]).toMatchObject({
      adapterRevision: 2,
      binaryDirty: true,
      status: 'editing',
      revision: revision(2)
    })
    useAppStore.getState().markBinaryDirty(fileId, false)
  })
})
