# Student Work Scanner

A desk scanner drops pages into a folder. This program watches that folder, reads the QR code printed on each page, files the page into the right student's packet for the right assignment, and shows the archive in a browser: what arrived today, every student, every assignment, two students side by side, and a review queue for the pages it could not place on its own.

Built from the Student Work Scanner design mockup. Analysis (reading handwriting, scoring, narratives) is deliberately not in yet; the places it will go are marked on the pages.

## Running it

Needs Node 22.13 or newer. For PDF scans, `pdftoppm` (part of poppler) must be on the PATH; JPEG, PNG and TIFF need nothing extra.

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

Other settings: `SWS_DATA_DIR` (where the archive, thumbnails and database live; default `data/`), `PORT` (default 4710), `SWS_INCOMPLETE_AFTER_MIN` (a packet still missing sides this long after its last page goes to review; default 120), `SWS_PDF_DPI` (default 200).

## Trying it without a scanner

```bash
npm run seed:demo
npm run samples        # writes 12 fake scanned pages into the inbox
npm start
```

Open http://localhost:4710. Ten pages file themselves. One has its code torn off and lands in Review with the right guess ranked first; one is a rescan of a side already filed and asks before replacing it. Add `-- --slow` to `npm run samples` while the server is running to watch pages arrive one by one on Today.

## How a page is filed

1. The watcher waits until the file has stopped growing, then handles files one at a time in the order they arrived. PDFs are split into one JPEG per page first.
2. The decoder looks for a QR code on the whole page, then in each corner at full resolution, then again after sharpening and thresholding. Takes about 100 ms on a 150 dpi page.
3. The code reads `SWS1|S07|W23|2b`: student S07, assignment W23, sheet 2, back. If the student and assignment exist, the side is one the assignment expects and that side is not already filed, the page moves to `data/archive/W23/S07/2b.jpg` and the packet count goes up. A packet is complete when every expected side is in.
4. Otherwise the page goes to `data/holding/` and the review queue, with a reason. For an unreadable code the guesses come from scan order: the pages just before and after it say whose stack this came from, and which side that packet is still missing. A packet that stops arriving before it is complete also shows up in review after two hours, to be filed as it is.

Review is keyboard first: J and K move, 1 to 3 pick a guess, Enter files, X skips, R rotates.

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

- `server/` Express API, SQLite (Node's built-in `node:sqlite`, so no native build step), the watcher, decoder and filing pipeline.
- `web/` Vite and React. Six screens, styled from the mockup.
- `shared/types.ts` the shapes both sides use.
- `scripts/` roster import, demo seed, sample scan generator (uses whatever roster is loaded), `decode-check.ts` to test the decoder on real scans that are not being read.
- `tests/` vitest unit tests for the code format, packets and review guesses.

## Not in yet

- Analysis of the work itself (the Claude API step the mockup shows): skill arcs, per-question crops, focus notes, class summaries, the written comparison, Ask the archive.
- A students page for adding and editing the roster; it is the CSV import and the API only.
- Phone-camera input. The watcher only handles files that land in the folder.
