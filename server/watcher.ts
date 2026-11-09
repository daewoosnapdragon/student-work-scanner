import chokidar from 'chokidar'
import fs from 'node:fs'
import path from 'node:path'
import { INBOX_DIR } from './config.js'
import { isScanFile, processInboxFile } from './pipeline.js'
import { broadcast } from './events.js'
import { setMeta } from './db.js'

// Files are handled strictly one at a time, in the order they appeared, so the
// scan order stays meaningful for the review guesses.
const queue: string[] = []
let busy = false
let lastSeen: string | null = null

export function watcherStatus() {
  return { inbox: INBOX_DIR, queued: queue.length, busy, lastSeen }
}

async function drain() {
  if (busy) return
  busy = true
  while (queue.length) {
    const file = queue.shift()!
    if (!fs.existsSync(file)) continue
    try {
      const next = await processInboxFile(file)
      // Pages rendered from a PDF go to the front of the queue, in page order,
      // so scan order stays intact for the review guesses.
      if (next.length) queue.unshift(...next.filter((f) => !queue.includes(f)))
      lastSeen = new Date().toISOString()
      setMeta('lastSeen', lastSeen)
    } catch (err) {
      console.error('[inbox] failed on', file, err)
    }
    broadcast('status', watcherStatus())
  }
  busy = false
}

export function enqueue(file: string) {
  if (!isScanFile(file)) return
  if (queue.includes(file)) return
  // Pages the pipeline itself rendered are already queued by the time the
  // watcher notices them; everything else joins in arrival order.
  if (/__p\d{2}\.jpg$/i.test(file) && busy) return
  queue.push(file)
  queue.sort((a, b) => stamp(a) - stamp(b))
  void drain()
}

function stamp(file: string) {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

export function startWatcher() {
  fs.mkdirSync(INBOX_DIR, { recursive: true })
  // Pick up anything already sitting in the inbox, oldest first.
  for (const f of fs.readdirSync(INBOX_DIR)) enqueue(path.join(INBOX_DIR, f))
  const w = chokidar.watch(INBOX_DIR, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
  })
  w.on('add', (f) => enqueue(f))
  w.on('error', (e) => console.error('[inbox] watcher error', e))
  console.log(`[inbox] watching ${INBOX_DIR}`)
  return w
}
