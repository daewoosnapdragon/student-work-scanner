// Imports the roster from the school system's CSV export:
//   npx tsx scripts/import-students.ts data/students.csv
// Columns: UUID, Name, Korean Name, Grade, English Class, Korean Class, Class Number, Active
//
// Each student gets a short code for the QR labels, made from grade, Korean
// homeroom class and class number: Grade 3, 대 class, number 7 becomes 3D07.
// That is unique within the school, fits on a label, and a teacher can read
// it back. Run the import again whenever the roster changes; codes stay
// stable as long as a student's grade, class and number do.
import fs from 'node:fs'
import { listStudents, openDb, upsertStudent } from '../server/db.js'

const file = process.argv[2]
if (!file) {
  console.error('Give it the CSV file: npx tsx scripts/import-students.ts data/students.csv')
  process.exit(1)
}

const HOMEROOM_LETTER: Record<string, string> = { 대: 'D', 솔: 'S', 매: 'M' }

export function studentCode(grade: number, koreanClass: string, number: number): string {
  const letter = HOMEROOM_LETTER[koreanClass] ?? (koreanClass.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 1) || 'X')
  return `${grade}${letter}${String(number).padStart(2, '0')}`
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

const rows = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
const header = rows.shift()!.map((h) => h.trim().toLowerCase())
const col = (name: string) => {
  const i = header.indexOf(name.toLowerCase())
  if (i < 0) throw new Error(`CSV has no "${name}" column; found: ${header.join(', ')}`)
  return i
}
const iName = col('Name'), iKo = col('Korean Name'), iGrade = col('Grade'), iClass = col('English Class'), iKClass = col('Korean Class'), iNum = col('Class Number'), iActive = col('Active')
const iId = header.indexOf('uuid')

openDb()
const before = new Set(listStudents().map((s) => s.code))
const seen = new Set<string>()
let added = 0, updated = 0
for (const r of rows) {
  const grade = Number(r[iGrade])
  const number = Number(r[iNum])
  const koreanClass = r[iKClass].trim()
  if (!r[iName]?.trim() || !grade || !number) {
    console.warn('skipped row:', r.join(','))
    continue
  }
  const code = studentCode(grade, koreanClass, number)
  if (seen.has(code)) console.warn(`two students share code ${code}: check ${r[iName]}`)
  seen.add(code)
  upsertStudent({
    code,
    name: r[iName].trim(),
    nameKo: r[iKo]?.trim() || null,
    klass: r[iClass].trim(),
    grade,
    homeroom: `${koreanClass} ${grade}-${String(number).padStart(2, '0')}`,
    active: /^(yes|y|true|1)$/i.test(r[iActive]?.trim() ?? 'yes') ? 1 : 0,
    externalId: iId >= 0 ? r[iId]?.trim() || null : null,
  })
  before.has(code) ? updated++ : added++
}
// Students in the database but not in this export are marked inactive, not deleted: their work stays.
let retired = 0
for (const s of listStudents()) {
  if (!seen.has(s.code) && s.active) {
    upsertStudent({ ...s, active: 0 })
    retired++
  }
}
console.log(`Imported ${rows.length} rows: ${added} new, ${updated} updated, ${retired} marked inactive.`)
const byGrade = new Map<number, number>()
for (const s of listStudents()) if (s.active) byGrade.set(s.grade ?? 0, (byGrade.get(s.grade ?? 0) ?? 0) + 1)
console.log('Active by grade:', [...byGrade.entries()].sort().map(([g, n]) => `G${g} ${n}`).join(', '))
