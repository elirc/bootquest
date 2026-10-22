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
