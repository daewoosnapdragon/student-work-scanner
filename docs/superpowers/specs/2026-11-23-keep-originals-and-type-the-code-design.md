# Keep the scanned PDFs, and file an unread page by typing its code

## Why

Two things from use. The program removes each PDF from the scan folder once it has
rendered its pages, so the original scan is gone for good; a teacher who clears
out a messy first run loses everything. And when the QR code does not read, every
page needs the Review screen one at a time, with guesses that only help when the
neighbouring pages did read; a stack of uncoded pages is slow to file and hard to
fix afterwards.

## Goals

- Never delete a scan. The PDF the scanner wrote is kept, and every page knows
  which PDF and page number it came from.
- Filing an unread page should take one look at the printed label and a few
  keystrokes.
- The side chooser in Review should offer the sides the assignment actually has,
  and show which the student already has filed.

## Non-goals

- Leaving processed PDFs in the scan folder itself. The watcher re-reads the
  whole folder on start, so a file left there would be filed twice; the kept
  copy lives under the data folder instead. (A later version could remember
  processed files by name and size.)
- Moving a filed page straight to another student from the assignment page.
  The route stays unfile → Review → file.

## Approaches considered

1. Leave the PDF in the inbox and remember it was done (by name, size, mtime).
   Fragile: scanners reuse names (scan001.pdf), and a reused name would be skipped.
2. Move the PDF to `data/originals/` after rendering, and store the origin on
   each page. Simple, nothing is lost, the inbox stays a true inbox. **Chosen.**
3. Keep the PDF and skip rendering, decoding straight from the PDF each time.
   Slower for every view and changes the whole archive layout. Dropped.

For typing the code: a free text box that accepts the label text in any loose
form (`S07 W23 2a`, `s07 w23 2 back`, `SWS1:S07:W23:2A`), parsed in shared code
so the server can accept the same string. Chosen over a three-field form because
the label is read left to right and typed the same way.

## Design

- `data/originals/`: PDFs after rendering, name kept, a `-2`, `-3` suffix when
  the name is taken. `pages.origin` (path relative to the data dir) and
  `pages.originPage` (1-based) are recorded on every rendered page.
- Review shows "from scan003.pdf, page 4" with a link to the PDF, on the item and
  in the queue table.
- Review gets a **Type the code** box above the guesses. A valid code fills the
  target and Enter files it. A student name in place of the code is looked up
  on the roster.
- Side chips follow the chosen assignment (`sidesOf`), and chips for sides the
  student already has are marked.
- Today's status line names the originals folder beside the inbox.
