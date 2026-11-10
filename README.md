# Student Work Scanner

A desk scanner drops pages into a folder. This program watches that folder, reads the QR code printed on each page, files the page into the right student's packet for the right assignment, and shows the archive in a browser: what arrived today, every student, every assignment, two students side by side, and a review queue for the pages it could not place on its own.

Built from the Student Work Scanner design mockup. Analysis (reading handwriting, scoring, narratives) is deliberately not in yet; the places it will go are marked on the pages.

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

Other settings: `SWS_DATA_DIR` (where the archive, thumbnails and database live; default `data/`), `PORT` (default 4710), `SWS_INCOMPLETE_AFTER_MIN` (a packet still missing sides this long after its last page goes to review; default 120), `SWS_PDF_DPI` (default 200).

## Trying it without a scanner

```bash
npm run seed:demo
npm run samples        # writes 12 fake scanned pages into the inbox
npm start
```

Open http://localhost:4710. Ten pages file themselves. One has its code torn off and lands in Review with the right guess ranked first; one is a rescan of a side already filed and asks before replacing it. Add `-- --slow` to `npm run samples` while the server is running to watch pages arrive one by one on Today.

## How a page is filed

1. The watcher waits until the file has stopped growing, then handles files one at a time in the order they arrived. A PDF is rendered to one JPEG per page first, and those pages are handled next, in page order.
2. The decoder looks for a QR code on the whole page, then in each corner at full resolution, then again after sharpening and thresholding. Takes about 100 ms on a 150 dpi page.
3. The code reads `SWS1|S07|W23|2b`: student S07, assignment W23, sheet 2, back. If the student and assignment exist, the side is one the assignment expects and that side is not already filed, the page moves to `data/archive/W23/S07/2b.jpg` and the packet count goes up. A packet is complete when every expected side is in.
4. Otherwise the page goes to `data/holding/` and the review queue, with a reason. For an unreadable code the guesses come from scan order: the pages just before and after it say whose stack this came from, and which side that packet is still missing. A packet that stops arriving before it is complete also shows up in review after two hours, to be filed as it is.

Review is keyboard first: J and K move, 1 to 3 pick a guess, Enter files, X skips, R rotates. Skip everything in the queue clears a backlog in one go, for example old scans without codes that were already in the folder when the program first started. Skipped pages stay on disk under `data/holding/`.

Before the first run, empty the scan folder of old scans, or expect them all in review.

### Work from before the codes

Scan the pile in order, fronts and backs as the scanner feeds them, and open Review, then File a stack. Choose the assignment (or make it there). The stack is cut into one packet per student, so many sides each, and every packet gets the next student on the roster who has not turned that work in, in name order. Check the names against the page thumbnails, change any that are wrong, give a student with fewer or more sides their own count, click a page to leave it out, then file the lot. Pages file the same way coded ones do.

## Fixing, exporting and analysing an assignment

On an assignment's page: **Edit** changes its title, class, grade, sheets and sides (the code stays, it is printed on the pages; packets are recounted). In a student's packet, the arrows move a page earlier or later and the sides are renumbered by position; **×** sends a page back to Review to be filed under someone else. **Download class PDF** gives every student's pages in name order, one page each under a header with their name, code and side; each packet has its own **PDF** too.

Analysis is a round trip for now: **Copy prompt** puts a prompt on the clipboard that names the assignment and every student by code and asks for one section per student plus a Class section; give it to Claude with the PDF, then **Paste class answer** splits the reply by code into each student's Analysis box and the class's What the class shows. Both boxes can also be typed into by hand, and the student's analysis shows on their page.

## Switching on analysis

Settings (top right) takes a Claude API key from console.anthropic.com; it is stored in this program's database on this computer and nowhere else. With a key saved, an assignment's page gets **Analyse with Claude**: each packet's pages go to Claude with the assignment's context and back come the teacher's notes, the student's feedback, a score where one applies, the skills shown, and a 1 to 4 rating on each domain; then the class summary and a "worth noticing" line for Today. Packets run one at a time in the background and the page follows along. Tick the option in Settings to analyse each packet on its own the moment its last side is scanned. The model is Claude Opus 5.5 unless changed; a class set of about 25 packets costs roughly a dollar.

The domains (Ideas and content, Organization, Language, Spelling and punctuation, Task completion by default) are a list in Settings. The assignment page shows an overview table of students by domain, each packet's chips can be rated by hand, and **Print record** prints the table in landscape followed by every student's notes and feedback, for the teacher's files. The student page gathers the skills into Focus right now and a skill arc across assignments.

Each packet is read with the student's earlier work in view: the skills and ratings from earlier assignments, the fix-it rows they were given, and the last note they read. Claude judges the new pages on their own first, then says which of those earlier skills show here and where each stands now, and whether the child did what the last note asked them to try. A skill the child was weak on that has clearly moved up opens their note. The assignment page and the student page show this as a **Since last time** row, the printed record carries it, and the class summary's "worth noticing" line weighs jumps and slips. The copied prompt carries the same earlier work per student and asks for a `### Progress` part, which Paste class answer reads.

Skills come from a fixed vocabulary, also in Settings, so that a skill is called the same thing on every assignment and a child's progress on it can be followed: Claude picks names from the list, a pasted answer's `### Skills` lines are folded onto it (other names for a skill, such as "verb agreement" for "subject-verb agreement", are listed after a `|`), and the student page groups the skill arc by the list's groups. Editing the list renames the skills already recorded. The list is at `/api/skills` for Worksheet Studio, and a rubric focus that names a skill takes the list's name.

Each assignment has a **Rubric** card, read by Analyse with Claude and by Copy prompt alike: success criteria (one a line, each checked met or not yet for every student; empty, Claude works them out from the worksheet), which domains apply and what a 4 looks like for this task, a focus (what you have been teaching), tone and length of the student note, the fix-it row cap, and how to score (1 to 4 holistic, out of N, or not at all). The student's note never mentions the score. When Worksheet Studio prints a class set it seeds the rubric with the worksheet's objective and skill.

Without a key, the manual round trip still works: Class PDF, Copy prompt (which asks for the same Teacher, Feedback and Domains parts), Paste class answer.

## Printing from Worksheet Studio

Worksheet Studio's Print… dialog has a Class set row. It reads the class list from this program (at `http://localhost:4710`, so the scanner must be running on the same computer, or have been once), prints one copy per student with the code already in the corner and the name on the name line, and registers the assignment here. Nothing to stick on.

Studio can read the skill vocabulary at `GET /api/skills` (`{ skills: [{ name, group, aliases }], groups: [{ group, skills }] }`) and tag a worksheet's skill with one of those names; sent as `rubric.focus` when the assignment is registered, it is the same name the analysis then reports, so the worksheet's target and the child's record line up.

## Labels

Every assignment page has a Print labels button (`/print/labels/W23`): one QR label per student per side, four across, ready to stick on the top right corner. The same codes can be placed on the worksheet itself before printing; `/print/code/S07/W23/2/b.svg` gives one code as an SVG. The codes use the highest QR error correction, so a third of the code can be damaged and still read.

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

- `server/` Express API, SQLite (Node's built-in `node:sqlite`, so no native build step), the watcher, decoder and filing pipeline, the Claude analysis step (`claude.ts`) and the pasted-answer parser (`analysis.ts`).
- `web/` Vite and React. Six screens, styled from the mockup.
- `shared/types.ts` the shapes both sides use; `shared/skills.ts` the skill vocabulary and the matching that folds free text onto it.
- `scripts/` roster import, demo seed, sample scan generator (uses whatever roster is loaded), `decode-check.ts` to test the decoder on real scans that are not being read.
- `tests/` vitest unit tests for the code format, packets and review guesses.
- `windows/` the start script, shortcut maker and icon for a taskbar launcher.

## Not in yet

- Per-question crops on the assignment page, the written comparison on Compare, and Ask the archive.
- A students page for adding and editing the roster; it is the CSV import and the API only.
- Phone-camera input. The watcher only handles files that land in the folder.
