import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { api, files, print, setBuild } from './routes/api.js'

// In production the built web app is served from dist/web.
const here = path.dirname(fileURLToPath(import.meta.url))
// Built: dist/server/app.js next to dist/web. In dev (tsx): server/app.ts next to dist/web.
const webDist = [path.resolve(here, '../dist/web'), path.resolve(here, '../web')].find(
  (d) => fs.existsSync(path.join(d, 'index.html')) && fs.existsSync(path.join(d, 'assets')),
)
// The build this process started with. The page compares it with the build on
// disk and says so when the program needs restarting after an update.
export const BUILD = webDist && fs.existsSync(path.join(webDist, 'build.txt')) ? fs.readFileSync(path.join(webDist, 'build.txt'), 'utf8').trim() : 'dev'

/** The whole HTTP app: the API, the files, the print pages and the built web app. The caller opens the database and listens. */
export function makeApp(): express.Express {
  setBuild(BUILD)
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
  // an API path no route answers is a 404, not the web app's page
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'no such route' }) })
  app.use('/files', files)
  app.use('/print', print)

  if (webDist) {
    app.use(express.static(webDist))
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(webDist, 'index.html')))
  } else {
    app.get('/', (_req, res) => res.type('text').send('Student Work Scanner API is running. Start the web app with npm run dev:web, or build it with npm run build.'))
  }
  return app
}
