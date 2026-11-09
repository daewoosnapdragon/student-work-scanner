import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ensureDirs, INBOX_DIR, PORT } from './config.js'
import { openDb } from './db.js'
import { startWatcher } from './watcher.js'
import { api, files, print } from './routes/api.js'

ensureDirs()
openDb()

const app = express()
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
