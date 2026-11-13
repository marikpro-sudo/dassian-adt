/**
 * Short-dump feed (/sap/bc/adt/runtime/dumps) parsed without an XML library.
 *
 * Each entry carries the whole dump as XML-escaped HTML in <atom:summary>; a feed of a few dumps
 * holds thousands of entities and trips fast-xml-parser's entity expansion limit. The free-text
 * $query parameter is rejected by older releases ("Data is invalid and could not be converted"),
 * so filtering is done here instead.
 */

export interface DumpEntry {
  id: string;
  time: string;
  user: string;
  runtimeError: string;
  program: string;
  title: string;
  /** ADT uri (and line) of the statement that terminated, when the dump names one */
  terminatedAt?: { uri: string; line?: number };
  errorAnalysis: string;
  termination: string;
  sourceExtract: string;
  stack: string;
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** HTML fragment → plain text: table rows become lines, cells are separated by " | ". */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' | ')
    .replace(/<br\s*\/?>|<\/tr>|<\/h\d>|<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    // SAP writes paragraph breaks of the long text as a literal backslash-n
    .replace(/\\n/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map(l => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? xmlUnescape(m[1]) : '';
}

function element(xml: string, name: string): string {
  const m = new RegExp(`<(?:atom:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:atom:)?${name}>`).exec(xml);
  return m ? m[1] : '';
}

/** Split the dump HTML into its <h4 id="…"> sections. */
function sections(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<h4 id="([A-Z_]+)"[^>]*>[\s\S]*?<\/h4>/g;
  const marks: Array<{ id: string; start: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) marks.push({ id: m[1], start: m.index, bodyStart: m.index + m[0].length });
  marks.forEach((mark, i) => {
    out[mark.id] = html.slice(mark.bodyStart, i + 1 < marks.length ? marks[i + 1].start : html.length);
  });
  return out;
}

export function parseDumpFeed(xml: string): DumpEntry[] {
  const entries = (xml || '').match(/<(?:atom:)?entry\b[\s\S]*?<\/(?:atom:)?entry>/g) || [];
  return entries.map(entry => {
    const summaryXml = element(entry, 'summary');
    const head = entry.replace(/<(?:atom:)?summary\b[\s\S]*?<\/(?:atom:)?summary>/, '');
    const html = xmlUnescape(summaryXml);
    const sec = sections(html);

    const categories = head.match(/<(?:atom:)?category\b[^>]*>/g) || [];
    // the first category is the runtime error, the second the terminated program
    const runtimeError = categories[0] ? attr(categories[0], 'term') : '';
    const program = categories[1] ? attr(categories[1], 'term') : '';

    let terminatedAt: DumpEntry['terminatedAt'];
    const abort = /href="adt:\/\/[^/"]+(\/sap\/bc\/adt\/[^"#]+)(?:#start=(\d+))?[^"]*"[^>]*>Show Abortion in Code/.exec(html);
    if (abort) {
      // keep the uri encoded: namespaced names carry %2f, which must not turn into path separators
      terminatedAt = { uri: abort[1], line: abort[2] ? Number(abort[2]) : undefined };
    }

    return {
      id: xmlUnescape(element(head, 'id')),
      time: element(head, 'published') || element(head, 'updated'),
      user: xmlUnescape(element(element(head, 'author'), 'name')),
      runtimeError,
      program,
      title: xmlUnescape(element(head, 'title')),
      terminatedAt,
      errorAnalysis: htmlToText(sec.ERROR || ''),
      termination: htmlToText(sec.TERMINATION || ''),
      sourceExtract: htmlToText(sec.SOURCE || ''),
      stack: htmlToText(sec.STACK || '')
    };
  });
}

/** Case-insensitive free-text filter over the fields a caller would search by. */
export function filterDumps(dumps: DumpEntry[], query?: string): DumpEntry[] {
  const q = (query || '').trim().toLowerCase();
  if (!q) return dumps;
  return dumps.filter(d =>
    [d.runtimeError, d.program, d.title, d.user, d.errorAnalysis, d.termination].some(f => f.toLowerCase().includes(q))
  );
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [+${text.length - max} chars]` : text;
}
