import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupDocumentRuntime,
  getDocumentRuntime,
  registerDocumentRuntime
} from '@renderer/document-adapters/runtime'
import { prepareHtmlPreview } from '@renderer/document-adapters/html-preview'
import { useAppStore } from '@renderer/store/app-store'
import type { AladdeenApi, BinaryDocumentSnapshot, FileRevision, OpenDocument } from '@shared/contracts'
import { DOCUMENT_CAPABILITIES } from '@shared/documents'

const fileId = '11111111-1111-4111-8111-111111111111'
const environmentId = '22222222-2222-4222-8222-222222222222'
const session = {
  id: '33333333-3333-4333-8333-333333333333',
  url: 'aladdeen-document://session/33333333-3333-4333-8333-333333333333',
  byteLength: 128
}

function revision(sequence: number): FileRevision {
  return { mtimeMs: sequence, size: sequence, sha256: String(sequence).padStart(64, '0') }
}

function snapshot(sequence: number): BinaryDocumentSnapshot {
  return {
    id: fileId,
    environmentId,
    name: 'budget.xlsx',
    location: '~/Notes',
    fullPath: '/Users/test/Notes/budget.xlsx',
    documentKind: 'xlsx',
    capabilities: DOCUMENT_CAPABILITIES.xlsx,
    session,
    revision: revision(sequence)
  }
}

function dirtyWorkbook(): OpenDocument {
  return {
    ...snapshot(1),
    binaryDirty: true,
    adapterRevision: 3,
    // The store's load counter starts at 1, so 0 always differs from a reload.
    loadGeneration: 0,
    status: 'conflict',
    editorScrollTop: 0,
    editorSelection: 0
  }
}

afterEach(() => {
  cleanupDocumentRuntime(fileId)
  vi.clearAllMocks()
})

describe('binary conflict recovery', () => {
  it('saves the edits as a copy and reloads the original with a fresh editor', async () => {
    const saveBinary = vi.fn().mockResolvedValue({ ok: true, value: revision(9) })
    const read = vi.fn().mockResolvedValue({ ok: true, value: snapshot(2) })
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: { document: { saveBinary, read } } as unknown as AladdeenApi
    })
    const completeSave = vi.fn()
    const cleanup = vi.fn()
    registerDocumentRuntime(fileId, {
      serialize: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer,
      completeSave,
      cleanup
    })
    useAppStore.setState({ documents: [dirtyWorkbook()], activeFileId: fileId, conflictFileIds: [fileId] })

    await useAppStore.getState().resolveConflict('copy')

    expect(saveBinary).toHaveBeenCalledTimes(1)
    expect(saveBinary.mock.calls[0]![0]).toMatchObject({ fileId, copy: true, force: true })
    expect(saveBinary.mock.calls[0]![0]).not.toHaveProperty('saveAs')
    // The original is reloaded from disk, never the copy.
    expect(read).toHaveBeenCalledWith(fileId)
    expect(completeSave).toHaveBeenCalledWith(false, 3)
    expect(cleanup).toHaveBeenCalled()
    expect(getDocumentRuntime(fileId)).toBeUndefined()
    const reloaded = useAppStore.getState().documents[0]!
    expect(reloaded.revision.sha256).toBe(revision(2).sha256)
    // A new load generation remounts the XLSX adapter instead of leaving the
    // torn-down Univer instance on screen.
    expect('loadGeneration' in reloaded && reloaded.loadGeneration).toBeGreaterThan(0)
    expect(useAppStore.getState().conflictFileIds).toEqual([])
  })
})

describe('HTML preview isolation', () => {
  it('neutralizes image-map links as well as anchors', () => {
    const html = prepareHtmlPreview(
      '<map name="m"><area shape="rect" coords="0,0,1,1" href="https://example.com/area"></map><a href="https://example.com">x</a>',
      fileId
    )
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('area[href], a[href]')).toBeNull()
    expect(document.querySelector('area')?.dataset.aladdeenBlockedLink).toBe('https://example.com/area')
  })

  it('rewrites percent-encoded local images to decoded asset paths', () => {
    const html = prepareHtmlPreview('<img src="my%20pic.png">', fileId)
    const src = new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.getAttribute('src')
    expect(new URL(src!).searchParams.get('path')).toBe('my pic.png')
  })
})
