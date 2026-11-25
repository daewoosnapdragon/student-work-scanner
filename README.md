# Student Work Scanner

A desk scanner drops pages into a folder. This program watches that folder, reads the QR code printed on each page, files the page into the right student's packet for the right assignment, and shows the archive in a browser around the teacher's loop: scan a pile of one assignment, check the few sheets it could not place on its own, analyse, print feedback. The menu is that loop: **Scan**, **Assignments**, **Students**, with Settings at the right.

Built from the Student Work Scanner design mockup.

## Running it

Needs Node 22.13 or newer and nothing else: PDF scans are rendered with a bundled copy of MuPDF, and JPEG, PNG and TIFF are read directly.

```bash
npm install
npm run seed:demo      # optional: a Grade 3 class and three assignments to play with
npm run dev            # API on http://localhost:4710, web app on http://localhost:5173
```

For everyday use build once and run the single server, which serves the web app too:

```bash
npm run build
npm start              # http://localhost:4710
```

Point the scanner at the inbox folder. By default it is `data/inbox` inside this project; set `SWS_INBOX` to use another folder, for example the one your scanner software already saves to.

```bash
SWS_INBOX="/Users/me/Scans" npm start
```

### Windows

Double-click `windows\Start Scanner.cmd`. It builds the app the first time, watches `Desktop\scan` (edit the one `set "SWS_INBOX=..."` line in the file if your scanner saves elsewhere), and opens the browser. Keep the window open while scanning.

To update later, close the scanner and double-click `windows\Update Scanner.cmd`.

For a taskbar icon, double-click `windows\Make Shortcut.cmd` once. It puts a Student Work Scanner shortcut on the Desktop; right-click it, choose Show more options, then Pin to taskbar.

If `npm` refuses to run with a message about scripts being disabled, run this once in PowerShell: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

Other settings: `SWS_DATA_DIR` (where the archive, kept PDFs, thumbnails and database live; default `data/`), `PORT` (default 4710), `SWS_PDF_DPI` (default 200).

## Trying it without a scanner

```bash
npm run seed:demo
npm run samples        # writes one scanned pile and two loose pages into the inbox
npm start
```

Open http://localhost:4710. The pile is `scan_0412.pdf`: Short Vowel Sort (W23, two sheets, both sides) for three students, twelve pages fed as a real pile is fed, fronts then backs. Three things go wrong in it, the three that go wrong with real piles: one back has no code (the scanner missed it), one back carries another student's code (a paste mistake), and one sheet has no code on either side (plain paper). The pile files itself except for two sheets, and the Scan screen says **Check 2**: one sheet whose codes contradict each other, with both readings as guesses, and the plain sheet, which sits next to it and so cannot be placed by position. The two loose pages are single images: one has a code that reads but names a sheet 2 that Weekend Writing (W22, one sheet) does not have, the other has no code at all.

`npm run samples -- --nocode` leaves the codes off the pile instead, for trying a pile from before the codes: it waits on the Scan screen to be told its assignment.

## How a page is filed

1. The watcher waits until a file has stopped growing, then handles files one at a time in the order they arrived. A PDF is rendered to one JPEG per page first and those pages are read next, in page order. The PDF itself is then moved to `data/originals/`, never deleted; every page remembers which PDF and page number it came from.
2. The decoder looks for a QR code on the whole page, then in each corner at full resolution, then again after sharpening and thresholding. Takes about 100 ms on a 150 dpi page.
3. The code reads `SWS1:S07:W23:2B` (older sets: `SWS1|S07|W23|2b`): student S07, assignment W23, sheet 2, back. A page is filed at `data/archive/W23/S07/2b.jpg` and the packet count goes up. A side that is already filed is replaced by the new scan, comments and all; the earlier scan is kept beside it (`2b.r12.jpg`) and in the record as replaced. A packet is complete when every expected side is in. Not every printed side has to come back: on the assignment's Edit form, **Comes back to be scanned** unticks a side that stays with the student, such as a reading page, and the packet then waits only for the ticked ones (a reading page scanned anyway is kept, not counted).

### Piles

**One PDF is one pile**, and a pile is one assignment. Feed every front in pile order, each student's sheets together (Olivia 1, Olivia 2, Jun 1, Jun 2), then flip the pile and feed it again. The backs come out in reverse, so in a PDF of 2N pages, page k and page 2N+1−k are the two sides of one sheet: the mirror. An assignment whose backs all stay with the student is fed fronts only.

Nothing from a PDF is filed until its last page has been read. Then the pile is settled, sheet by sheet:

- **Which assignment**: the one most of the codes name. A page whose code names another assignment goes to loose pages. A pile with no code read at all waits on the Scan screen for you to choose its assignment (**Settle it**); a pile whose codes name an assignment that does not exist yet offers **New assignment from these codes**.
- **What files itself**: a sheet where both sides read and agree, or one side read and the other was missed (the missed side takes the same student and sheet). A sheet with no code on either side between two sheets of the same student takes the sheet number that student is missing (an unknown sheet between Olivia 1 and Olivia 3 is Olivia 2), and so does one between two students when only one of them can still take it.
- **What is held**: a sheet whose two codes contradict each other (a wrong code), a code on the wrong side of the paper, two sheets reading as the same student's same sheet, and a sheet with no code that could belong to either neighbour or to neither. Held sheets wait for the check screen with a best guess each. When in doubt the program holds: a held sheet costs one key press, a wrong placement files one child's work under another child.
- **Jumbled**: when the page count of a two-sided pile is odd, or three or more sheets in a row disagree with their mirror (a jam, a double feed, two piles in one PDF), nothing is filed by position. Every page with a clean code files on its own and the rest go to loose pages, and the Scan screen says so plainly.
- A pile with no code for its assignment on any page is cut into packets of the assignment's sheet count, each given the next student in name order who has not turned the work in, for you to check the names.

**Undo this pile** (on the Scan screen, or **Wrong assignment? Undo this pile** on its check screen) takes back everything the pile filed, by code, by position and by hand: the pages return to the pile, a scan it replaced comes back, and the pile can be settled again, usually under another assignment. Pages the pile itself set aside (another assignment's code, a jumbled pile's leftovers, a blank back) come back with it; pages you sent loose stay loose.

A caveat: a pile where the backs were shifted by one (a double feed) and most of the back codes were missed can stay below the "jumbled" threshold, so a few backs may be placed with the wrong front. The check screen lists what each sheet was filed as, by student, and Undo re-settles the pile.

There is no waiting period any more. A packet still short a side simply shows as such on the Assignments hub ("16 of 18 in · 2 missing a side") and on its page, and the hub's next step moves the assignment on regardless.

### Scan

The Scan screen (the first screen) shows the folder being watched by its name (the full path on hover), when the last page came, and the piles, newest first, each with one action: **Check N** (and **Undo**) when sheets are held, **Settle it** when it needs its assignment, **Open** and **Undo** once it is done. A pile still coming in says how many of its pages are in. Under them, the count of **loose pages** with **Sort them**. Its menu badge counts piles to check plus loose pages. Everything that arrived, page by page, is at the bottom (`/scan/log`).

### Check a pile

Check shows the held sheets one at a time, front and back side by side (click either to open it large), why it was held, and up to two guesses, the likelier first. J and K move, 1 to 3 pick, Enter files both sides, X sends both pages to loose pages, R rotates. The last choice is always **Someone else**: type a name or a student code, wait for it to read as one student, and the sheet number offered is the lowest that student still lacks; Enter files. A pile with no codes shows packets instead, each with its sheets as thumbnails and a student picker (students who already have a packet are marked), and one **File all**. When nothing is left it offers the assignment and Back to Scan.

### Loose pages

Pages that are not in any pile: single image files, pages a jumbled pile could not settle, sheets you left loose from a check, and pages sent back from a packet. Choose the assignment, and the class appears as cards saying what each student has filed and still needs. Drag a page onto a student and it takes the next side that student is missing; click the side label to move it to another side. Click pages to select several (shift-click for a run) and drag them together, or press a card's **Put here**. Drop a page back on the tray to undo. One button files the lot; a side that was filed already is marked in red and replaced. The quickest way for a page whose code did not read is to select it and type what its label says: `S07 W23 2 back`, or a name, `Minji W23 2 back`, and Enter (`/` jumps to the box).

Before the first run, empty the scan folder of old scans, or expect them all in loose pages.

### Assignments

The hub lists every assignment with where it is and one next action:

- **Scanning**: a pile for it is still arriving or has sheets to check, or nothing has been turned in yet. **Check pile** when there is one to check.
- **Ready to analyse**: nothing open for it. **Analyse 16**; when packets are still short a side it asks once whether to analyse them as they are. Without an API key, **Copy prompt** instead.
- **Analysing**, **Analysed** (feedback not printed: **Print feedback**), and **Done** with the date the feedback was printed.

The names not yet in sit under the row. **Worth noticing**, the line each class analysis writes, is at the bottom, and so is **Add an assignment**.

On an assignment's page the same next action is the one red button; everything else is under **More**: Edit, Print labels, Class PDF, Print record, Copy prompt, Paste class answer, Edit rubric, Scoring anchors, Domains (in Settings), Compare two students, and Delete while nothing is scanned. The **To check** figure links to the pile check while one is open.

Clicking any scan opens it over the current screen rather than in a new tab: wheel or pinch to zoom, drag to move, arrow keys to step through the packet's sides (on a student's page, through all their work), R to turn it, 0 to fit, Escape or the browser's Back to close. Where there is analysis, its notes sit beside the page. On Compare (from a student's page or an assignment's More), the two children's pages open together and zoom and move as one.

In the viewer, **Comment** (or C) lets you drag a box over any spot on the page and write what you see there: **Praise**, **Fix** or **Note**. Comments are kept with the page, show as numbered boxes in the viewer and as a count on the thumbnail, and go to Claude the next time the packet is analysed, both drawn on the page and listed by number. They are the ground truth: a fix goes first in the fix-it table in your words, praise is quoted in the student's note, and a question in a note is answered in the teacher's part. The class and packet PDFs carry the boxes too, so the copied prompt can point at them.

## Fixing, exporting and analysing an assignment

On an assignment's page, under More: **Edit** changes its title, class, grade, sheets and sides (the code stays, it is printed on the pages; packets are recounted). In a student's packet, the arrows move a page earlier or later and the sides are renumbered by position; **×** sends a page to loose pages to be filed under someone else. **Class PDF** gives every student's pages in name order, one page each under a header with their name, code and side; each packet has its own **PDF** too.

Analysis is a round trip for now: **Copy prompt** puts a prompt on the clipboard that names the assignment and every student by code and asks for one section per student plus a Class section; give it to Claude with the PDF, then **Paste class answer** splits the reply by code into each student's Analysis box and the class's What the class shows. Both boxes can also be typed into by hand, and the student's analysis shows on their page.

## Switching on analysis

Settings (top right) takes a Claude API key from console.anthropic.com; it is stored in this program's database on this computer and nowhere else. Settings has two parts: the key, the model, analyse-on-complete and a note about your class, and **Advanced**, folded shut, for the domains, the skill names, how Claude's ratings compare with yours, and what gets sent. With a key saved, an assignment's next step is **Analyse**: each packet's pages go to Claude with the assignment's context and back come the teacher's notes, the student's feedback, a score where one applies, the skills shown, and a 1 to 4 rating on each domain; then the class summary and a "worth noticing" line for the Assignments hub. Packets run one at a time in the background and the page follows along. Tick the option in Settings to analyse each packet on its own the moment its last side is scanned. The model is Claude Opus 5.5 unless changed; a class set of about 25 packets costs roughly a dollar.

The domains (Ideas and content, Organization, Language, Spelling and punctuation, Task completion by default) are a list in Settings, under Advanced. The assignment page shows an overview table of students by domain, each packet's chips can be rated by hand, and **Print record** prints the table in landscape followed by every student's notes and feedback, for the teacher's files. The student page gathers the skills into Focus right now and a skill arc across assignments.

Each packet is read with the student's earlier work in view: the skills and ratings from earlier assignments, the fix-it rows they were given, and the last note they read. Claude judges the new pages on their own first, then says which of those earlier skills show here and where each stands now, and whether the child did what the last note asked them to try. A skill the child was weak on that has clearly moved up opens their note. The assignment page and the student page show this as a **Since last time** row, the printed record carries it, and the class summary's "worth noticing" line weighs jumps and slips. The copied prompt carries the same earlier work per student and asks for a `### Progress` part, which Paste class answer reads.

Skills come from a fixed vocabulary, also in Settings under Advanced, so that a skill is called the same thing on every assignment and a child's progress on it can be followed: Claude picks names from the list, a pasted answer's `### Skills` lines are folded onto it (other names for a skill, such as "verb agreement" for "subject-verb agreement", are listed after a `|`), and the student page groups the skill arc by the list's groups. Editing the list renames the skills already recorded. The list is at `/api/skills` for Worksheet Studio, and a rubric focus that names a skill takes the list's name.

Each assignment has a **Rubric** line (Edit rubric opens it), read by the analysis and by Copy prompt alike: success criteria (one a line, each checked met or not yet for every student; empty, Claude works them out from the worksheet), which domains apply and what a 4 looks like for this task, a focus (what you have been teaching), tone and length of the student note, the fix-it row cap, and how to score (1 to 4 holistic, out of N, or not at all). The student's note never mentions the score. When Worksheet Studio prints a class set it seeds the rubric with the worksheet's objective and skill.

Your own ratings are kept apart from Claude's. Typing a score or saving the domain chips by hand records it as yours; a later analysis keeps your rating and files Claude's beside it rather than overwriting it. Wherever both exist, the assignment page shows **Agreement with your ratings**: how often you and Claude gave the same level, how often within one, and which way Claude leans, with the students you differ on. Settings shows the same across every assignment. This is the outside check on the analysis, and it feeds back: when Claude has run high or low by 0.4 or more on three or more packets of an assignment (or six across the class), the prompt says so and tells it to correct.

Scores are steadier when Claude has examples. On a packet, **Make an anchor** takes your own score for it and a line on what makes it that score; the anchors sit in a strip on the assignment page. Every other packet of the assignment then goes to Claude with the anchors' pages first, under your scores, and is scored and rated by comparison with them rather than against the rubric's wording alone. Two or three anchors across the range work best. The anchors' pages are cached by the API across the run, so they add little to the cost. The copied prompt names the anchors too, and they are in the class PDF like everyone else.

Without a key, the manual round trip still works: Class PDF, Copy prompt (which asks for the same Teacher, Feedback and Domains parts), Paste class answer.

## Printing from Worksheet Studio

Worksheet Studio's Print… dialog has a Class set row. It reads the class list from this program (at `http://localhost:4710`, so the scanner must be running on the same computer, or have been once), prints one copy per student with the code already in the corner and the name on the name line, and registers the assignment here. Nothing to stick on. Studio's row has a tick per page for which pages come back, sent as `expect` (`["1a", "2a"]`), and the assignment arrives `waiting`: it stays out of the Assignments list and the students' missing counts until the first page of it is scanned, so a set printed and never collected leaves no gap (the Assignments page can show them).

Studio can read the skill vocabulary at `GET /api/skills` (`{ skills: [{ name, group, aliases }], groups: [{ group, skills }] }`) and tag a worksheet's skill with one of those names; sent as `rubric.focus` when the assignment is registered, it is the same name the analysis then reports, so the worksheet's target and the child's record line up.

## Labels

Every assignment page has Print labels under More (`/print/labels/W23`): one QR label per student per side, four across, ready to stick on the top right corner. The same codes can be placed on the worksheet itself before printing; `/print/code/S07/W23/2/b.svg` gives one code as an SVG. The codes use the highest QR error correction, so a third of the code can be damaged and still read.

## Your students

Export the roster from the school system as CSV (columns: UUID, Name, Korean Name, Grade, English Class, Korean Class, Class Number, Active) and import it:

```bash
npm run import:students -- path/to/students.csv
```

Each student gets a short code for the labels from grade, Korean homeroom class and class number: Grade 3, 대 class, number 7 is `3D07` (대 = D, 솔 = S, 매 = M). Run the import again whenever the roster changes. Students missing from a later export are marked inactive, not deleted, so their work stays. The CSV itself is ignored by git; keep it out of the repository.

A single student can also be added through the API:

```bash
curl -X POST localhost:4710/api/students -H 'content-type: application/json' \
  -d '{"code":"3D26","name":"New Student","nameKo":"새학생","klass":"Snapdragon","grade":3,"homeroom":"대 3-26"}'
```

Assignments are added on the Assignments page. An assignment belongs to a class and, optionally, a grade; its roster and label sheet follow from that.

`npm run seed:demo` loads a made-up class instead, for trying things out. Do not run it on top of a real roster.

## Layout

- `server/` Express API, SQLite (Node's built-in `node:sqlite`, so no native build step), the watcher, decoder and filing pipeline, settling a pile (`piles.ts`, pure) and filing its decisions (`pileFiling.ts`), the Claude analysis step (`claude.ts`) and the pasted-answer parser (`analysis.ts`).
- `web/` Vite and React: Scan (with Check a pile, Loose pages and the page-by-page log), Assignments and an assignment's page, Students, a student's page and Compare, and Settings.
- `shared/types.ts` the shapes both sides use; `shared/skills.ts` the skill vocabulary and the matching that folds free text onto it.
- `scripts/` roster import, demo seed, sample pile generator (uses whatever roster is loaded), `decode-check.ts` to test the decoder on real scans that are not being read.
- `tests/` vitest tests for the code format, settling a pile, filing and undoing piles, the scan and assignment routes, packets and the hand-sorting logic.
- `windows/` the start script, shortcut maker and icon for a taskbar launcher.

## Not in yet

- Per-question crops on the assignment page, the written comparison on Compare, and Ask the archive.
- A students page for adding and editing the roster; it is the CSV import and the API only.
- Phone-camera input. The watcher only handles files that land in the folder.
