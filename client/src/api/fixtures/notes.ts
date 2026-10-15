// "Learn more" note fixtures for dev:mock, in the exact stamped seed:notes item shape
// (shared/src/seed-pack.ts SeedNoteItem), so the mock/server contract test can load the SAME
// notes into a real server. They annotate the borrowbox study-quest fixture (ladder.ts, unit 206).

export interface NoteFixture {
  kind: 'note';
  key: string;
  provenance: { repo: string; sha: string; path: string; lines: { start: number; end: number } };
  citations: never[];
  noteId: string;
  pack: string;
  target: string;
  phase: 'before' | 'after';
  title: string;
  body: string;
  excerpts: { path: string; lineStart: number; lineEnd: number; quote: string }[];
  readMore: { path: string; lineStart: number | null; lineEnd: number | null; why: string }[];
}

const SHA = '0123456789abcdef0123456789abcdef01234567';
const Q = 'seed:quests:borrowbox/quiz/';

function note(noteId: string, target: string, phase: NoteFixture['phase'], title: string, body: string, path: string, lineStart: number, lineEnd: number, quote: string): NoteFixture {
  return {
    kind: 'note',
    key: `seed:notes:borrowbox/note/${noteId}`,
    provenance: { repo: 'borrowbox', sha: SHA, path, lines: { start: lineStart, end: lineEnd } },
    citations: [],
    noteId,
    pack: 'borrowbox',
    target,
    phase,
    title,
    body,
    excerpts: [{ path, lineStart, lineEnd, quote }],
    readMore: [],
  };
}

export const notesFixtures: Record<string, NoteFixture[]> = {
  borrowbox: [
    {
      ...note(
        'r01-start-here',
        'pack',
        'before',
        'Start here: loans, items and one lock',
        'BorrowBox lends **items** to members. Read the concepts guide first, then the API guide.\n\n- `docs/02-CONCEPTS.md` explains what a loan is and why two people must never borrow the same item at once.\n- `docs/03-API.md` lists the endpoints and their status codes.\n\nKeep `src/LoanService.cs` open while you read: the guide quotes it.',
        'docs/02-CONCEPTS.md',
        40,
        44,
        'A loan ties one member to one item until it is returned.',
      ),
      readMore: [{ path: 'docs/03-API.md', lineStart: 1, lineEnd: 30, why: 'The endpoint list, with the status code each one answers.' }],
    },
    note(
      'r02-locking-a-loan',
      'seed:quests:borrowbox/reading-step/a1',
      'before',
      'Concept: why lending needs a lock',
      'Two requests can arrive at the same moment for the same item. Without a lock, both can see the item as free and both can lend it. The concepts guide walks through that race step by step; read it slowly and draw the two timelines side by side.',
      'docs/02-CONCEPTS.md',
      50,
      58,
      'Both requests read the item as available before either one writes the loan.',
    ),
    note('x-q1', `${Q}q1`, 'after', 'Why the lock is on the item', 'The lock guards the thing two requests compete for: the item. Locking the service would serialise every loan in the system; a static gate does the same for every item at once.', 'docs/02-CONCEPTS.md', 60, 62, 'lock (item) { if (item.OnLoan) throw ...; item.OnLoan = true; }'),
    note('x-q2', `${Q}q2`, 'after', 'Why an item already on loan answers 409', '409 Conflict says the request is valid but clashes with the current state. 200 would claim success; 404 would claim the item does not exist.', 'docs/03-API.md', 12, 14, 'POST /loans returns 409 Conflict when the item is already on loan.'),
    note('x-q3', `${Q}q3`, 'after', 'Why the due date lives in the domain', 'The due date is a business rule (loan period by member type), so it belongs in the domain model; the controller only maps HTTP, and the database only stores the result.', 'docs/02-CONCEPTS.md', 70, 72, 'Loan.Create computes DueAt from the member type.'),
    note('x-q4', `${Q}q4`, 'after', 'Why LoanTests.Twice is the proof', 'LoanTests.Twice lends the same item twice and asserts the second call is refused. ItemTests.New only builds an item; "none" is wrong because the test exists.', 'docs/04-TESTS.md', 8, 10, 'LoanTests.Twice: lending an item twice is refused.'),
    note('x-q5', `${Q}q5`, 'after', 'Why an unknown loan id answers 404', 'Returning a loan id that does not exist names a missing resource: 404. 500 would blame the server, and 204 would claim the return worked.', 'docs/03-API.md', 20, 22, 'DELETE /loans/{id} returns 404 for an unknown loan id.'),
  ],
};
