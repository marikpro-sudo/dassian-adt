/**
 * Where-used on older SAP releases (SAP_BASIS 7.40).
 *
 * There /sap/bc/adt/repository/informationsystem/usageReferences does not exist (404).
 * The release offers the older "RIS" where-used service instead:
 *
 *   1. POST …/informationsystem/fullnamemapping?RIS_REQUEST_TYPE=MAP_URI_TO_RIS_REQUEST&uri=<adt uri>
 *      (text/plain body: the source when the uri carries #start=line,col, otherwise a dummy line)
 *      → <ris_data_request> naming the object (trobjtype / legacy_type / object_name / encl_object_name / full_name)
 *   2. POST …/informationsystem/whereused?RIS_REQUEST_TYPE=WHERE_USED_LAZY with a <ris_request>:
 *        <object_type>  = the kind of objects to search IN (programs, classes, …)
 *        <payload>      = the object searched FOR
 *      One call per "used in" kind; an empty body means no usages of that kind.
 *   3. POST …/informationsystem/whereused?RIS_REQUEST_TYPE=CODE_LINES with one <ris_where_used_result>
 *      → the source lines of that usage (not available for every kind).
 */

export const RIS_BASE = '/sap/bc/adt/repository/informationsystem/';

export interface RisObject {
  trobjtype: string;
  subtype: string;
  legacyType: string;
  objectName: string;
  enclObjectName: string;
  fullName: string;
}

export type RisKind = [trobjtype: string, legacyType: string];

/** Kinds of objects searched for usages by default: programs, classes, interfaces, function modules. */
export const DEFAULT_USED_IN: RisKind[] = [['PROG', 'P'], ['CLAS', 'OC'], ['INTF', 'OI'], ['FUGR', 'FF']];

/** Extra kinds searched when the target is a dictionary object. */
export const DDIC_USED_IN: RisKind[] = [['TABL', 'DT'], ['TABL', 'DS'], ['DTEL', 'DE'], ['TTYP', 'DA'], ['VIEW', 'DV']];

/** Dictionary types cannot be mapped from an ADT uri on 7.40 — they are addressed directly. */
export const DDIC_PAYLOAD: Record<string, RisKind> = {
  'TABL': ['TABL', 'DT'], 'TABL/DT': ['TABL', 'DT'],
  'STRU': ['TABL', 'DS'], 'TABL/DS': ['TABL', 'DS'],
  'DTEL': ['DTEL', 'DE'], 'DTEL/DE': ['DTEL', 'DE'],
  'DOMA': ['DOMA', 'DD'], 'DOMA/DD': ['DOMA', 'DD'],
  'TTYP': ['TTYP', 'DA'], 'TTYP/DA': ['TTYP', 'DA'],
  'VIEW': ['VIEW', 'DV'], 'VIEW/DV': ['VIEW', 'DV']
};

export interface LegacyUsage {
  name: string;
  type: string;
  parent: string;
  description: string;
  uri: string;
  line?: number;
  include: string;
  /** true for grouping rows (the class / function group that contains the real hits) */
  isContainer: boolean;
  /** the <ris_where_used_result> element, needed to ask for its code lines */
  raw: string;
}

export interface LegacyCodeLine {
  line: number;
  columnStart?: number;
  columnEnd?: number;
  source: string;
  uri: string;
}

export function xmlEscape(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    // the RIS content handler ships angle brackets inside values URL-encoded
    .replace(/%3C/gi, '<')
    .replace(/%3E/gi, '>');
}

/** Text of the first <tag>…</tag> in the fragment; '' for <tag/> or when absent. */
export function tagValue(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m ? xmlUnescape(m[1]) : '';
}

export function parseRisMapping(xml: string): RisObject | null {
  if (!/<ris_data_request>/.test(xml || '')) return null;
  const obj: RisObject = {
    trobjtype: tagValue(xml, 'trobjtype'),
    subtype: tagValue(xml, 'subtype'),
    legacyType: tagValue(xml, 'legacy_type'),
    objectName: tagValue(xml, 'object_name'),
    enclObjectName: tagValue(xml, 'encl_object_name'),
    fullName: tagValue(xml, 'full_name')
  };
  return obj.trobjtype && obj.objectName ? obj : null;
}

export function buildRisRequest(usedIn: RisKind, target: RisObject): string {
  const e = xmlEscape;
  return (
    `<?xml version="1.0" encoding="utf-8"?><ris_request>` +
    `<object_type><trobjtype>${e(usedIn[0])}</trobjtype><subtype></subtype><legacy_type>${e(usedIn[1])}</legacy_type></object_type>` +
    `<scope_object><trobjtype></trobjtype><subtype></subtype><legacy_type></legacy_type>` +
    `<object_name></object_name><encl_object_name></encl_object_name></scope_object>` +
    `<payload><trobjtype>${e(target.trobjtype)}</trobjtype><subtype>${e(target.subtype)}</subtype>` +
    `<legacy_type>${e(target.legacyType)}</legacy_type><object_name>${e(target.objectName)}</object_name>` +
    `<encl_object_name>${e(target.enclObjectName)}</encl_object_name><full_name>${e(target.fullName)}</full_name></payload>` +
    `</ris_request>`
  );
}

export function parseRisResults(xml: string): LegacyUsage[] {
  const out: LegacyUsage[] = [];
  const re = /<ris_where_used_result>[\s\S]*?<\/ris_where_used_result>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml || '')) !== null) {
    const raw = m[0];
    const fullUri = tagValue(raw, 'uri');
    const pos = /#start=(\d+)/.exec(fullUri);
    const include = tagValue(raw, 'object');
    const legacy = tagValue(raw, 'legacy_type');
    out.push({
      name: tagValue(raw, 'object_name'),
      type: tagValue(raw, 'trobjtype') + (legacy ? `/${legacy}` : ''),
      parent: tagValue(raw, 'encl_object_name'),
      description: tagValue(raw, 'description'),
      uri: fullUri.replace(/#.*$/, ''),
      line: pos ? Number(pos[1]) : undefined,
      include,
      isContainer: include === '',
      raw
    });
  }
  return out;
}

export function parseRisCodeLines(xml: string): LegacyCodeLine[] {
  const out: LegacyCodeLine[] = [];
  const blocks = (xml || '').match(/<ris_source_code_result>[\s\S]*?<\/ris_source_code_result>/g) || [];
  for (const block of blocks) {
    const columns = new Map<number, [number, number]>();
    for (const id of block.match(/<ris_result_line_id>[\s\S]*?<\/ris_result_line_id>/g) || []) {
      const line = Number(tagValue(id, 'ris_result_line_ident').trim());
      columns.set(line, [Number(tagValue(id, 'ris_result_column_start')), Number(tagValue(id, 'ris_result_column_end'))]);
    }
    for (const src of block.match(/<ris_result_source_line>[\s\S]*?<\/ris_result_source_line>/g) || []) {
      const line = Number(tagValue(src, 'ris_source_line_ident').trim());
      const col = columns.get(line);
      out.push({
        line,
        columnStart: col ? col[0] : undefined,
        columnEnd: col ? col[1] : undefined,
        // the server prefixes every source line with ':'
        source: tagValue(src, 'ris_source_line').replace(/^:/, ''),
        uri: tagValue(src, 'uri').replace(/#.*$/, '')
      });
    }
  }
  return out;
}

/** Drop grouping rows and duplicates (the same hit can come back for several "used in" kinds). */
export function realUsages(all: LegacyUsage[]): LegacyUsage[] {
  const seen = new Set<string>();
  const out: LegacyUsage[] = [];
  for (const u of all) {
    if (u.isContainer) continue;
    const key = `${u.type}|${u.parent}|${u.name}|${u.include}|${u.line ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}
