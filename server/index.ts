import { ensureDirs, INBOX_DIR, PORT } from './config.js'
import { openDb } from './db.js'
import { startWatcher } from './watcher.js'
import { makeApp } from './app.js'
import { onPacketComplete } from './claude.js'
import { setOnPacketComplete } from './pipeline.js'
import { renormaliseSkills } from './skills.js'

export { BUILD } from './app.js'

ensureDirs()
openDb()
// Skills stored before the vocabulary existed, or under an older list, take the list's names.
const renamed = renormaliseSkills()
if (renamed) console.log(`[skills] ${renamed} stored skill name${renamed === 1 ? '' : 's'} folded onto the vocabulary`)
setOnPacketComplete(onPacketComplete)

makeApp().listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`)
  console.log(`[inbox] drop scans into ${INBOX_DIR}`)
  startWatcher()
})
