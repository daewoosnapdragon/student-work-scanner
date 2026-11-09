// Seeds the Daisy roster and three assignments from the design mockup, so the
// app has something to show. Safe to re-run; it upserts.
import { openDb, upsertAssignment, upsertStudent } from '../server/db.js'

openDb()

const daisy: Array<[string, string, string, string]> = [
  ['S01', 'Chaewon Yoon', '윤채원', '대 3-01'],
  ['S02', 'Haeun Jung', '정하은', '솔 3-16'],
  ['S03', 'Jiwoo Kim', '김지우', '솔 3-09'],
  ['S04', 'Seoyeon Lee', '이서연', '매 3-04'],
  ['S05', 'Junseo Oh', '오준서', '대 3-19'],
  ['S06', 'Hyunwoo Lim', '임현우', '솔 3-12'],
  ['S07', 'Minji Park', '박민지', '매 3-11'],
  ['S08', 'Soyul Jang', '장소율', '대 3-05'],
  ['S09', 'Siwoo Kang', '강시우', '대 3-14'],
  ['S10', 'Taeyang Moon', '문태양', '매 3-17'],
  ['S11', 'Ara Baek', '백아라', '솔 3-03'],
  ['S12', 'Eunwoo Shin', '신은우', '매 3-08'],
  ['S13', 'Minseo Hong', '홍민서', '대 3-10'],
  ['S14', 'Yejun Seo', '서예준', '솔 3-06'],
  ['S15', 'Doyun Choi', '최도윤', '대 3-07'],
  ['S16', 'Dain Kwon', '권다인', '매 3-15'],
  ['S17', 'Woojin Nam', '남우진', '솔 3-18'],
  ['S18', 'Yuna Han', '한유나', '솔 3-02'],
]
for (const [code, name, nameKo, homeroom] of daisy) upsertStudent({ code, name, nameKo, klass: 'Daisy', grade: 3, homeroom })

upsertAssignment({ code: 'W21', title: 'Long A Hunt', klass: 'Daisy', grade: 3, assignedOn: '2026-10-28', sheets: 1, twoSided: 1, tags: 'phonics, long a', notes: null })
upsertAssignment({ code: 'W22', title: 'Weekend Writing', klass: 'Daisy', grade: 3, assignedOn: '2026-11-07', sheets: 1, twoSided: 0, tags: 'writing, narrative', notes: null })
upsertAssignment({ code: 'W23', title: 'Short Vowel Sort', klass: 'Daisy', grade: 3, assignedOn: '2026-11-04', sheets: 2, twoSided: 1, tags: 'phonics, short vowels, cvc words, sorting', notes: null })

console.log('Seeded 18 Daisy students and assignments W21, W22, W23.')
