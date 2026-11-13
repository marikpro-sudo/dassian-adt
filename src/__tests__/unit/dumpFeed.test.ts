import { parseDumpFeed, filterDumps, htmlToText, clip } from '../../lib/dumpFeed';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = (program: string, line: number) =>
  `<h6 align="right"><a href="adt://DEV/sap/bc/adt/vit/runtime/dumps/1">Show in SAP GUI</a>&nbsp;` +
  `<a href="adt://DEV/sap/bc/adt/programs/programs/${program.toLowerCase()}/source/main#start=${line}">Show Abortion in Code</a></h6>` +
  `<h4 id="OVERVIEW">Contents</h4><a href="#HEADER">Header Information</a>` +
  `<h4 id="HEADER">Header Information</h4><table><tr><td><b>Runtime Error</b></td><td> X </td></tr></table>` +
  `<h4 id="ERROR">Error analysis</h4>Field&nbsp;"A"&nbsp;&lt;&nbsp;0<br>second line` +
  `<h4 id="TERMINATION">Information on where terminated</h4>In&nbsp;line&nbsp;${line}` +
  `<h4 id="SOURCE">Source Code Extract</h4><TABLE><TR><TD><code>10</code></TD><TD><code>&nbsp;&nbsp;x = 1.</code></TD></TR>` +
  `<TR><TD><code>11</code></TD><TD><code>y = 2.</code></TD></TR></TABLE>` +
  `<h4 id="STACK">Active Calls/Events</h4><TABLE><TR><TH>No.</TH><TH>Event</TH></TR><TR><TD>1</TD><TD>MAIN</TD></TR></TABLE>`;

const entry = (user: string, error: string, program: string, line: number, withSummary = true) =>
  `<atom:entry><atom:author><atom:name>${user}</atom:name><atom:uri>http://x/?a=1&amp;b=2</atom:uri></atom:author>` +
  `<atom:category term="${error}" label="ABAP runtime error"/><atom:category term="${program}" label="Terminated ABAP program"/>` +
  `<atom:id>/sap/bc/adt/vit/runtime/dumps/${user}</atom:id><atom:published>2026-11-12T10:08:31Z</atom:published>` +
  (withSummary ? `<atom:summary type="html">${esc(html(program, line))}</atom:summary>` : '') +
  `<atom:title>Short text for ${error}</atom:title><atom:updated>2026-11-12T10:08:31Z</atom:updated></atom:entry>`;

const FEED =
  `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:title>Dumps</atom:title>` +
  entry('ALICE', 'COMPUTE_INT_ZERODIVIDE', 'ZREPORT_A', 42) +
  entry('BOB', 'MESSAGE_TYPE_X', 'SAPLZFG', 7, false) +
  `</atom:feed>`;

describe('dumpFeed', () => {
  it('parses header fields and the termination link', () => {
    const [a, b] = parseDumpFeed(FEED);
    expect(a).toMatchObject({
      id: '/sap/bc/adt/vit/runtime/dumps/ALICE', time: '2026-11-12T10:08:31Z', user: 'ALICE',
      runtimeError: 'COMPUTE_INT_ZERODIVIDE', program: 'ZREPORT_A', title: 'Short text for COMPUTE_INT_ZERODIVIDE',
      terminatedAt: { uri: '/sap/bc/adt/programs/programs/zreport_a/source/main', line: 42 }
    });
    expect(b.user).toBe('BOB');
    expect(b.terminatedAt).toBeUndefined();
    const ns = parseDumpFeed(FEED.replace('programs/zreport_a/', 'programs/%2fns%2fzreport_a/'))[0];
    expect(ns.terminatedAt?.uri).toBe('/sap/bc/adt/programs/programs/%2fns%2fzreport_a/source/main');
    expect(b.errorAnalysis).toBe('');   // an entry without summary must not throw
  });

  it('turns the html sections into text', () => {
    const [a] = parseDumpFeed(FEED);
    expect(a.errorAnalysis).toBe('Field "A" < 0\nsecond line');
    expect(a.termination).toBe('In line 42');
    expect(a.sourceExtract).toBe('10 |   x = 1.\n11 | y = 2.');
    expect(a.stack).toBe('No. | Event\n1 | MAIN');
  });

  it('survives feeds with thousands of entities', () => {
    const big = FEED.replace('second line', 'x&amp;nbsp;'.repeat(3000));
    expect(parseDumpFeed(big)).toHaveLength(2);
  });

  it('filters case-insensitively over error, program, user and text', () => {
    const all = parseDumpFeed(FEED);
    expect(filterDumps(all, 'zerodivide').map(d => d.user)).toEqual(['ALICE']);
    expect(filterDumps(all, 'saplzfg').map(d => d.user)).toEqual(['BOB']);
    expect(filterDumps(all, 'bob')).toHaveLength(1);
    expect(filterDumps(all, 'field "a"')).toHaveLength(1);
    expect(filterDumps(all, '  ')).toHaveLength(2);
    expect(filterDumps(all, 'nothing-like-this')).toEqual([]);
  });

  it('has small text helpers', () => {
    expect(htmlToText('a<br>b&nbsp;&amp;&nbsp;c')).toBe('a\nb & c');
    expect(htmlToText('one.\\n\ntwo')).toBe('one.\n\ntwo');
    expect(clip('abcdef', 3)).toBe('abc… [+3 chars]');
    expect(clip('abc', 3)).toBe('abc');
    expect(parseDumpFeed('')).toEqual([]);
  });
});
