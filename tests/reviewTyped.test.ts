import { describe, expect, it } from 'vitest'
import { originLabel, readTyped } from '../web/src/pages/Review'

const minji = { code: 'S07', name: 'Minji Park', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null, active: 1, externalId: null }
const minsu = { ...minji, code: 'S08', name: 'Minsu Park' }

describe('reading what was typed in Review', () => {
  it('takes a full label straight', () => {
    expect(readTyped('S07 W23 2 back', [])).toEqual({ student: 'S07', assignment: 'W23', page: 2, side: 'b' })
  })
  it('hands a name back for the roster, then reads the rest once one student matches', () => {
    expect(readTyped('Minji W23 2b', [])).toEqual({ name: 'Minji' })
    expect(readTyped('Minji W23 2b', [minji, minsu])).toEqual({ name: 'Minji' })
    expect(readTyped('Minji W23 2b', [minji])).toEqual({ name: 'Minji', student: 'S07', assignment: 'W23', page: 2, side: 'b' })
    expect(readTyped('Minji Park', [minji])).toEqual({ name: 'Minji Park', student: 'S07' })
  })
  it('is empty for nothing typed', () => {
    expect(readTyped('', [])).toEqual({})
  })
})

describe('where a page came from', () => {
  it('names the PDF and page, else the scanned file', () => {
    expect(originLabel({ origin: 'originals/scan001.pdf', originPage: 3, sourceName: 'scan001__p03.jpg' })).toBe('scan001.pdf, page 3')
    expect(originLabel({ origin: null, originPage: null, sourceName: 'IMG_0042.jpg' })).toBe('IMG_0042.jpg')
  })
})
