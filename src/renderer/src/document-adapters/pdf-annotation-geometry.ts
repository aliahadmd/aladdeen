// Characters the WinAnsi-encoded standard fonts can draw beyond Latin-1.
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

export function toStandardFontText(text: string): string {
  let output = ''
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    const encodable = character === '\n' ||
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      WIN_ANSI_EXTRAS.has(character)
    output += encodable ? character : '?'
  }
  return output
}

export function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360
  return normalized as 0 | 90 | 180 | 270
}

/**
 * Maps a point on the page as displayed (ratios from the top-left corner plus
 * an offset in points, y growing downward) to PDF user space, honouring the
 * crop box origin and the page's existing rotation.
 */
export function displayPointMapper(
  box: { x: number; y: number; width: number; height: number },
  rotation: 0 | 90 | 180 | 270,
  xRatio: number,
  yRatio: number
): (offsetX: number, offsetY: number) => { x: number; y: number } {
  const sideways = rotation === 90 || rotation === 270
  const displayWidth = sideways ? box.height : box.width
  const displayHeight = sideways ? box.width : box.height
  return (offsetX, offsetY) => {
    const px = xRatio * displayWidth + offsetX
    const py = yRatio * displayHeight + offsetY
    if (rotation === 90) return { x: box.x + py, y: box.y + px }
    if (rotation === 180) return { x: box.x + box.width - px, y: box.y + py }
    if (rotation === 270) return { x: box.x + box.width - py, y: box.y + box.height - px }
    return { x: box.x + px, y: box.y + box.height - py }
  }
}
