import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ensureDirs, INBOX_DIR, PORT } from './config.js'
import { openDb } from './db.js'
import { startWatcher } from './watcher.js'
import { api, files, print, setBuild } from './routes/api.js'
import { onPacketComplete } from './claude.js'
import { setOnPacketComplete } from './pipeline.js'

ensureDirs()
openDb()
setOnPacketComplete(onPacketComplete)

const app = express()
// Worksheet Studio (in the browser, on another origin) reads the roster and
// registers assignments here when it prints a class set. Browsers treat
// localhost as a secure origin, so an https page may call this http API.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  next()
})
app.use(express.json())
app.use('/api', api)
app.use('/files', files)
app.use('/print', print)

// In production the built web app is served from dist/web.
const here = path.dirname(fileURLToPath(import.meta.url))
// Built: dist/server/index.js next to dist/web. In dev (tsx): server/index.ts next to dist/web.
const webDist = [path.resolve(here, '../dist/web'), path.resolve(here, '../web')].find(
  (d) => fs.existsSync(path.join(d, 'index.html')) && fs.existsSync(path.join(d, 'assets')),
)
// The build this process started with. The page compares it with the build on
// disk and says so when the program needs restarting after an update.
export const BUILD = webDist && fs.existsSync(path.join(webDist, 'build.txt')) ? fs.readFileSync(path.join(webDist, 'build.txt'), 'utf8').trim() : 'dev'
setBuild(BUILD)
if (webDist) {
  app.use(express.static(webDist))
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(webDist, 'index.html')))
} else {
  app.get('/', (_req, res) => res.type('text').send('Student Work Scanner API is running. Start the web app with npm run dev:web, or build it with npm run build.'))
}

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`)
  console.log(`[inbox] drop scans into ${INBOX_DIR}`)
  startWatcher()
})
