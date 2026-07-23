import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'

await mkdir('build', { recursive: true })
await sharp('build/icon.svg').resize(1024, 1024).png().toFile('build/icon.png')
