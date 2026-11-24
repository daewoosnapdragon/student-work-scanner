# Piles, and an app organised around the scan loop

## Intent

The teacher's job with this program is a loop: scan a pile of one assignment,
settle the pages the scanner could not place, analyse, print feedback. Today
the program files page by page and offers five different manual tools for the
pages the QR code failed on (a page-by-page Review with guesses, a type-the-
label box, a set-up card, File a stack, Sort onto students). The menu is a list
of nouns (Today, Students, Assignments, Compare, Review) and no screen says
which step of the loop the teacher is on or what comes next. The teacher's
words: "confusing and hard to see/know what I'm doing"; the goal is
"everything filed as quickly as possible so I can analyze."

Two facts about how scanning actually happens make most of the manual work
unnecessary:

- The scanner is fed one assignment at a time, as one PDF. The teacher feeds
  every front in pile order, each student's sheets together (Olivia 1, Olivia
  2, Jun 1, Jun 2), then flips the pile and feeds it again, so the backs come
  out in reverse order (Jun 2 back, Jun 1 back, Olivia 2 back, Olivia 1 back).
  So in a PDF of 2N pages, page i and page 2N+1−i are the two sides of one
  sheet of paper, and the fronts run in pile order.
- The things that go wrong are: the scanner misses a code; a page carries the
  wrong code (a paste mistake when the worksheet was made); a student wrote on
  plain paper with no code at all.

## Goals

- A scanned pile files itself, sheet by sheet, from whichever side's code
  read, with the fronts' order naming the owner of a sheet with no code at all.
- Wrong codes are caught as contradictions, not filed wrongly.
- What the program could not settle is shown as sheets (front and back
  together) on one screen, with a best guess each, accepted with Enter.
- The app is organised around the loop: **Scan**, **Assignments**, **Students**.
  Each screen shows one next action. One red button per screen.
- The manual tools collapse into two: check a pile, and sort loose pages.

## Non-goals

- Improving the QR read rate itself (printing, scanner settings, decoder).
  Worth doing, separately, once a failed page is available to look at.
- Duplex scanners, or piles scanned as two PDFs. One PDF, fronts then backs,
  is the case; single-sided assignments are fronts only.
- Changes to analysis, feedback slips, rubric, anchors, agreement, skills, or
  Worksheet Studio's API. They keep working as they are; only where they are
  reached from changes.
- Touch or phone layouts.

## Anti-goals

- Filing a sheet under the wrong student silently. When in doubt, hold it.
- Making the teacher look at sheets the program could have settled.
- Another screen for another special case. If a case needs a new screen, the
  design is wrong.

## Constraints

- Node 22, Express, SQLite via node:sqlite, React 18 with react-router, no new
  runtime dependencies. MuPDF renders PDFs; jsQR decodes.
- The archive layout (`data/archive/W23/S07/2b.jpg`), the `pages` and
  `packets` tables, and every analysis route stay as they are. Worksheet Studio
  reads `/api/students`, `/api/assignments` and `/api/skills`; those do not
  change shape.
- `data/originals/<name>.pdf` and `pages.origin` / `pages.originPage` already
  exist (every rendered page knows its PDF and page number).
- A rescan already replaces the earlier scan of a side and carries comments.
  One change to it here: the replaced file is kept beside the new one
  (`2b.r<pageId>.jpg`) instead of being written over, so a pile can be undone.
- Windows start/update scripts are unchanged.

## Approaches considered

1. **Treat each PDF as a pile and file sheets, not pages.** Pair page i with
   its mirror, read both sides, decide each sheet as a whole, hold the rest
   for one check screen. Catches wrong codes; turns a pile into seconds of
   checking. Assumes one PDF holds one assignment, fronts then backs.
   **Chosen.**
2. Keep per-page filing, use the mirror only to improve the Review guesses.
   Smaller change, but still one Enter per missed page, and a wrong code
   still files wrong.
3. Chase the read rate only. Cheap and worth doing anyway, but does nothing
   for plain paper or wrong codes.

For the app's shape, the teacher chose the whole restructure in one go rather
than piles first and the hub later.

## Design

### 1. Piles

A **pile** is one PDF from the inbox. (A single image file is not a pile; it
is a loose page, see §4.)

**Table `piles`**: `id`, `origin` (the kept PDF, relative to the data dir),
`name` (the PDF's file name), `assignment` (code, nullable until known),
`pages` (count), `sheets` (count, nullable until known), `twoSided` (0/1,
nullable until known), `status` (`new` → `checking` → `done`, or `jumbled`),
`createdAt`, `settledAt`. **`pages` gains** `pile` (id, nullable) and
`pileIndex` (1-based page number in the PDF; same as `originPage` and kept
for clarity).

**Rendering stays as it is** (one JPEG per page into the inbox, decoded in
page order, the PDF kept under originals). The change is what happens after
the last page of a PDF has been decoded: instead of filing each page on its
own as it arrives, pages that came from a pile are held (status `review`,
reason `in pile`) until the whole pile is in, then **the pile is settled**.

**Settling a pile** (pure function over the pile's pages and their decoded
codes; `server/piles.ts`, fully unit-tested):

1. *Which assignment.* The most common assignment among the codes that read.
   If no code read, the pile is `new` with no assignment and waits for the
   teacher to name it on the Scan screen (§3); nothing files until then.
   Pages whose code names a different assignment than the pile's are held.
2. *Fronts and backs.* "Two-sided" here means the assignment waits for at
   least one back (`sidesFor(a)` has a `b` side): an assignment whose backs
   all stay with the student (`expect = 1a,2a`) is fed fronts only and is
   single-sided for pairing. If the assignment is two-sided and the page
   count is even, pages 1..N are fronts in pile order and pages N+1..2N are
   backs in reverse: sheet k is pages k and 2N+1−k. If the assignment is
   single-sided, every page is a front and a sheet; a page whose code reads
   as a back is filed as that side, kept and not counted, as today. If the assignment is two-sided and the
   count is odd, or the mirror check below fails for three or more sheets in a
   row, the pile is `jumbled`: nothing is filed by position, every page with a
   clean, non-contradicted code is filed on its own as today, and the rest go
   to loose pages. Jumbled is rare (a jam, a double feed, two piles in one
   PDF) and the Scan screen says so plainly.
3. *What each sheet says.* For each sheet, the codes read on its sides.
   - Both read and agree (same student, same assignment, same sheet number,
     sides a and b): **known**.
   - One read, the other missed: **known** from the one that read; the other
     side takes the same student and sheet number with the other letter.
   - Both read and disagree: **contradiction**; held, with both readings as
     guesses.
   - Neither read: **unknown**, settled from position in step 4.
   - A read code with a side letter that disagrees with the sheet's position
     (an `a` code on a back page) counts as a disagreement with position:
     held, not filed.
   - A side the sheet implies but the assignment never printed (the blank
     back of a packet with an odd `sides` count) is marked `not_work`, not
     filed. A side that was printed but is not waited for (`expect`: a
     reading page) is filed and not counted, as today.
4. *Owners by position.* Walk the sheets in front order. Known sheets form
   runs by student. An unknown sheet between two known sheets of the same
   student, or at the start or end of a run that is still missing sheet
   numbers, takes that student and the lowest sheet number the student still
   lacks that fits the order (an unknown between Olivia 1 and Olivia 3 is
   Olivia 2). This is **placed**. An unknown sheet between two different
   students is **placed** when exactly one of them can still take it (lacks a
   sheet number that fits the order), and **held** with both as guesses when
   both can or neither can; one next to a run that already has every sheet
   is held. A sheet placed this way has `filedFrom =
   'pile'`.
5. *Filing.* Known and placed sheets file through the existing path (replace
   on rescan, comments carried, packets refreshed, analysis hook on complete).
   Held sheets stay in `review` with `reason` naming why (`contradiction`,
   `between two students`, `no code and no neighbour`) and the guesses stored
   on the pile (`piles.held` as JSON: `[{ sheet, pages: [frontId, backId],
   guesses: [{ student, page, why }] }]`). Pile status becomes `done` when
   nothing is held, else `checking`.
6. *A pile with no codes at all* (or too few to find runs) still gets a
   usable check screen: once the teacher names the assignment, the sheets are
   cut into packets of the assignment's sheet count, each packet gets the next
   student in name order who has not turned the work in, and the teacher
   corrects the names. This is File a stack, folded in; it is the same check
   screen with every packet held.

**Boundary.** The watcher already processes a PDF's pages consecutively and
alone. The pile settles when the last rendered page of that PDF has been
decoded. Pages a PDF left in the inbox before a restart are matched to their
pile by name (`stem__pNN.jpg`) as they are to their origin today.

**Undo.** "Undo this pile" on the Scan screen takes back everything the pile
filed, by position, by code, and by hand from its check screen: those pages
return to the pile as unsettled; pages the teacher sent loose stay loose. A
scan the pile had replaced is restored from its kept file and its record goes
back to `filed`. A packet the undo empties keeps its row when it carries a
score, note, feedback or analysis (the packet count goes to 0), and is deleted
only when it carries nothing. The pile is then `new` again, to be settled
afresh (with another assignment, usually).

**Packets missing a side.** The two-hour "incomplete" rule and its review
items go. A packet that is still short a side simply shows as such on the
Assignments hub ("16 of 18 in · 2 missing a side") and on the assignment
page. The hub's one action moves the assignment on regardless: **Analyse 16**
asks once, "2 packets are missing a side. Analyse them as they are?", and
closes those packets as incomplete when the teacher says yes. Nothing waits
two hours for anyone any more.

### 2. Navigation

```
Student Work    Scan ●3    Assignments    Students              [search]   Settings
```

- **Scan** (`/scan`, also the index route) replaces Today and Review. Its
  badge counts piles that need checking plus loose pages.
- **Assignments** (`/assignments`) is the hub for everything after scanning.
- **Students** (`/students`) stays. **Compare** leaves the menu; `/compare`
  stays reachable from a student's page and an assignment's page.
- `/review`, `/review/sort`, `/review/stack` and `/` redirect to the new
  routes so bookmarks keep working. Today's "Arriving" log lives on at
  `/scan/log`, linked from the Scan screen's footer.

### 3. The Scan screen

```
SCANNING                                 ● watching Desktop\scan · last page 09:14
Scan
Feed one assignment at a time: all the fronts, flip, all the backs.

PILES
┌ scan_0412.pdf · 9:14 · W14-1 Country Report ───────────────────────────────┐
│ 24 sheets · 21 filed on their own · 3 to check                   [Check 3] │
└─────────────────────────────────────────────────────────────────────────────┘
┌ scan_0411.pdf · 9:02 · W23 Short Vowel Sort ───────────────────────────────┐
│ 18 sheets · all filed                                        [Undo]  [Open]│
└─────────────────────────────────────────────────────────────────────────────┘
┌ scan_0410.pdf · 8:51 · no code read ───────────────────────────────────────┐
│ 36 pages · Which assignment is this?  [W14-1 ▾]  [Settle it]               │
└─────────────────────────────────────────────────────────────────────────────┘

LOOSE PAGES  4 pages not from any pile                          [Sort them]

Everything that arrived, page by page →
```

- The folder is shown by its last path segment, full path on hover.
- Pile cards, newest first, with one action each: **Check N** (held sheets),
  **Settle it** (name the assignment), **Undo** (re-settle), **Open** (the
  assignment page). A `jumbled` pile says "The backs did not mirror the
  fronts, so nothing was filed by position; N pages went to loose pages."
- Loose pages: one card with the count and **Sort them**.
- Today's stats strip ("pages today", "this week") goes; "Not yet turned in"
  and "Worth noticing" move to the Assignments hub.

### 4. Checking a pile (`/scan/pile/:id`)

```
SCAN / SCAN_0412.PDF
Country Report · W14-1 · 24 sheets, 21 filed, 3 to check

Sheet 7 of 24 ──────────────────────────────────────────────────────────────
┌ front ───────┐ ┌ back ────────┐    Why: no code on either side, between
│              │ │              │         Lee Da Yun (sheet 1) and Yoon Seo Eun
│  [page img]  │ │  [page img]  │    1  Lee Da Yun · sheet 2    scanned after her sheet 1
│              │ │              │    2  Yoon Seo Eun · sheet 1  scanned before her sheet 2
└──────────────┘ └──────────────┘    3  Someone else  [name or code ______]  sheet [2 ▾]

                       [File as Lee Da Yun · sheet 2   Enter]   [Leave it loose  X]

Checked so far: ✓ sheet 3 → Kim So Yul    ✓ sheet 5 → Ha Si Hyeon
```

- Held sheets one at a time, front and back side by side (click either to
  open large in the viewer). J/K move, 1-3 pick, Enter files both sides,
  X sends both pages to loose pages, R rotates.
- "Someone else" takes a name or code; the sheet number offered is the
  lowest that student still lacks.
- For a pile settled with no codes (§1.6), the screen shows packets instead
  of single sheets: each packet's sheets as thumbnails with a student picker
  prefilled, and one **File all** button. Changing a packet's sheet count
  shifts the ones after it, as File a stack does today.
- When nothing is left, the screen says so and offers **Open W14-1** and
  **Back to Scan**.

### 5. Loose pages (`/scan/loose`)

The existing Sort onto students screen, renamed, for pages that are not in a
pile: single image files, pages a jumbled pile could not settle, and sheets
the teacher left loose from a check. It keeps the tray, the student cards,
drag and drop, and the typed-label box moves here as the quick way to name a
selected page. File a stack is removed; §1.6 covers its case.

### 6. The Assignments hub (`/assignments`)

```
ASSIGNMENTS
Each assignment, where it is, and what comes next.

W14-1  Country Report     Daisy G3   Scanning · 16 of 18 in · 3 to check      [Check pile]
       not yet in: Baek Hyun, Choi Geon Ho
W23    Short Vowel Sort   Daisy G3   Ready to analyse · 18 of 18 in           [Analyse 18]
W22    Weekend Writing    Daisy G3   Analysed · feedback not printed          [Print feedback]
W21    Long A Hunt        Daisy G3   Done · printed Nov 9                     [Open]

                                                                [Add an assignment]
WORTH NOTICING
W22: three students wrote "did you became" …                     (from the class analysis)
```

- Stage, in order: **Scanning** (a pile for it is still arriving or has
  sheets to check), **Ready to analyse** (no pile open for it; packets may
  still be short a side, which the row says),
  **Analysing** (jobs running), **Analysed** (analysed, feedback not yet
  printed), **Done** (feedback printed; `packets.feedbackPrintedAt`, set when
  the feedback print route is opened for that assignment). Without an API
  key, Ready to analyse offers **Copy prompt** instead.
- One action per row, matching the stage. "Not yet in" names under the row
  (the old "Not yet turned in"), truncated after five with "and N more".
- "Worth noticing" moves here from Today.

### 7. The assignment page

Keep the header, stats and sections (Who is in, What the class shows, Scores,
Overview). Change the actions:

- **One primary button** by stage, same as the hub row.
- Everything else under a **More ▾** menu: Edit, Print labels, Class PDF,
  Print record, Copy prompt, Paste class answer, Edit rubric, Scoring
  anchors, Domains, Compare two students, Delete.
- The rubric card shrinks to one line ("Rubric: criteria from the worksheet,
  5 domains, warm · Edit") and the "Switch on analysis" button becomes a
  one-line notice with a link to Settings.
- The "In review" stat becomes "To check" and links to the pile check when
  one is open for this assignment.

### 8. Students

Unchanged except: **Compare with a classmate** stays on the student page,
and the list's footer link to Compare stays. Nothing else moves.

### 9. Settings

Two sections. **Claude**: API key, model, analyse-on-complete, about your
class. **Advanced** (folded shut, one click to open): domains, skill names,
how Claude's ratings compare, what gets sent.

### 10. Polish rules, everywhere

- One red (primary) button per screen; the rest are plain.
- Every inner page has a breadcrumb back to its hub.
- No raw file paths; a folder's name, with the full path on hover.
- Rescans and replaced pages are not in any feed except the page-by-page log.
- Keyboard hints appear only on screens that use the keys.
- Empty states say what to do next in one sentence.

## Data and API

- New: `piles` table (above); `pages.pile`, `pages.pileIndex`,
  `pages.filedFrom` gains the value `'pile'`; `packets.feedbackPrintedAt`.
- New routes: `GET /api/scan` (status, piles with counts, loose page count),
  `GET /api/piles/:id` (the pile, its held sheets with guesses, its filed
  sheets), `POST /api/piles/:id/assignment` (name it, then settle),
  `POST /api/piles/:id/settle` (settle again after undo),
  `POST /api/piles/:id/undo`, `POST /api/piles/:id/sheets/:sheet/file`
  (`{ student, page }`: files both sides), `POST /api/piles/:id/sheets/:sheet/loose`,
  `POST /api/piles/:id/file-all` (the no-codes case: `[{ sheet, student, page }]`),
  `GET /api/scan/log` (the old Today feed), `GET /api/assignments` gains
  `stage` and `nextAction` per row.
- Kept: everything under `/api/review` for loose pages (renamed in the UI
  only), `/api/review/batch`, the packet and page routes, every analysis route.
  `POST /api/review/packets/close-all` and the per-packet close stay as the
  routes the hub's "analyse them as they are" uses; the stale-packet review
  items and `stalePackets()` go.
- Removed: `/api/review/setup-assignment` (a pile with codes for an unknown
  assignment is settled the moment the assignment is created; the Scan
  screen's "Which assignment is this?" offers "New assignment from these
  codes" which does what the card did).

## Migration

- Existing pages have no pile; they stay as they are. Pages currently in
  review become loose pages. Nothing is re-filed. Packets already closed as
  incomplete stay closed.
- Old routes redirect.
- README: the "How a page is filed" section is rewritten around piles; the
  Review paragraphs go; the Windows section is unchanged.

## What is left to the builder

- The exact run-finding rules in §1.4 beyond the cases named (several unknown
  sheets in a row, a run split by a contradiction). Err towards holding.
- Thresholds: three consecutive mirror failures for `jumbled` is a starting
  value.
- How held sheets are stored (`piles.held` JSON is a suggestion; a table is
  fine).
- The look of the More menu and the stage labels' exact wording.
- Whether the page-by-page log paginates.
- Test fixtures: generate PDFs with pdf-lib and coded pages with qrcode and
  sharp, as the existing tests do, including a pile with every failure mode
  (missed code, wrong code, plain sheet, odd count).
