// Tries the QR decoder on image files without filing anything. Useful when a
// real scanner's output is not being read:
//   npx tsx scripts/decode-check.ts path/to/scan.jpg another.jpg
//   npx tsx scripts/decode-check.ts path/to/folder
import fs from 'node:fs'
import path from 'node:path'
import { decodePage } from '../server/decode.js'

const args = process.argv.slice(2)
if (!args.length) {
  console.error('Give it image files or a folder of them.')
  process.exit(1)
}
const files = args.flatMap((a) => (fs.statSync(a).isDirectory() ? fs.readdirSync(a).map((f) => path.join(a, f)) : [a]))
  .filter((f) => /\.(jpe?g|png|tiff?|webp|bmp)$/i.test(f))
  .sort()
for (const f of files) {
  const t = Date.now()
  const r = await decodePage(f)
  const ok = r.ref ? 'ok  ' : r.text ? 'odd ' : 'none'
  console.log(ok, path.basename(f).padEnd(32), (r.text ?? '').padEnd(24), (r.strategy ?? '').padEnd(22), `${Date.now() - t} ms`)
}
