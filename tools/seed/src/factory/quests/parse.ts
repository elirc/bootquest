/**
 * Guide-shape extraction for seed:quests (estate-contract §2.2 / §2.3).
 * Pure: text in, records out (no I/O, no resolution).
 *
 * Goal/**Check** exercises — the two real shapes plus their variations:
 *   inline     `3. **Goal:** ... **Check:** ...` (zz9 docs/architecture/auth-and-permissions.md:88)
 *   sectioned  `**Goal:** ...` paragraph(s) then `**Check:** ...` paragraph (j1 astraupskill/05-PRACTICE.md:51-55),
 *              optionally led by a bold-only label line (`**Level 1 — policy table.**`, ww6 05-PRACTICE.md)
 *   Goal and Check on one line or on separate paragraphs; several Checks per Goal.
 * Findings — the three real shapes:
 *   f-table    `| F1 | Critical | `loc` | finding |` (ww6 06-SOLUTIONS-AND-REVIEW.md:22)
 *   numbered   `1. **Title.** body` under a "...findings..." heading (j1 06-SOLUTIONS-AND-REVIEW.md:63)
 *   r-heading  `**R21. Title (`route.ts:28`).**` + `- bullets` (hnjobtrack training/_answers/review.md:116);
 *              real R-headings also carry "(critical, verified)" tags and `- Where:/Impact:/Fix:` bullets.
 */

export interface GuideLine {
  n: number;
  text: string;
  /** inside (or delimiting) a fenced code block */
  fence: boolean;
}

export interface Heading {
  level: number;
  text: string;
  line: number;
}

export function scanLines(text: string): GuideLine[] {
  const raw = text.replace(/^﻿/, '').split(/\r?\n/);
  // "a\nb\n" has 2 lines (as an editor and the resolver count them), not 3
  if (raw.length > 1 && raw[raw.length - 1] === '') raw.pop();
  const out: GuideLine[] = [];
  let fence: string | null = null;
  raw.forEach((t, i) => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(t);
    if (fence !== null) {
      out.push({ n: i + 1, text: t, fence: true });
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length && t.trim() === m[1]) fence = null;
      return;
    }
    if (m) {
      fence = m[1]!;
      out.push({ n: i + 1, text: t, fence: true });
      return;
    }
    out.push({ n: i + 1, text: t, fence: false });
  });
  return out;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export function headings(lines: readonly GuideLine[]): Heading[] {
  const seen = new Map<string, number>();
  const out: Heading[] = [];
  for (const l of lines) {
    if (l.fence) continue;
    const m = HEADING.exec(l.text);
    if (!m) continue;
    const base = m[2]!.trim();
    const k = `${m[1]!.length}\u0000${base}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    // duplicate headings in one file are disambiguated by an ordinal suffix (stable_key rule (b))
    out.push({ level: m[1]!.length, text: n > 1 ? `${base} #${n}` : base, line: l.n });
  }
  return out;
}

/** Heading path (H1 > H2 > ...) in force at a line. */
export function headingPathAt(hs: readonly Heading[], line: number): string[] {
  const stack: Heading[] = [];
  for (const h of hs) {
    if (h.line > line) break;
    while (stack.length && stack[stack.length - 1]!.level >= h.level) stack.pop();
    stack.push(h);
  }
  return stack.map((h) => h.text);
}

// W7: also the bullet shape `- Goal: ...` / `- Check: ...` (nettrello astraupskill/05-PRACTICE.md:9-10,
// led by a bold label line and paired with a `- **Check:** ...` bullet); the plain-word form only
// counts at the start of a list item, so prose mentioning "Goal:" mid-sentence is not an exercise.
const GOAL = /\*\*Goal:?\*\*:?|^\s*[-*+]\s+Goal:/;
const CHECK = /\*\*Check:?\*\*:?|^\s*[-*+]\s+Check:/;
const LIST_ITEM = /^(\s*)(?:\d+[.)]|[-*+])\s+/;
const BOLD_ONLY = /^\s*\*\*([^*].*?)\*\*\s*$/;

export interface GoalCheck {
  shape: 'inline' | 'sectioned';
  headingPath: string[];
  /** list number, bold lead label, or "goal <ordinal in section>" */
  label: string;
  goal: string;
  checks: string[];
  lineStart: number;
  lineEnd: number;
}

export interface ParseSkip {
  line: number;
  reason: 'unpaired-goal' | 'check-without-goal';
  text: string;
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Extract every Goal/Check exercise (and count unpaired markers). */
export function extractGoalChecks(lines: readonly GuideLine[], hs: readonly Heading[]): { items: GoalCheck[]; skips: ParseSkip[] } {
  const items: GoalCheck[] = [];
  const skips: ParseSkip[] = [];
  const consumed = new Set<number>();
  const ordinal = new Map<string, number>();
  const isHeading = (l: GuideLine) => !l.fence && HEADING.test(l.text);

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.fence || !GOAL.test(l.text)) continue;
    const listM = LIST_ITEM.exec(l.text);
    const goalAt = l.text.search(GOAL);
    const inline = listM !== null && listM[0].length <= goalAt;
    const indent = listM ? listM[1]!.length : 0;
    let lineStart = l.n;
    let label: string;
    const path = headingPathAt(hs, l.n);
    const prev = lines[i - 1];
    if (inline) {
      label = (/^\s*(\d+)[.)]/.exec(l.text)?.[1] ?? '').trim() || '-';
    } else if (prev && !prev.fence && BOLD_ONLY.test(prev.text) && !GOAL.test(prev.text) && !CHECK.test(prev.text)) {
      label = clean(BOLD_ONLY.exec(prev.text)![1]!).replace(/[.:]$/, '');
      lineStart = prev.n;
    } else {
      const sec = path.join(' > ');
      const k = (ordinal.get(sec) ?? 0) + 1;
      ordinal.set(sec, k);
      label = `goal ${k}`;
    }

    // stop conditions for continuing past the Goal line
    const ends = (x: GuideLine): boolean =>
      isHeading(x) || (!x.fence && GOAL.test(x.text)) || (inline && !x.fence && LIST_ITEM.test(x.text) && (LIST_ITEM.exec(x.text)![1]!.length <= indent));

    let goal = l.text.slice(goalAt).replace(GOAL, '');
    const checks: string[] = [];
    let cur: 'goal' | 'check' = 'goal';
    let checkBuf = '';
    let lineEnd = l.n;
    const flushCheck = () => {
      if (clean(checkBuf)) checks.push(clean(checkBuf));
      checkBuf = '';
    };
    const takeSegments = (text: string) => {
      const parts = text.split(CHECK);
      // `- **Check:** ...` bullet: the list marker before the Check belongs to neither side
      if (parts.length > 1) parts[0] = parts[0]!.replace(/^\s*[-*+]\s*$/, '');
      if (cur === 'goal') goal += ` ${parts[0]}`;
      else checkBuf += ` ${parts[0]}`;
      for (const p of parts.slice(1)) {
        if (cur === 'check') flushCheck();
        cur = 'check';
        checkBuf = p;
      }
    };
    // the Goal line itself may carry the Check (inline / one-line shapes)
    {
      const parts = goal.split(CHECK);
      goal = parts[0]!;
      for (const p of parts.slice(1)) {
        if (cur === 'check') flushCheck();
        cur = 'check';
        checkBuf = p;
      }
    }
    let j = i + 1;
    for (; j < lines.length; j++) {
      const x = lines[j]!;
      if (ends(x)) break;
      const blank = x.text.trim() === '';
      if (cur === 'check') {
        // a check paragraph ends at a blank line / fence; another **Check:** paragraph may follow
        if (blank || x.fence) {
          flushCheck();
          let k = j;
          while (k < lines.length && lines[k]!.text.trim() === '') k++;
          const nx = lines[k];
          if (nx && !nx.fence && CHECK.test(nx.text) && !GOAL.test(nx.text) && !ends(nx)) {
            j = k - 1;
            continue;
          }
          break;
        }
        if (inline && LIST_ITEM.test(x.text)) break;
        takeSegments(x.text);
        lineEnd = x.n;
      } else {
        if (x.fence) {
          goal += `\n${x.text}`;
          lineEnd = x.n;
          continue;
        }
        if (blank && inline) break;
        takeSegments(x.text);
        lineEnd = x.n;
      }
    }
    flushCheck();
    for (let n = lineStart; n <= lineEnd; n++) consumed.add(n);
    if (checks.length === 0) {
      skips.push({ line: l.n, reason: 'unpaired-goal', text: clean(goal).slice(0, 120) });
      continue;
    }
    items.push({ shape: inline ? 'inline' : 'sectioned', headingPath: path, label, goal: clean(goal), checks, lineStart, lineEnd });
    i = Math.max(i, j - 1);
  }
  for (const l of lines) {
    if (!l.fence && CHECK.test(l.text) && !consumed.has(l.n)) skips.push({ line: l.n, reason: 'check-without-goal', text: clean(l.text).slice(0, 120) });
  }
  return { items, skips };
}

export type FindingShape = 'f-table' | 'numbered' | 'r-heading';
export type Observation = 'observed' | 'read-derived' | 'author-recorded';

export interface Finding {
  shape: FindingShape;
  headingPath: string[];
  label: string;
  severity?: string;
  title: string;
  body: string;
  /** location cell (f-table) / Where+Proof bullets (r-heading) */
  evidence: string;
  /** Impact/Why/Fix bullets (r-heading) */
  consequence: string;
  observation: Observation;
  aiTag: boolean;
  lineStart: number;
  lineEnd: number;
}

/** Split off the first sentence (outside code spans). */
export function firstSentence(s: string): [string, string] {
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '`') code = !code;
    if (code) continue;
    if ((c === '.' || c === '!' || c === '?') && s[i + 1] === ' ' && /[A-Z`("*]/.test(s[i + 2] ?? '')) {
      return [s.slice(0, i + 1).trim(), s.slice(i + 2).trim()];
    }
  }
  return [s.trim(), ''];
}

/** Table cells, honouring code spans (a | inside backticks is not a separator). */
export function tableCells(row: string): string[] {
  const t = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  let code = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (c === '`') code = !code;
    if (c === '\\' && t[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (c === '|' && !code) {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const SEP_ROW = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const AI_TAG = /\*\*\[AI\]\*\*/;
const READ_DERIVED = /none reproduced|from (?:code )?reading|read-derived|not reproduced|comes from reading/i;
const AUTHOR_RAN = /\breproduced on\b|\bverified\b|\bran (?:the|it)\b/i;

/** Section preamble honesty: what does the guide say about how these findings were established? */
function sectionObservation(lines: readonly GuideLine[], from: number, to: number): Observation {
  const pre = lines
    .filter((l) => l.n > from && l.n < to && !l.fence)
    .map((l) => l.text)
    .join(' ');
  if (READ_DERIVED.test(pre)) return 'read-derived';
  if (AUTHOR_RAN.test(pre)) return 'author-recorded';
  return 'read-derived';
}

const sectionStart = (hs: readonly Heading[], line: number): number => {
  let s = 0;
  for (const h of hs) if (h.line <= line) s = h.line;
  return s;
};

export function extractFindings(lines: readonly GuideLine[], hs: readonly Heading[]): Finding[] {
  const out: Finding[] = [];
  const isHeading = (l: GuideLine) => !l.fence && HEADING.test(l.text);

  // ---- f-table
  for (let i = 0; i + 1 < lines.length; i++) {
    const h = lines[i]!;
    const sep = lines[i + 1]!;
    if (h.fence || !h.text.trim().startsWith('|') || !SEP_ROW.test(sep.text)) continue;
    const head = tableCells(h.text).map((c) => c.toLowerCase().replace(/\*/g, ''));
    const sevCol = head.findIndex((c) => /^(sev|severity)$/.test(c));
    const locCol = head.findIndex((c) => /location|where|file/.test(c));
    const findCol = head.findIndex((c) => /finding|issue|description|problem/.test(c));
    if (sevCol < 0 || locCol < 0 || findCol < 0) continue;
    const obs = sectionObservation(lines, sectionStart(hs, h.n), h.n);
    for (let j = i + 2; j < lines.length && lines[j]!.text.trim().startsWith('|'); j++) {
      const r = lines[j]!;
      const cells = tableCells(r.text);
      const label = (cells[0] ?? '').replace(/\*/g, '').trim();
      if (!/^[A-Z]{1,2}\d+$/.test(label)) continue;
      const [title, body] = firstSentence(cells[findCol] ?? '');
      out.push({
        shape: 'f-table',
        headingPath: headingPathAt(hs, r.n),
        label,
        severity: (cells[sevCol] ?? '').replace(/\*/g, '').trim() || undefined,
        title,
        body,
        evidence: cells[locCol] ?? '',
        consequence: body,
        observation: obs,
        aiTag: AI_TAG.test(r.text),
        lineStart: r.n,
        lineEnd: r.n,
      } as Finding);
    }
  }

  // ---- numbered under a findings heading
  const NUM = /^(\d+)\.\s+\*\*(.+?)\*\*\s*(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.fence) continue;
    const m = NUM.exec(l.text);
    if (!m) continue;
    const path = headingPathAt(hs, l.n);
    const sec = path[path.length - 1] ?? '';
    if (!/finding/i.test(sec) || GOAL.test(l.text)) continue;
    let body = m[3]!;
    let end = l.n;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const x = lines[j]!;
      if (x.text.trim() === '' || isHeading(x) || NUM.test(x.text) || x.fence) break;
      body += ` ${x.text.trim()}`;
      end = x.n;
    }
    const title = m[2]!.trim();
    out.push({
      shape: 'numbered',
      headingPath: path,
      label: m[1]!,
      title,
      body: clean(body),
      evidence: '',
      consequence: clean(body),
      observation: sectionObservation(lines, sectionStart(hs, l.n), lines.find((x) => !x.fence && NUM.test(x.text) && x.n >= sectionStart(hs, l.n))?.n ?? l.n),
      aiTag: AI_TAG.test(title + body),
      lineStart: l.n,
      lineEnd: end,
    });
    i = j - 1;
  }

  // ---- R-headings
  const RH = /^\*\*R(\d+)\.\s+(.+?)\*\*\s*$/;
  const TAG = /\s*\(\s*(critical|high|medium|low|info)\s*(?:,\s*([a-z][a-z ]*))?\)\s*\.?\s*$/i;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.fence) continue;
    const m = RH.exec(l.text);
    if (!m) continue;
    let title = m[2]!.trim();
    let severity: string | undefined;
    let observation: Observation = 'read-derived';
    const tag = TAG.exec(title);
    if (tag) {
      severity = tag[1]!.toLowerCase();
      if (tag[2] && /verified|reproduced/i.test(tag[2])) observation = 'author-recorded';
      title = title.slice(0, tag.index).trim();
      if (!/[.!?]$/.test(title)) title += '.';
    }
    const bullets: { label: string; text: string }[] = [];
    let end = l.n;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const x = lines[j]!;
      if (x.text.trim() === '' || isHeading(x) || RH.test(x.text) || x.fence) break;
      const b = /^\s*[-*+]\s+(.*)$/.exec(x.text);
      if (b && /^[-*+]/.test(x.text.trim()) && x.text.search(/\S/) <= 1) {
        const lab = /^(Where|Why|Impact|Proof|Fix|Evidence|Consequence|Repro):\s*(.*)$/i.exec(b[1]!);
        bullets.push(lab ? { label: lab[1]!.toLowerCase(), text: lab[2]! } : { label: '', text: b[1]! });
      } else if (bullets.length) {
        bullets[bullets.length - 1]!.text += ` ${x.text.trim().replace(/^[-*+]\s+/, '')}`;
      }
      end = x.n;
    }
    const pick = (labs: string[]) =>
      bullets
        .filter((b) => labs.includes(b.label))
        .map((b) => clean(b.text))
        .join(' ');
    let evidence = pick(['where', 'proof', 'evidence', 'repro']);
    let consequence = pick(['impact', 'why', 'fix', 'consequence', '']);
    // only evidence bullets: the evidence IS what to recall (front = the title alone)
    if (!consequence) {
      consequence = bullets.map((b) => clean(b.text)).join(' ');
      evidence = '';
    }
    out.push({
      shape: 'r-heading',
      headingPath: headingPathAt(hs, l.n),
      label: `R${m[1]}`,
      ...(severity ? { severity } : {}),
      title,
      body: bullets.map((b) => clean(b.text)).join(' '),
      evidence,
      consequence,
      observation,
      aiTag: AI_TAG.test(lines.slice(i, j).map((x) => x.text).join(' ')),
      lineStart: l.n,
      lineEnd: end,
    });
    i = j - 1;
  }
  return out.sort((a, b) => a.lineStart - b.lineStart);
}

export interface Section {
  headingPath: string[];
  title: string;
  lineStart: number;
  lineEnd: number;
}

/** Reading steps: one per H2 section (the intro rides with the first); a guide without H2 is one step. */
export function readingSections(lines: readonly GuideLine[], hs: readonly Heading[]): Section[] {
  const last = lines.length ? lines[lines.length - 1]!.n : 1;
  let lastContent = last;
  while (lastContent > 1 && (lines[lastContent - 1]?.text.trim() ?? '') === '') lastContent--;
  const h1 = hs.find((h) => h.level === 1)?.text;
  const h2s = hs.filter((h) => h.level === 2);
  if (h2s.length === 0) return [{ headingPath: h1 ? [h1] : [], title: h1 ?? '(untitled guide)', lineStart: 1, lineEnd: Math.max(1, lastContent) }];
  return h2s.map((h, k) => {
    const next = h2s[k + 1];
    let end = next ? next.line - 1 : lastContent;
    while (end > h.line && (lines[end - 1]?.text.trim() ?? '') === '') end--;
    return {
      headingPath: h1 ? [h1, h.text] : [h.text],
      title: h1 ? `${h1} — ${h.text}` : h.text,
      lineStart: k === 0 ? 1 : h.line,
      lineEnd: end,
    };
  });
}
