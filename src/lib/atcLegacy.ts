/**
 * ATC on older SAP releases (e.g. Basis 7.40).
 *
 * There POST /sap/bc/adt/atc/worklists?checkVariant=… answers 404, but
 * POST /sap/bc/adt/atc/runs?worklistId=<variant> works and returns the verdicts
 * inline as <atc:result verdicts="N"><verdicts><verdict …/></verdicts></atc:result>
 * instead of the newer <atc:worklistRun> envelope that abap-adt-api expects.
 */

export interface LegacyAtcFinding {
  object?: string;
  objectType?: string;
  checkTitle: string;
  messageTitle: string;
  priority: number;
  location?: { uri: string; line?: number; column?: number };
  exemptionKind: string;
}

export interface LegacyAtcResult {
  runId?: string;
  findings: LegacyAtcFinding[];
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : undefined;
}

/** True when the body of an atc/runs response is the old inline-verdict format. */
export function isLegacyAtcResult(xml: string): boolean {
  return /<(?:[\w.-]+:)?result\b[^>]*\bverdicts="/.test(xml) && !/worklistRun/.test(xml);
}

/** Parse the old inline-verdict response of POST /sap/bc/adt/atc/runs. */
export function parseLegacyAtcResult(xml: string): LegacyAtcResult {
  const rootTag = /<(?:[\w.-]+:)?result\b[^>]*>/.exec(xml)?.[0] ?? '';
  const runUri = attr(rootTag, 'adtcore:uri');
  const runId = runUri ? runUri.split('/').pop() : undefined;

  const findings: LegacyAtcFinding[] = [];
  const verdictRe = /<(?:[\w.-]+:)?verdict\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?verdict>)/g;
  let m: RegExpExecArray | null;
  while ((m = verdictRe.exec(xml)) !== null) {
    const head = m[1] || '';
    const inner = m[2] || '';
    const objTag = /<(?:[\w.-]+:)?objectAttributes\b[^>]*>/.exec(inner)?.[0] ?? '';
    const uri = attr(objTag, 'adtcore:uri');
    const pos = uri ? /#start=(\d+)(?:,(\d+))?/.exec(uri) : null;
    findings.push({
      object: attr(objTag, 'adtcore:name'),
      objectType: attr(objTag, 'adtcore:type'),
      checkTitle: attr(head, 'checkTitle') ?? '',
      messageTitle: attr(head, 'messageTitle') ?? '',
      priority: Number(attr(head, 'priority') ?? '3'),
      location: uri
        ? {
            uri: uri.replace(/#.*$/, ''),
            line: pos ? Number(pos[1]) : undefined,
            column: pos && pos[2] !== undefined ? Number(pos[2]) : undefined
          }
        : undefined,
      exemptionKind: attr(head, 'exemptionType') ?? ''
    });
  }
  return { runId, findings };
}

/**
 * ATC wants the function GROUP uri for function modules / group includes,
 * not the fmodules/… or includes/… child uri.
 */
export function atcObjectUrlForNested(nestedObjectUrl: string): string {
  return nestedObjectUrl.replace(/\/(?:fmodules|includes)\/.*$/i, '');
}
