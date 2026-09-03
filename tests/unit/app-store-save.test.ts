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

function binaryDocument(adapterRevision = 1, kind: 'docx' | 'xlsx' | 'pptx' = 'docx'): OpenDocument {
  const name = kind === 'xlsx' ? 'budget.xlsx' : kind === 'pptx' ? 'briefing.pptx' : 'proposal.docx'
  return {
    id: fileId,
    environmentId,
    name,
    location: '~/Notes',
    fullPath: `/Users/test/Notes/${name}`,
    documentKind: kind,
    capabilities: DOCUMENT_CAPABILITIES[kind],
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

describe('manual save behavior', () => {
  const save = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: { document: { save } } as unknown as AladdeenApi
    })
    save.mockResolvedValue({ ok: true, value: revision(2) })
    useAppStore.setState({
      documents: [document('original', 'original')],
      activeFileId: fileId,
      conflictFileIds: []
    })
  })

  afterEach(() => {
    cleanupDocumentRuntime(fileId)
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('keeps edits unsaved until an explicit save', async () => {
    useAppStore.getState().updateContent(fileId, 'typed but not saved')

    // Edits must not schedule or trigger any write, even after autosave-style delays.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(save).not.toHaveBeenCalled()
    expect(useAppStore.getState().documents[0]?.status).toBe('editing')

    // The explicit save (Cmd+S or the Save button) writes and clears the dirty flag.
    await useAppStore.getState().saveDocument(fileId)
    expect(save).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().documents[0]?.status).toBe('saved')
  })
})

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
      conflictFileIds: []
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
      conflictFileIds: []
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

  it('commits adapter-owned edits only after a successful binary write', async () => {
    const completeSave = vi.fn()
    const saveBinary = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: revision(2) } satisfies Result<FileRevision>)
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'PERMISSION_DENIED', message: 'Read only' }
      } satisfies Result<FileRevision>)
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: { document: { save, saveBinary } } as unknown as AladdeenApi
    })
    useAppStore.setState({ documents: [binaryDocument()], activeFileId: fileId })
    registerDocumentRuntime(fileId, {
      serialize: async () => new ArrayBuffer(128),
      completeSave,
      cleanup: () => undefined
    })

    await expect(useAppStore.getState().saveDocument(fileId)).resolves.toBe(true)
    expect(completeSave).toHaveBeenLastCalledWith(true, 1)

    useAppStore.getState().markBinaryDirty(fileId)
    await expect(useAppStore.getState().saveDocument(fileId)).resolves.toBe(false)
    expect(completeSave).toHaveBeenLastCalledWith(false, 2)
  })

  it.each(['xlsx', 'pptx'] as const)('finishes a dirty %s save before switching away from its mounted adapter', async (kind) => {
    const nextFileId = '55555555-5555-4555-8555-555555555555'
    const pendingSave = deferred<Result<FileRevision>>()
    const saveBinary = vi.fn().mockReturnValue(pendingSave.promise)
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: { document: { save, saveBinary } } as unknown as AladdeenApi
    })
    useAppStore.setState({
      documents: [binaryDocument(1, kind), { ...document('next', 'next'), id: nextFileId }],
      activeFileId: fileId
    })
    registerDocumentRuntime(fileId, {
      serialize: async () => new ArrayBuffer(128),
      cleanup: () => undefined
    })

    const switching = useAppStore.getState().setActiveFileId(nextFileId)
    await vi.waitFor(() => expect(saveBinary).toHaveBeenCalledOnce())
    expect(useAppStore.getState().activeFileId).toBe(fileId)

    pendingSave.resolve({ ok: true, value: revision(2) })
    await switching
    expect(useAppStore.getState().activeFileId).toBe(nextFileId)
  })

  it('does not serialize or Save As a read-only binary editor', async () => {
    const serialize = vi.fn(async () => new ArrayBuffer(128))
    const saveBinary = vi.fn()
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: { document: { save, saveBinary } } as unknown as AladdeenApi
    })
    useAppStore.setState({ documents: [binaryDocument(1, 'pptx')], activeFileId: fileId })
    registerDocumentRuntime(fileId, {
      serialize,
      readOnly: () => true,
      cleanup: () => undefined
    })

    await expect(useAppStore.getState().saveDocumentAs(fileId)).resolves.toBe(false)
    expect(serialize).not.toHaveBeenCalled()
    expect(saveBinary).not.toHaveBeenCalled()
    expect(useAppStore.getState().documents[0]).toMatchObject({
      binaryDirty: true,
      status: 'error',
      error: expect.stringMatching(/read-only/i)
    })
  })

  it('keeps a dirty XLSX active when its compatibility Save As is cancelled', async () => {
    const nextFileId = '66666666-6666-4666-8666-666666666666'
    const saveBinary = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'CANCELLED', message: 'Save As was cancelled.' }
    } satisfies Result<FileRevision>)
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: { document: { save, saveBinary } } as unknown as AladdeenApi
    })
    useAppStore.setState({
      documents: [binaryDocument(1, 'xlsx'), { ...document('next', 'next'), id: nextFileId }],
      activeFileId: fileId
    })
    registerDocumentRuntime(fileId, {
      serialize: async () => new ArrayBuffer(128),
      requiresSaveAs: () => true,
      cleanup: () => undefined
    })

    await useAppStore.getState().setActiveFileId(nextFileId)
    expect(saveBinary).toHaveBeenCalledWith(expect.objectContaining({ saveAs: true }), expect.any(ArrayBuffer))
    expect(useAppStore.getState().activeFileId).toBe(fileId)
    expect(useAppStore.getState().documents[0]).toMatchObject({ binaryDirty: true })
  })

  it('does not replace a local edit made while an external reload is in flight', async () => {
    const diskRead = deferred<Result<ReturnType<typeof document>>>()
    const read = vi.fn().mockReturnValue(diskRead.promise)
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: { document: { save, read } } as unknown as AladdeenApi
    })
    useAppStore.setState({
      documents: [document('on disk', 'on disk')],
      conflictFileIds: []
    })

    const handling = useAppStore.getState().handleEnvironmentEvent({
      type: 'changed',
      fileId,
      isDirectory: false
    })
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    useAppStore.setState((state) => ({
      documents: state.documents.map((item) => item.id === fileId && 'content' in item
        ? { ...item, content: 'typed while reading', status: 'editing' }
        : item)
    }))
    diskRead.resolve({
      ok: true,
      value: {
        ...document('external version', 'external version'),
        revision: revision(2)
      }
    })
    await handling

    expect(useAppStore.getState().documents[0]).toMatchObject({
      content: 'typed while reading',
      status: 'conflict'
    })
    expect(useAppStore.getState().conflictFileIds).toEqual([fileId])
  })

  it('queues simultaneous conflicts without replacing the first document', async () => {
    const secondFileId = '44444444-4444-4444-8444-444444444444'
    useAppStore.setState({
      documents: [
        document('first local edit', 'original'),
        { ...document('second local edit', 'original'), id: secondFileId, name: 'second.md' }
      ],
      conflictFileIds: []
    })

    await useAppStore.getState().handleEnvironmentEvent({ type: 'changed', fileId, isDirectory: false })
    await useAppStore.getState().handleEnvironmentEvent({ type: 'changed', fileId: secondFileId, isDirectory: false })

    expect(useAppStore.getState().conflictFileIds).toEqual([fileId, secondFileId])
  })
})
