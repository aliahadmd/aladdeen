import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@renderer/store/app-store'
import type { AladdeenApi, FileRevision, OpenDocument, Result } from '@shared/contracts'

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
    content,
    savedContent,
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
})
