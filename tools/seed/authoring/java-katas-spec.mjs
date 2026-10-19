// Builds the three Java kata SPECS (tools/seed/authoring/katas/<repo>.spec.json) with drill-java tests.
// The adapted testable modules are assembled mechanically from the repo files at the pinned sha:
// package lines and intra-repo imports dropped, the remaining imports merged, `public` removed from
// top-level type declarations (one compilation unit, launched as KataTest); every body verbatim.
// Seed-session authoring helper (NOT fingerprinted). Then katagen -> seed:patches per spec:
//   node tools/seed/authoring/java-katas-spec.mjs
//   node tools/seed/authoring/katagen.mjs tools/seed/authoring/katas/j2.spec.json tools/seed/authoring/katas/j2.draft.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd(); // run from the repo root
const OUT = join(ROOT, 'tools/seed/authoring/katas');
const BAR = '\u2500\u2500\u2500';

function adapt(checkout, files, intraPrefix, header) {
  const imports = new Set();
  const bodies = [];
  for (const f of files) {
    const raw = readFileSync(join(ROOT, checkout, f), 'utf8');
    const text = raw.replace(/\r\n/g, '\n'); // the adapted module is LF throughout (repo files are CRLF)
    const keep = [];
    for (const line of text.split('\n')) {
      if (/^package\s/.test(line)) continue;
      const m = /^import\s+(static\s+)?([\w.*]+);\s*$/.exec(line);
      if (m) {
        if (!m[2].startsWith(intraPrefix)) imports.add(line.trim());
        continue;
      }
      keep.push(line.replace(/^public\s+((?:final\s+|abstract\s+)*)(class|record|enum|interface)\b/, '$1$2'));
    }
    while (keep.length && keep[0].trim() === '') keep.shift();
    while (keep.length && keep[keep.length - 1].trim() === '') keep.pop();
    bodies.push(`// ---- ${f} ----\n${keep.join('\n')}\n`);
  }
  const imp = [...imports].sort((a, b) => (a.startsWith('import static') === b.startsWith('import static') ? a.localeCompare(b) : a.startsWith('import static') ? -1 : 1));
  return `${header.map((l) => `// ${l}`).join('\n')}\n${imp.join('\n')}\n\n${bodies.join('\n')}`;
}

/** a tests block: helper classes + KataTest.main running the named checks */
function testsBlock(helpers, tests) {
  const body = tests.map(([name, code]) => `        bootcamp.Check.test(${JSON.stringify(name)}, () -> {\n${code.replace(/^/gm, '            ')}\n        });\n`).join('');
  return `// ${BAR} tests ${BAR}\n${helpers}class KataTest {\n    public static void main(String[] args) {\n${body}        System.exit(bootcamp.Check.report());\n    }\n}\n// ${BAR} end tests ${BAR}\n`;
}
const check = (tests) => ({ type: 'drill-java', files: { tests, tail: '' }, className: 'KataTest', timeoutMs: 30000 });
const bothEdits = (paths, find, replace) => paths.map((path) => ({ path, find, replace }));

// ======================================================================================= j2 (librarytracker)
{
  const sha = 'd5869879670a68e2029468ddffe5978196ffc1cc';
  const checkout = `.cache/checkouts/j2@${sha}`;
  const MOD = 'bootquest-kata/LibraryCore.Testable.java';
  const files = ['src/librarytracker/model/Values.java', 'src/librarytracker/model/Book.java', 'src/librarytracker/model/Borrower.java', 'src/librarytracker/model/Loan.java', 'src/librarytracker/storage/LibraryData.java', 'src/librarytracker/storage/FileStorage.java', 'src/librarytracker/service/LibraryManager.java'];
  const content = adapt(checkout, files, 'librarytracker.', [
    'BootQuest kata module: a TESTABLE, self-contained adaptation (not a repo file) of j2 @ d586987:',
    'the model, storage and service files below, concatenated into one compilation unit. Package lines and',
    'librarytracker.* imports are dropped and `public` is removed from the top-level types (one file, launched',
    'as KataTest); every class body is verbatim. App.java (the CLI) is not included.',
  ]);
  const adapted = { path: MOD, repoPath: 'src/librarytracker/service/LibraryManager.java', kind: 'adapted', content };
  const MGR = 'src/librarytracker/service/LibraryManager.java';
  const FS = 'src/librarytracker/storage/FileStorage.java';
  const setup =
    'java.nio.file.Path dir = java.nio.file.Files.createTempDirectory("bq-j2-kata-");\n' +
    'java.time.Clock clock = java.time.Clock.fixed(java.time.Instant.parse("2026-03-02T10:00:00Z"), java.time.ZoneOffset.UTC);\n' +
    'LibraryManager m = new LibraryManager(new FileStorage(dir), clock);\n';
  const katas = [
    {
      id: 'return-picks-a-returned-loan',
      title: 'Return: find the loan by book id alone ("a copy has one active loan anyway")',
      difficulty: 'easy',
      findingRef: 'j2 consistency boundary: one active loan per copy (astraupskill/02-CONCEPTS.md:5)',
      provenance: { path: 'astraupskill/02-CONCEPTS.md', find: 'A checkout is not just `book.checkedOut = true`.' },
      contextFiles: [{ path: MGR, repoPath: MGR, kind: 'verbatim' }, adapted],
      edits: bothEdits([MGR, MOD], '            .filter(l -> l.bookId() == bookId && l.returnedAt() == null)\n', '            .filter(l -> l.bookId() == bookId)\n'),
      defects: [
        {
          scenario: 'A copy that has been borrowed and returned before is checked out again, and the librarian records its return.',
          in: 'patched',
          path: MGR,
          find: '            .filter(l -> l.bookId() == bookId)\n',
          consequence:
            'Loan history keeps every returned loan of the copy, so findFirst() picks the OLDEST loan, already returned; Loan.returned throws "Loan already returned." and the second (and every later) return of any re-borrowed copy fails. The copy stays checked out forever.',
        },
        {
          scenario: 'Why "one active loan" does not make the filter redundant.',
          in: 'repo',
          path: 'src/librarytracker/storage/LibraryData.java',
          find: '      if (loan.returnedAt() == null && activeLoans.put(loan.bookId(), loan) != null)',
          consequence: 'The aggregate guarantees at most one ACTIVE loan per book; returned loans for the same book are retained on purpose (history and receipts), so book id alone does not identify the active loan.',
        },
      ],
      test: {
        module: MOD,
        check: check(
          testsBlock('', [
            [
              'a first return closes the only loan',
              setup + 'Book b = m.addBook("Dune", "Frank Herbert", null);\nBorrower p = m.registerBorrower("Sam Reader", null, null);\nm.checkOutBook(b.getId(), 1, p.getId(), java.time.LocalDate.parse("2026-03-16"));\nm.returnBook(b.getId(), 2);\nbootcamp.Check.ok(!m.findBookById(b.getId()).get().isCheckedOut(), "the copy is available again");',
            ],
            [
              'a re-borrowed copy can be returned again (loan history keeps returned loans)',
              setup +
                'Book b = m.addBook("Dune", "Frank Herbert", null);\nBorrower p = m.registerBorrower("Sam Reader", null, null);\nm.checkOutBook(b.getId(), 1, p.getId(), java.time.LocalDate.parse("2026-03-16"));\nm.returnBook(b.getId(), 2);\nm.checkOutBook(b.getId(), 3, p.getId(), java.time.LocalDate.parse("2026-03-20"));\nm.returnBook(b.getId(), 4);\nbootcamp.Check.ok(!m.findBookById(b.getId()).get().isCheckedOut(), "the copy is available again");\nbootcamp.Check.eq(m.getLoanHistory().stream().filter(l -> l.returnedAt() != null).count(), 2L);',
            ],
          ]),
        ),
      },
    },
    {
      id: 'search-available-lists-archived',
      title: 'Search: simplify the status filter to "out == checked out"',
      difficulty: 'medium',
      findingRef: 'j2 archival vs availability (astraupskill/02-CONCEPTS.md:23)',
      provenance: { path: 'astraupskill/02-CONCEPTS.md', find: 'Deleting an unused book or borrower is straightforward' },
      contextFiles: [{ path: MGR, repoPath: MGR, kind: 'verbatim' }, adapted],
      edits: bothEdits([MGR, MOD], '                        : b.isActive() && (status.equals("out") == b.isCheckedOut())))\n', '                        : status.equals("out") == b.isCheckedOut()))\n'),
      defects: [
        {
          scenario: 'A librarian archives a withdrawn copy, then searches with status `available` to find something to lend.',
          in: 'patched',
          path: MGR,
          find: '                        : status.equals("out") == b.isCheckedOut()))\n',
          consequence:
            'An archived book is never checked out (Book.setActive refuses while checked out), so it now matches `available`: the search offers copies that checkOutBook will refuse ("Book is archived or already checked out."), and `available` and `archived` overlap.',
        },
        {
          scenario: 'The rule the dropped conjunct encoded.',
          in: 'repo',
          path: 'src/librarytracker/model/Book.java',
          find: '    if (!active || checkedOut)',
          consequence: 'Availability is "active AND not checked out"; checkout refuses an archived copy, so the search must too.',
        },
      ],
      test: {
        module: MOD,
        check: check(
          testsBlock('', [
            [
              'status available lists only active, not-checked-out books',
              setup +
                'Book a = m.addBook("Dune", "Frank Herbert", null);\nBook z = m.addBook("Old Atlas", "Anon", null);\nm.setBookActive(z.getId(), 1, false);\nbootcamp.Check.eq(m.searchBooks("", "available").stream().map(Book::getTitle).toList(), java.util.List.of("Dune"));',
            ],
            ['status archived lists the archived book', setup + 'Book z = m.addBook("Old Atlas", "Anon", null);\nm.setBookActive(z.getId(), 1, false);\nbootcamp.Check.eq(m.searchBooks("atlas", "archived").size(), 1);'],
            [
              'status out lists the checked-out book',
              setup + 'Book a = m.addBook("Dune", "Frank Herbert", null);\nBorrower p = m.registerBorrower("Sam Reader", null, null);\nm.checkOutBook(a.getId(), 1, p.getId(), null);\nbootcamp.Check.eq(m.searchBooks("dune", "out").size(), 1);',
            ],
          ]),
        ),
      },
    },
    {
      id: 'save-advances-state-before-replace',
      title: 'FileStorage.save: record the new baseline before the atomic move',
      difficulty: 'hard',
      findingRef: 'j2 baseline comparison under a cooperative lock (astraupskill/02-CONCEPTS.md:29)',
      provenance: { path: 'astraupskill/02-CONCEPTS.md', find: 'The file store writes one complete snapshot and replaces it atomically.' },
      contextFiles: [{ path: FS, repoPath: FS, kind: 'verbatim' }, adapted],
      edits: bothEdits(
        [FS, MOD],
        '          replaceAtomically(temporary, snapshotFile);\n          baseline = encoded;\n          legacyBooks = null;\n          legacyBorrowers = null;\n          current = next;\n',
        '          baseline = encoded;\n          legacyBooks = null;\n          legacyBorrowers = null;\n          current = next;\n          replaceAtomically(temporary, snapshotFile);\n',
      ),
      defects: [
        {
          scenario: 'The atomic move fails once (disk full, or on Windows the snapshot is briefly held open by a reader or a virus scanner) and the librarian retries the same change.',
          in: 'patched',
          path: FS,
          find: '          current = next;\n          replaceAtomically(temporary, snapshotFile);\n',
          span: 2,
          consequence:
            'FileStorage already believes the failed save happened: `current` is the unsaved revision and `baseline` holds bytes that never reached disk. LibraryManager.commit did not advance (the exception skipped `data = candidate`), so its retry builds the same revision number again and save refuses it with "Revision and allocation watermarks cannot move backward." Every later change in the session fails the same way, though nothing new reached disk, until a reload discards the session\'s view.',
        },
        {
          scenario: 'Where the caller relies on save being all-or-nothing.',
          in: 'repo',
          path: 'src/librarytracker/service/LibraryManager.java',
          find: '    storage.save(candidate);\n    data = candidate;\n',
          span: 2,
          consequence: 'commit only adopts the candidate after save returns; the storage must not adopt it earlier either, or the two halves of the state disagree after a failure.',
        },
      ],
      test: {
        module: MOD,
        check: check(
          testsBlock(
            'class FlakyStorage extends FileStorage {\n    int failures;\n    FlakyStorage(java.nio.file.Path dir, int failures) { super(dir); this.failures = failures; }\n    @Override\n    protected void replaceAtomically(java.nio.file.Path source, java.nio.file.Path target) throws java.io.IOException {\n        if (failures > 0) { failures--; throw new java.io.IOException("simulated: disk full during the atomic move"); }\n        super.replaceAtomically(source, target);\n    }\n}\n\n',
            [
              [
                'a save whose atomic move failed can be retried and lands on disk',
                'java.nio.file.Path dir = java.nio.file.Files.createTempDirectory("bq-j2-kata-");\nLibraryManager m = new LibraryManager(new FlakyStorage(dir, 1));\nbootcamp.Check.raises(java.io.IOException.class, () -> m.addBook("Dune", "Frank Herbert", null));\nm.addBook("Dune", "Frank Herbert", null);\nbootcamp.Check.eq(new FileStorage(dir).load().books().size(), 1);',
              ],
              [
                'a healthy save writes the snapshot',
                'java.nio.file.Path dir = java.nio.file.Files.createTempDirectory("bq-j2-kata-");\nLibraryManager m = new LibraryManager(new FlakyStorage(dir, 0));\nm.addBook("Dune", "Frank Herbert", null);\nm.addBook("Emma", "Jane Austen", null);\nbootcamp.Check.eq(new FileStorage(dir).load().books().size(), 2);',
              ],
            ],
          ),
        ),
      },
    },
  ];
  writeFileSync(join(OUT, 'j2.spec.json'), `${JSON.stringify({ name: 'j2-katas', checkout, katas }, null, 1)}\n`);
}

// ======================================================================================= j7 (oms)
{
  const sha = '7664097131c0b6e5bfc8ecdcb177e4a039a77e47';
  const checkout = `.cache/checkouts/j7@${sha}`;
  const MOD = 'bootquest-kata/OmsCore.Testable.java';
  const files = ['src/oms/domain/DomainValues.java', 'src/oms/domain/OrderStatus.java', 'src/oms/domain/OrderItem.java', 'src/oms/domain/Order.java', 'src/oms/persistence/DelimitedFileUtil.java'];
  const content = adapt(checkout, files, 'oms.', [
    'BootQuest kata module: a TESTABLE, self-contained adaptation (not a repo file) of j7 @ 7664097:',
    'the order aggregate (domain) and the field escaping (persistence) files below, concatenated into one',
    'compilation unit. Package lines and oms.* imports are dropped and `public` is removed from the top-level',
    'types (one file, launched as KataTest); every class body is verbatim.',
  ]);
  const adapted = { path: MOD, repoPath: 'src/oms/domain/Order.java', kind: 'adapted', content };
  const ORDER = 'src/oms/domain/Order.java';
  const DFU = 'src/oms/persistence/DelimitedFileUtil.java';
  const paidOrder =
    'Order order = new Order("o-1", "c-1", java.time.LocalDateTime.parse("2026-03-02T10:00:00"));\norder.addOrMergeItem(new OrderItem("p-1", "Pen", 1, new java.math.BigDecimal("2.50")));\norder.setStatus(OrderStatus.SUBMITTED);\norder.setStatus(OrderStatus.PAID);\n';
  const discounted =
    'Order order = new Order("o-1", "c-1", java.time.LocalDateTime.parse("2026-03-02T10:00:00"));\norder.addOrMergeItem(new OrderItem("p-1", "Lamp", 2, new java.math.BigDecimal("10.00")));\norder.setDiscountAmount(new java.math.BigDecimal("15.00"));\n';
  const katas = [
    {
      id: 'escape-pipe-before-backslash',
      title: 'Snapshot fields: escape the delimiter first, then backslashes',
      difficulty: 'medium',
      findingRef: 'j7 DelimitedFileUtil owns field escaping (astraupskill/01-CODEBASE-MAP.md:17)',
      provenance: { path: 'astraupskill/01-CODEBASE-MAP.md', find: '[StoreSnapshot.java](../src/oms/persistence/StoreSnapshot.java) copies all collections' },
      contextFiles: [{ path: DFU, repoPath: DFU, kind: 'verbatim' }, adapted],
      edits: bothEdits([DFU, MOD], '                .replace("\\\\", "\\\\\\\\")\n                .replace("|", "\\\\|")\n', '                .replace("|", "\\\\|")\n                .replace("\\\\", "\\\\\\\\")\n'),
      defects: [
        {
          scenario: 'A product or customer name containing `|` (e.g. "Pens | Blue") is saved and the snapshot is loaded on the next start.',
          in: 'patched',
          path: DFU,
          find: '                .replace("|", "\\\\|")\n                .replace("\\\\", "\\\\\\\\")\n',
          span: 2,
          consequence:
            'The backslash that escapes the pipe is itself doubled by the second replace, so the field is written as `Pens \\\\| Blue`; split() reads `\\\\` as one literal backslash and the bare `|` as a field separator. The row gains a field, `count(...)` rejects it, and the whole snapshot fails to load ("Unexpected field count."): one name locks the shop out of its own data.',
        },
      ],
      test: {
        module: MOD,
        check: check(
          testsBlock('', [
            ['a field containing | round-trips through join/split', 'bootcamp.Check.eq(DelimitedFileUtil.split(DelimitedFileUtil.join("P", "Pens | Blue", "NB-1")), java.util.List.of("P", "Pens | Blue", "NB-1"));'],
            ['a field containing a backslash round-trips', 'bootcamp.Check.eq(DelimitedFileUtil.split(DelimitedFileUtil.join("C", "C:\\\\data", "x")), java.util.List.of("C", "C:\\\\data", "x"));'],
            ['a field containing a newline round-trips', 'bootcamp.Check.eq(DelimitedFileUtil.split(DelimitedFileUtil.join("C", "two\\nlines")), java.util.List.of("C", "two\\nlines"));'],
          ]),
        ),
      },
    },
    {
      id: 'getitems-exposes-owned-lines',
      title: 'Order.getItems: return an unmodifiable view instead of copying every line',
      difficulty: 'medium',
      findingRef: 'j7 aggregate ownership of order lines (astraupskill/02-CONCEPTS.md:3)',
      provenance: { path: 'astraupskill/02-CONCEPTS.md', find: 'An aggregate is a group of related values with rules that must stay consistent through an operation.' },
      contextFiles: [{ path: ORDER, repoPath: ORDER, kind: 'verbatim' }, adapted],
      edits: [
        ...bothEdits([ORDER, MOD], 'import java.util.Collection;\n', 'import java.util.Collection;\nimport java.util.Collections;\n'),
        ...bothEdits([ORDER, MOD], '    public List<OrderItem> getItems() { return items.stream().map(OrderItem::copy).toList(); }\n', '    public List<OrderItem> getItems() { return Collections.unmodifiableList(items); }\n'),
      ],
      defects: [
        {
          scenario: 'Any caller (the CLI listing, the snapshot writer, a future HTTP handler) reads a PAID order and calls `setQuantity` on a returned line.',
          in: 'patched',
          path: ORDER,
          find: '    public List<OrderItem> getItems() { return Collections.unmodifiableList(items); }\n',
          consequence:
            'The list cannot be resized, but its elements are the order\'s OWN mutable OrderItem objects: `getItems().get(0).setQuantity(99)` changes a paid order\'s quantity and subtotal with no ensureEditable and no discount check, so the aggregate\'s invariants (paid orders are frozen, discount <= subtotal) can be broken from outside.',
        },
        {
          scenario: 'The mutator the view hands out.',
          in: 'repo',
          path: 'src/oms/domain/OrderItem.java',
          find: '    public void setQuantity(int quantity) {',
          consequence: 'OrderItem is mutable (public setQuantity), so only copies may leave the aggregate; that is what the original stream().map(OrderItem::copy) did.',
        },
      ],
      test: {
        module: MOD,
        check: check(
          testsBlock('', [
            [
              'editing a line returned by getItems() does not change a paid order',
              paidOrder + 'order.getItems().get(0).setQuantity(99);\nbootcamp.Check.eq(order.getSubtotal().toPlainString(), "2.50");\nbootcamp.Check.eq(order.getItems().get(0).getQuantity(), 1);',
            ],
            ['the paid order itself refuses edits', paidOrder + 'bootcamp.Check.raises(IllegalArgumentException.class, () -> order.setItemQuantity("p-1", 3));'],
          ]),
        ),
      },
    },
    {
      id: 'set-quantity-mutates-before-validating',
      title: 'Order.setItemQuantity: update the existing line in place instead of building a candidate',
      difficulty: 'hard',
      findingRef: 'j7 candidate-before-mutation rule (astraupskill/02-CONCEPTS.md:12)',
      provenance: { path: 'astraupskill/02-CONCEPTS.md', find: 'The intended update path is `service.updateItemQuantity(orderId, productId, quantity)`.' },
      contextFiles: [{ path: ORDER, repoPath: ORDER, kind: 'verbatim' }, adapted],
      edits: bothEdits(
        [ORDER, MOD],
        '                OrderItem candidate = new OrderItem(productId, current.getProductName(), quantity, current.getUnitPrice());\n                validateSubtotal(getSubtotal().subtract(current.getLineTotal()).add(candidate.getLineTotal()));\n                items.set(index, candidate);\n',
        '                current.setQuantity(quantity);\n                validateSubtotal(getSubtotal());\n',
      ),
      defects: [
        {
          scenario: 'An order has 2 x 10.00 with a 15.00 discount; the clerk lowers the quantity to 1.',
          in: 'patched',
          path: ORDER,
          find: '                current.setQuantity(quantity);\n                validateSubtotal(getSubtotal());\n',
          span: 2,
          consequence:
            'The line is changed BEFORE the discount check. The check still throws "Reduce the discount before reducing the subtotal.", so the clerk sees a refusal, but the quantity is already 1: the order now has subtotal 10.00, discount 15.00 and a total of -5.00, and the next save writes it. A rejected command must leave the aggregate unchanged.',
        },
      ],
      test: {
        module: MOD,
        check: check(
          testsBlock('', [
            [
              'a quantity change the discount forbids is refused AND leaves the order unchanged',
              discounted + 'bootcamp.Check.raises(IllegalArgumentException.class, () -> order.setItemQuantity("p-1", 1));\nbootcamp.Check.eq(order.getItems().get(0).getQuantity(), 2);\nbootcamp.Check.eq(order.getTotal().toPlainString(), "5.00");',
            ],
            ['an allowed quantity change is applied', discounted + 'order.setItemQuantity("p-1", 3);\nbootcamp.Check.eq(order.getTotal().toPlainString(), "15.00");'],
          ]),
        ),
      },
    },
  ];
  writeFileSync(join(OUT, 'j7.spec.json'), `${JSON.stringify({ name: 'j7-katas', checkout, katas }, null, 1)}\n`);
}

// ======================================================================================= bank-account-simulator
{
  const repo = 'organized-experiment-bank-account-simulator';
  const sha = '58cc292076cd17c8922b1cf325e7cce42a4f81f4';
  const checkout = `.cache/checkouts/${repo}@${sha}`;
  const MOD = 'bootquest-kata/Bank.Testable.java';
  const files = ['src/bankapp/model/TransactionType.java', 'src/bankapp/model/BankAccount.java', 'src/bankapp/model/Transaction.java', 'src/bankapp/service/BankService.java'];
  const content = adapt(checkout, files, 'bankapp.', [
    `BootQuest kata module: a TESTABLE, self-contained adaptation (not a repo file) of ${repo} @ 58cc292:`,
    'the model and service files below, concatenated into one compilation unit. Package lines and bankapp.*',
    'imports are dropped and `public` is removed from the top-level types (one file, launched as KataTest);',
    'every class body is verbatim. App.java (the CLI) and FileStorage.java are not included.',
  ]);
  const adapted = { path: MOD, repoPath: 'src/bankapp/service/BankService.java', kind: 'adapted', content };
  const SVC = 'src/bankapp/service/BankService.java';
  const setup =
    'BankService bank = new BankService(java.util.List.of(), java.util.List.of());\nBankAccount a = bank.createAccount("Ada");\nbank.deposit(a.getId(), new java.math.BigDecimal("100.00"), null);\n';
  const katas = [
    {
      id: 'same-account-check-by-reference',
      title: 'Transfer: compare account ids with == ("ids are interned")',
      difficulty: 'easy',
      findingRef: `${repo} README: transfer makes sure both ids are different (README.md:162)`,
      provenance: { path: 'README.md', find: 'Checks both account ids, makes sure they are different, validates the amount' },
      contextFiles: [{ path: SVC, repoPath: SVC, kind: 'verbatim' }, adapted],
      edits: bothEdits([SVC, MOD], '        if (fromAccountId.equals(toAccountId)) {\n', '        if (fromAccountId == toAccountId) {\n'),
      defects: [
        {
          scenario: 'A user types the same account id as source and destination at the CLI prompt (two separate Scanner reads).',
          in: 'patched',
          path: SVC,
          find: '        if (fromAccountId == toAccountId) {\n',
          consequence:
            'Each typed id is a distinct String object, so `==` is false and the same-account guard never fires: the transfer goes through, the balance is debited and credited in place, and two TRANSFER_OUT/TRANSFER_IN records are logged against one account. String identity is not string equality.',
        },
      ],
      test: {
        module: MOD,
        check: check(
          testsBlock('', [
            [
              'a transfer to the same account id (a different String object) is refused',
              setup + 'String typedAgain = new String(a.getId());\nbootcamp.Check.raises(IllegalArgumentException.class, () -> bank.transfer(a.getId(), typedAgain, new java.math.BigDecimal("10.00"), null));\nbootcamp.Check.eq(bank.getTransactionsForAccount(a.getId()).size(), 1);',
            ],
            [
              'a transfer between two accounts moves the money',
              setup + 'BankAccount b = bank.createAccount("Grace");\nbank.transfer(a.getId(), b.getId(), new java.math.BigDecimal("40.00"), "rent");\nbootcamp.Check.eq(a.getBalance().toPlainString(), "60.00");\nbootcamp.Check.eq(b.getBalance().toPlainString(), "40.00");',
            ],
          ]),
        ),
      },
    },
    {
      id: 'transfer-debits-before-resolving-destination',
      title: 'Transfer: resolve the destination account only when crediting it',
      difficulty: 'medium',
      findingRef: `${repo} README: transfer checks both accounts before moving money (README.md:162)`,
      provenance: { path: 'README.md', find: 'Checks both account ids, makes sure they are different, validates the amount' },
      contextFiles: [{ path: SVC, repoPath: SVC, kind: 'verbatim' }, adapted],
      edits: [
        ...bothEdits([SVC, MOD], '        BankAccount sourceAccount = requireAccount(fromAccountId);\n        BankAccount destinationAccount = requireAccount(toAccountId);\n', '        BankAccount sourceAccount = requireAccount(fromAccountId);\n'),
        ...bothEdits([SVC, MOD], '        sourceAccount.decreaseBalance(cleanAmount);\n        destinationAccount.increaseBalance(cleanAmount);\n', '        sourceAccount.decreaseBalance(cleanAmount);\n        BankAccount destinationAccount = requireAccount(toAccountId);\n        destinationAccount.increaseBalance(cleanAmount);\n'),
      ],
      defects: [
        {
          scenario: 'A user mistypes the destination account id in a transfer.',
          in: 'patched',
          path: SVC,
          find: '        sourceAccount.decreaseBalance(cleanAmount);\n        BankAccount destinationAccount = requireAccount(toAccountId);\n',
          span: 2,
          consequence:
            'The source is debited first; only then does requireAccount throw "Account not found". The user sees an error, but the money has already left the source account with no transaction record and no credit anywhere, and the next save (App saves after every successful command and on exit) persists the lower balance. Every precondition must be checked before the first mutation.',
        },
      ],
      test: {
        module: MOD,
        check: check(
          testsBlock('', [
            [
              'a transfer to an unknown account is refused and the source keeps its money',
              setup + 'bootcamp.Check.raises(IllegalArgumentException.class, () -> bank.transfer(a.getId(), "ACC-missing", new java.math.BigDecimal("30.00"), null));\nbootcamp.Check.eq(a.getBalance().toPlainString(), "100.00");',
            ],
            [
              'a valid transfer logs both sides',
              setup + 'BankAccount b = bank.createAccount("Grace");\nbank.transfer(a.getId(), b.getId(), new java.math.BigDecimal("30.00"), null);\nbootcamp.Check.eq(bank.getTransactionsForAccount(b.getId()).size(), 1);\nbootcamp.Check.eq(b.getBalance().toPlainString(), "30.00");',
            ],
          ]),
        ),
      },
    },
  ];
  writeFileSync(join(OUT, `${repo}.spec.json`), `${JSON.stringify({ name: `${repo}-katas`, checkout, katas }, null, 1)}\n`);
}
console.log('specs written');
