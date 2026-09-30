// Kept free of Electron imports so it can be unit tested in plain Node.

export type DocxImageType = 'png' | 'jpg' | 'gif'

/**
 * Confirms an image buffer really is the format its file extension claims.
 *
 * `imageSize` dispatches on magic bytes, not on the filename, so an extension check
 * alone does not decide which decoder runs: a file named `cover.png` whose bytes are
 * ICNS, JXL, or HEIF is routed to those decoders instead. Two open advisories
 * (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq) make them loop forever on crafted
 * input, and no patched release exists yet — 2.0.2 is the latest published and the
 * fix is only in the unreleased 2.0.3. The DOCX export path supports PNG, JPEG, and
 * GIF only, so verifying the signature keeps every other decoder unreachable
 * regardless of upstream.
 *
 * This runs in the main process, where an infinite loop would hang the app and block
 * the close-time save of open documents, so the guard matters beyond tidiness.
 */
export function imageBytesMatchDeclaredType(data: Uint8Array, type: DocxImageType): boolean {
  if (type === 'png') {
    return (
      data.length > 8 &&
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47 &&
      data[4] === 0x0d &&
      data[5] === 0x0a &&
      data[6] === 0x1a &&
      data[7] === 0x0a
    )
  }
  if (type === 'jpg') {
    return data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  }
  // GIF87a or GIF89a
  return (
    data.length > 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38 &&
    (data[4] === 0x37 || data[4] === 0x39) &&
    data[5] === 0x61
  )
}
