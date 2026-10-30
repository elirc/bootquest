// Defect 6c: authored "- item" lines render as a real bullet list (they ran on as one soft-wrapped
// paragraph before). The parser cases pin where a bullet IS a list and where it must stay code/prose.
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Prose, parseProse, splitPrompt } from './prose';

// the sysdrills shape (content/packs/sysdrills/01-estimation.json): bullets directly under a line
const SYSDRILLS =
  '**Your task.** Export `avgQps(dau, requestsPerUser)`:\n- `dau`: daily active users\n- `requestsPerUser`: requests each user makes per day\n- returns the average requests per second: `dau × requestsPerUser / 86400`\n\nMultiply, then divide.';

describe('parseProse: bullet lists', () => {
  it('bullets directly after a paragraph line interrupt it (sysdrills shape): one item per line', () => {
    expect(parseProse(SYSDRILLS)).toEqual([
      { kind: 'p', lines: ['**Your task.** Export `avgQps(dau, requestsPerUser)`:'] },
      {
        kind: 'list',
        items: ['`dau`: daily active users', '`requestsPerUser`: requests each user makes per day', 'returns the average requests per second: `dau × requestsPerUser / 86400`'],
      },
      { kind: 'p', lines: ['Multiply, then divide.'] },
    ]);
  });

  it('bullets after a blank line form a list; a non-bullet line ends it', () => {
    expect(parseProse('Steps:\n\n- one\n- two\nafter')).toEqual([
      { kind: 'p', lines: ['Steps:'] },
      { kind: 'list', items: ['one', 'two'] },
      { kind: 'p', lines: ['after'] },
    ]);
  });

  it('a list at the very start, with up to 3 leading spaces, is still a list', () => {
    expect(parseProse('   - a\n- b')).toEqual([{ kind: 'list', items: ['a', 'b'] }]);
  });

  it('"*" and "+" markers are bullets too; "**bold**" and "-x" (no space) are not', () => {
    expect(parseProse('* star\n+ plus\n- dash')).toEqual([{ kind: 'list', items: ['star', 'plus', 'dash'] }]);
    expect(parseProse('**Bold** lead\n-x not a bullet').map((b) => b.kind)).toEqual(['p']);
  });

  it('a " - " in the middle of a line stays prose', () => {
    expect(parseProse('a - b and c - d\nmore')).toEqual([{ kind: 'p', lines: ['a - b and c - d', 'more'] }]);
  });

  it('a 4-space-indented "- x" stays indented code', () => {
    expect(parseProse('Diff:\n\n    - removed\n    + added')).toEqual([
      { kind: 'p', lines: ['Diff:'] },
      { kind: 'code', text: '- removed\n+ added', lang: null },
    ]);
  });

  it('"- x" inside a fence stays fenced code', () => {
    expect(parseProse('```diff\n- old\n+ new\n```')).toEqual([{ kind: 'code', text: '- old\n+ new', lang: 'diff' }]);
  });

  it('a prompt opening with a list keeps source order (no hoisted heading)', () => {
    expect(splitPrompt('- a\n- b\nWhich holds?')).toEqual({
      heading: '',
      rest: [
        { kind: 'list', items: ['a', 'b'] },
        { kind: 'p', lines: ['Which holds?'] },
      ],
    });
  });
});

describe('Prose: rendering a list', () => {
  it('renders <ul class="prose-list"> with one <li> per bullet and inline code intact', () => {
    const { container } = render(<Prose text={SYSDRILLS} />);
    const list = screen.getByRole('list');
    expect(list).toHaveClass('prose-list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]!.querySelector('code')).toHaveTextContent('dau');
    expect(items[0]).toHaveTextContent('dau: daily active users');
    expect(items[2]!.querySelector('code')).toHaveTextContent('dau × requestsPerUser / 86400');
    // the lead paragraph no longer runs the bullets into itself
    const lead = container.querySelector('.prose > p')!;
    expect(lead.textContent).toBe('Your task. Export avgQps(dau, requestsPerUser):');
    expect(lead.querySelector('strong')).toHaveTextContent('Your task.');
  });

  it('item text is escaped text, never markup', () => {
    render(<Prose text={'- <img src=x onerror=alert(1)>'} />);
    expect(screen.getByRole('listitem')).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });
});

// Mega wave: authored "1. step" lines (80 of them across bootforge / jstrain / csbootcamp /
// javabootcamp prose) render as a real ordered list instead of one run-on paragraph.
describe('parseProse: ordered lists', () => {
  it('dotted items directly after a paragraph line interrupt it; a non-item line ends the list', () => {
    expect(parseProse('Steps:\n1. alpha\n2. beta\nafter')).toEqual([
      { kind: 'p', lines: ['Steps:'] },
      { kind: 'olist', items: ['alpha', 'beta'], start: 1 },
      { kind: 'p', lines: ['after'] },
    ]);
  });

  it('"1." and "1)" are both markers; "1.x" (no space) and a lone "1." are not', () => {
    expect(parseProse('1) paren\n2. dot')).toEqual([{ kind: 'olist', items: ['paren', 'dot'], start: 1 }]);
    expect(parseProse('1.x not an item\n1.')).toEqual([{ kind: 'p', lines: ['1.x not an item', '1.'] }]);
  });

  it('a list opening a block keeps a non-1 start number', () => {
    expect(parseProse('2. second\n3. third')).toEqual([{ kind: 'olist', items: ['second', 'third'], start: 2 }]);
    expect(parseProse('Intro\n\n   7. seventh')).toEqual([
      { kind: 'p', lines: ['Intro'] },
      { kind: 'olist', items: ['seventh'], start: 7 },
    ]);
  });

  it('a non-1 numbered line mid-paragraph stays prose (only "1." interrupts)', () => {
    expect(parseProse('Total was\n12. see the appendix')).toEqual([{ kind: 'p', lines: ['Total was', '12. see the appendix'] }]);
  });

  it('a 4-space-indented "1. x" stays indented code; a fenced one stays fenced code', () => {
    expect(parseProse('Output:\n\n    1. first\n    2. second')).toEqual([
      { kind: 'p', lines: ['Output:'] },
      { kind: 'code', text: '1. first\n2. second', lang: null },
    ]);
    expect(parseProse('```\n1. a\n2. b\n```')).toEqual([{ kind: 'code', text: '1. a\n2. b', lang: null }]);
  });

  it('the numbered LISTING heuristic is untouched: "1 x" (space) is code, "1. x" (dot) is a list', () => {
    expect(parseProse("1 app.patch('/x', () => {\n2 });")).toEqual([{ kind: 'code', text: "1 app.patch('/x', () => {\n2 });", lang: null }]);
    expect(parseProse('1. app.patch()\n2. done')).toEqual([{ kind: 'olist', items: ['app.patch()', 'done'], start: 1 }]);
  });

  it('a prompt opening with an ordered list keeps source order (no hoisted heading)', () => {
    expect(splitPrompt('1. a\n2. b\nWhich holds?')).toEqual({
      heading: '',
      rest: [
        { kind: 'olist', items: ['a', 'b'], start: 1 },
        { kind: 'p', lines: ['Which holds?'] },
      ],
    });
  });
});

describe('Prose: rendering an ordered list', () => {
  it('renders <ol class="prose-list"> with one <li> per item, inline code intact, no start attr at 1', () => {
    render(<Prose text={'Steps:\n1. Export `avgQps`\n2. Divide by **86400**\n3. Return it'} />);
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(list).toHaveClass('prose-list');
    expect(list).not.toHaveAttribute('start');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]!.querySelector('code')).toHaveTextContent('avgQps');
    expect(items[1]!.querySelector('strong')).toHaveTextContent('86400');
  });

  it('a list starting at 2 carries start="2"', () => {
    render(<Prose text={'2. second\n3. third'} />);
    expect(screen.getByRole('list')).toHaveAttribute('start', '2');
  });

  it('item text is escaped text, never markup', () => {
    render(<Prose text={'1. <img src=x onerror=alert(1)>'} />);
    expect(screen.getByRole('listitem')).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });
});

// qw H3: authored list items wrap onto indented continuation lines (jstrain 23-node-drills,
// csbootcamp/javabootcamp explanations, jstrain-cs instructions). Before, the first item kept only
// its first line and the rest of the list ran on inside a paragraph as literal "2. …" text.
describe('parseProse: wrapped and loose list items', () => {
  it('an indented continuation joins its ordered item, and the next item continues the list', () => {
    expect(parseProse('Pitfalls:\n1. **int / int** is integer division.\n   `7 / 2` is 3.\n2. **Capture** copies\n   the variable.\n3. Third.')).toEqual([
      { kind: 'p', lines: ['Pitfalls:'] },
      { kind: 'olist', items: ['**int / int** is integer division. `7 / 2` is 3.', '**Capture** copies the variable.', 'Third.'], start: 1 },
    ]);
  });

  it('an indented continuation joins its bullet item', () => {
    expect(parseProse('- `pack(data)` wraps the payload\n- `unpack(text)` returns it.\n  Return `null` on bad JSON.\nAfter.')).toEqual([
      { kind: 'list', items: ['`pack(data)` wraps the payload', '`unpack(text)` returns it. Return `null` on bad JSON.'] },
      { kind: 'p', lines: ['After.'] },
    ]);
  });

  it('a line deeper than marker width + 3 with no next item is not absorbed: after "1. " a 7-space line is indented code, as before', () => {
    expect(parseProse('1. item\n       deep')).toEqual([
      { kind: 'olist', items: ['item'], start: 1 },
      { kind: 'code', text: '   deep', lang: null },
    ]);
  });

  it('a loose ordered list (blank lines between items, numbering continues) is ONE list; indented code after a blank stays code', () => {
    expect(parseProse('Build:\n\n1. one\n   wraps\n\n2. two\n\n       run(1) → 2\n\nafter')).toEqual([
      { kind: 'p', lines: ['Build:'] },
      { kind: 'olist', items: ['one wraps', 'two'], start: 1 },
      { kind: 'code', text: '   run(1) → 2', lang: null },
      { kind: 'p', lines: ['after'] },
    ]);
  });

  it('ordered lists whose numbering does not continue stay separate', () => {
    expect(parseProse('1. a\n\n3. c')).toEqual([
      { kind: 'olist', items: ['a'], start: 1 },
      { kind: 'olist', items: ['c'], start: 3 },
    ]);
  });

  it('an unindented (lazy) line joins an ordered item only when the next item follows; otherwise it ends the list', () => {
    expect(parseProse('1) A codec: encode writes "\\" as\n"\\\\" and ";" as "\;".\n2) findCounterexample(enc, dec)')).toEqual([
      { kind: 'olist', items: ['A codec: encode writes "\\" as "\\\\" and ";" as "\;".', 'findCounterexample(enc, dec)'], start: 1 },
    ]);
    // unchanged pins: a plain line after the list is a paragraph, and so is one before an unrelated number
    expect(parseProse('Steps:\n1. alpha\n2. beta\nafter')).toEqual([
      { kind: 'p', lines: ['Steps:'] },
      { kind: 'olist', items: ['alpha', 'beta'], start: 1 },
      { kind: 'p', lines: ['after'] },
    ]);
    expect(parseProse('1. alpha\nafter\n5. five')).toEqual([
      { kind: 'olist', items: ['alpha'], start: 1 },
      { kind: 'p', lines: ['after', '5. five'] },
    ]);
  });

  it('renders a wrapped item as ONE <li> carrying all of its text', () => {
    render(<Prose text={'1. `upperOrFail(poison)` pushes\n   `chunk.toUpperCase()` for each record.\n2. `runPipeline(items)` reports.'} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('upperOrFail(poison) pushes chunk.toUpperCase() for each record.');
  });
});
