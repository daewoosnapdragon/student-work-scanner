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

## Adding students and assignments

Assignments are added on the Assignments page. Students come in through the API for now:

```bash
curl -X POST localhost:4710/api/students -H 'content-type: application/json' \
  -d '{"code":"S19","name":"New Student","nameKo":"새학생","klass":"Daisy","grade":3,"homeroom":"대 3-20"}'
```

or by editing `scripts/seed-demo.ts` to hold your real roster and running `npm run seed:demo`.

## Layout

- `server/` Express API, SQLite (Node's built-in `node:sqlite`, so no native build step), the watcher, decoder and filing pipeline.
- `web/` Vite and React. Six screens, styled from the mockup.
- `shared/types.ts` the shapes both sides use.
- `scripts/` demo seed, sample scan generator, `decode-check.ts` to test the decoder on real scans that are not being read.
- `tests/` vitest unit tests for the code format, packets and review guesses.

## Not in yet

- Analysis of the work itself (the Claude API step the mockup shows): skill arcs, per-question crops, focus notes, class summaries, the written comparison, Ask the archive.
- A students page for adding and editing the roster; it is API only.
- Phone-camera input. The watcher only handles files that land in the folder.
