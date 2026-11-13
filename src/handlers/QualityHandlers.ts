import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { buildObjectUrl, buildSourceUrl, buildMethodUrl, NESTED_TYPES } from '../lib/urlBuilder.js';
import { formatError, parseAdtError } from '../lib/errors.js';
import { isLegacyAtcResult, parseLegacyAtcResult, atcObjectUrlForNested } from '../lib/atcLegacy.js';
import {
  RIS_BASE, DEFAULT_USED_IN, DDIC_USED_IN, DDIC_PAYLOAD, buildRisRequest, parseRisMapping,
  parseRisResults, parseRisCodeLines, realUsages, type RisObject, type LegacyUsage
} from '../lib/whereUsedLegacy.js';
import type { UsageReference } from 'abap-adt-api';

export class QualityHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'abap_syntax_check',
        annotations: { readOnlyHint: true },
        description:
          'Run a syntax check on an ABAP object. Returns errors and warnings. ' +
          'Use this after writing source to verify correctness before activating. ' +
          'Supports all types including FUGR/FF (function modules).',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Object name' },
            type: { type: 'string', description: 'Object type (e.g. CLAS, PROG/I, FUGR/FF)' },
            fugr: { type: 'string', description: 'Parent function group — required for FUGR/FF if auto-discovery fails' }
          },
          required: ['name', 'type']
        }
      },
      {
        name: 'abap_atc_run',
        annotations: { readOnlyHint: true },
        description:
          'Run ABAP Test Cockpit (ATC) checks on an object. ' +
          'Returns findings grouped by severity (error, warning, info). ' +
          'Clean core compliance issues appear here. ' +
          'The response includes worklistId and variantWarning — if variantWarning is set, SAP silently fell back to DEFAULT (variant name did not match SATC configuration). ' +
          'Use abap_atc_variants to see what the system reports as its configured properties. ' +
          'On older releases (Basis 7.40) the variant lookup endpoint does not exist: the run is then sent directly with the variant name and the response carries mode="legacy". ' +
          'For FUGR/FF (function module) the whole function group is checked — pass fugr if auto-discovery fails. ' +
          'ATC checks the ACTIVE version: activate first.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Object name' },
            type: { type: 'string', description: 'Object type' },
            fugr: { type: 'string', description: 'Parent function group — for type FUGR/FF if auto-discovery fails' },
            variant: { type: 'string', description: 'ATC check variant name — must match exactly what is configured in SATC transaction (case-sensitive). Default: DEFAULT' }
          },
          required: ['name', 'type']
        }
      },
      {
        name: 'abap_atc_variants',
        annotations: { readOnlyHint: true },
        description:
          'Return ATC system customizing (configured properties and exemption kinds). ' +
          'Use this to diagnose ATC variant issues. Note: SAP does not expose a standard endpoint to list all variant names — ' +
          'variant names must be checked in SATC transaction on the SAP system. ' +
          'This tool also probes whether "DEFAULT" and a given variant resolve to the same worklist ID (silent fallback detection).',
        inputSchema: {
          type: 'object',
          properties: {
            probe_variant: { type: 'string', description: 'Optional: a variant name to probe. Returns worklistId for both DEFAULT and this variant so you can detect silent fallback (same ID = SAP fell back to DEFAULT).' }
          }
        }
      },
      {
        name: 'abap_where_used',
        annotations: { readOnlyHint: true },
        description:
          'Find all references to an ABAP object (where-used list). ' +
          'Returns every object that references the target, with object name, type, package, and description. ' +
          'Equivalent to Ctrl+Shift+G in Eclipse ADT or SE12 where-used in SAP GUI. ' +
          'Use this before deleting or modifying objects to understand the impact. ' +
          'For class methods use type CLAS/OM with name="CLASS_NAME::METHOD_NAME" (e.g. "/DSN/MY_CLASS::GET_CONT") ' +
          'or pass name=class and method=method_name separately. ' +
          'On older releases (SAP_BASIS 7.40) the modern where-used resource does not exist: the older where-used service is used instead ' +
          '(response carries mode="legacy"). There usages are searched in programs, classes, interfaces and function modules ' +
          '(plus dictionary objects for TABL/STRU/DTEL/DOMA/TTYP/VIEW), each reference has uri and line where SAP reports one, ' +
          'and snippets=true adds the source lines for up to 20 references. FUGR/FF takes an optional fugr.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Object name, e.g. /DSN/GPD_DISRP or /DSN/CL_S4CM_CMB_CONTRACT. For methods: /DSN/MY_CLASS::GET_CONT or just the class name when method param is used.' },
            type: { type: 'string', description: 'Object type (e.g. CLAS, VIEW, TABL, DTEL, INTF, PROG, FUGR, DDLS). Use CLAS/OM for class methods.' },
            method: { type: 'string', description: 'Method name when type=CLAS/OM (alternative to CLASS::METHOD syntax in name)' },
            line: { type: 'number', description: 'Optional: line number to find references to a specific symbol at that position' },
            column: { type: 'number', description: 'Optional: column number (used with line) for symbol-level where-used' },
            snippets: { type: 'boolean', description: 'If true, also fetch code snippets showing exactly how the object is used at each location (default: false)' },
            fugr: { type: 'string', description: 'Parent function group — for type FUGR/FF if auto-discovery fails' },
            max_results: { type: 'number', description: 'Legacy mode only: maximum references returned (default 200)' }
          },
          required: ['name', 'type']
        }
      },
      {
        name: 'abap_find_definition',
        annotations: { readOnlyHint: true },
        description:
          'Jump to the definition of an ABAP symbol at a specific cursor position in source code. ' +
          'Requires a source object (name+type) AND the exact line/column where the symbol appears — ' +
          'NOT an object name lookup. First call abap_get_source to read the code and locate the symbol, ' +
          'then pass those coordinates here. Equivalent to F3 / Ctrl+Click in Eclipse ADT.',
        inputSchema: {
          type: 'object',
          properties: {
            name:   { type: 'string',  description: 'Object name containing the symbol, e.g. /DSN/CL_S4CM_CMB_CONTRACT' },
            type:   { type: 'string',  description: 'Object type, e.g. CLAS, PROG/I' },
            line:   { type: 'number',  description: 'Line number (1-based) of the symbol in the source' },
            column: { type: 'number',  description: 'Column number (1-based) of the symbol start' },
            end_column: { type: 'number', description: 'Column number of the symbol end (inclusive). Defaults to column+1 if omitted.' },
            implementation: { type: 'boolean', description: 'If true, jump to the implementation rather than the declaration (default: false)' }
          },
          required: ['name', 'type', 'line', 'column']
        }
      },
      {
        name: 'abap_fix_proposals',
        description:
          'Get ADT quick-fix proposals for a syntax error at a specific position. ' +
          'Workflow: run abap_syntax_check → get error line/column → call this tool → apply the chosen fix with abap_write. ' +
          'Returns a list of proposed fixes with descriptions and the exact source changes to apply.',
        inputSchema: {
          type: 'object',
          properties: {
            name:   { type: 'string', description: 'Object name' },
            type:   { type: 'string', description: 'Object type (e.g. CLAS, PROG/P)' },
            line:   { type: 'number', description: 'Line number of the error (from syntax check result)' },
            column: { type: 'number', description: 'Column number of the error (from syntax check result)' }
          },
          required: ['name', 'type', 'line', 'column']
        }
      }
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'abap_syntax_check':    return this.handleSyntaxCheck(args);
      case 'abap_atc_run':         return this.handleAtcRun(args);
      case 'abap_atc_variants':    return this.handleAtcVariants(args);
      case 'abap_where_used':      return this.handleWhereUsed(args);
      case 'abap_find_definition': return this.handleFindDefinition(args);
      case 'abap_fix_proposals':   return this.handleFixProposals(args);
      default: throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
    }
  }

  private async handleSyntaxCheck(args: any): Promise<any> {
    if (!args.name || !args.type) {
      this.fail('abap_syntax_check requires name (object name) and type (e.g. CLAS, PROG/I).');
    }
    try {
      let sourceUrl: string;

      if (NESTED_TYPES.has(args.type?.toUpperCase())) {
        const resolved = await this.resolveNestedUrl(args.name, args.type, args.fugr);
        sourceUrl = resolved.sourceUrl;
      } else {
        sourceUrl = buildSourceUrl(args.name, args.type);
      }

      const source = await this.withSession(() =>
        this.adtclient.getObjectSource(sourceUrl)
      );
      const result = await this.withSession(() =>
        this.adtclient.syntaxCheck(sourceUrl, sourceUrl, source as string)
      );
      return this.success({ name: args.name, syntaxResult: result });
    } catch (error: any) {
      this.fail(formatError(`abap_syntax_check(${args.name})`, error));
    }
  }

  private async handleWhereUsed(args: any): Promise<any> {
    if (!args.name || !args.type) {
      this.fail('abap_where_used requires name (object name) and type (e.g. CLAS, VIEW, TABL). For class methods use type CLAS/OM with name="CLASS::METHOD" or name=class + method=method_name.');
    }
    try {
      let objectUrl: string;
      if (args.type?.toUpperCase() === 'CLAS/OM') {
        // Method where-used: name="CLASS::METHOD" or name=class + method=method_name
        let className: string;
        let methodName: string;
        if (args.method) {
          className = args.name;
          methodName = args.method;
        } else if (args.name.includes('::')) {
          [className, methodName] = args.name.split('::');
        } else {
          this.fail('For CLAS/OM where-used, provide name="CLASS::METHOD_NAME" or name=class + method=method_name.');
        }
        objectUrl = buildMethodUrl(className!, methodName!);
      } else {
        objectUrl = buildObjectUrl(args.name, args.type);
      }

      // Basis 759 (S/4HANA 2025) returns "usagereferences:" namespace prefix (all lowercase)
      // but the library's XML parser looks for "usageReferences:" (camelCase), giving 0 results.
      // Fix: inject a temporary Axios response interceptor to normalise the casing before parsing.
      // Safe on all basis versions — camelCase is correct per the SAP XML schema.
      const axiosInst = (this.adtclient as any).httpClient?.httpclient?.axios;
      let interceptorId: number | undefined;
      if (axiosInst?.interceptors?.response) {
        interceptorId = axiosInst.interceptors.response.use((resp: any) => {
          if (typeof resp.data === 'string' && resp.data.includes('usagereferences:')) {
            resp.data = resp.data.replace(/usagereferences:/g, 'usageReferences:');
          }
          return resp;
        });
      }

      let references: UsageReference[];
      try {
        references = await this.withSession(() =>
          this.adtclient.usageReferences(objectUrl, args.line, args.column)
        );
      } catch (e: any) {
        // SAP_BASIS 7.40: no usageReferences resource — fall back to the older where-used service.
        if (!parseAdtError(e).isNotFound) throw e;
        return await this.whereUsedLegacy(args);
      } finally {
        if (axiosInst && interceptorId !== undefined) {
          axiosInst.interceptors.response.eject(interceptorId);
        }
      }

      // Use all references — isResult flag is unreliable across SAP versions
      const summary = references.map(r => ({
        name: r['adtcore:name'],
        type: r['adtcore:type'] || '',
        description: r['adtcore:description'] || '',
        package: r.packageRef?.['adtcore:name'] || '',
        responsible: r['adtcore:responsible'] || '',
        uri: r.uri,
        usage: r.usageInformation || ''
      }));

      // Optionally fetch code snippets
      let snippets: any[] | undefined;
      if (args.snippets && references.length > 0) {
        const rawSnippets = await this.withSession(() =>
          this.adtclient.usageReferenceSnippets(references)
        );
        snippets = rawSnippets.map(s => ({
          objectIdentifier: s.objectIdentifier,
          snippets: s.snippets.map(sn => ({
            content: sn.content,
            matches: sn.matches,
            description: sn.description
          }))
        }));
      }

      return this.success({
        name: args.name,
        type: args.type,
        referenceCount: summary.length,
        references: summary,
        ...(snippets ? { snippets } : {})
      });
    } catch (error: any) {
      this.fail(formatError(`abap_where_used(${args.name})`, error));
    }
  }

  private async handleAtcRun(args: any): Promise<any> {
    if (!args.name || !args.type) {
      this.fail('abap_atc_run requires name (object name) and type (e.g. CLAS, PROG/P). ' +
        'To check a transport\'s objects, first list them with transport_contents, then run ATC per object.');
    }
    const variant = args.variant || 'DEFAULT';
    try {
      // ATC wants the function GROUP for function modules / group includes.
      const upType = String(args.type).toUpperCase();
      let objectUrl: string;
      if (upType === 'FUGR/FF' || upType === 'FUGR/I') {
        const nested = await this.resolveNestedUrl(args.name, upType, args.fugr);
        objectUrl = atcObjectUrlForNested(nested.objectUrl);
      } else {
        objectUrl = buildObjectUrl(args.name, args.type);
      }

      // Step 1: Resolve variant name to internal worklist ID.
      // SAP silently falls back to DEFAULT if the variant name doesn't exist in SATC.
      let worklistId: string;
      try {
        worklistId = await this.withSession(() =>
          this.adtclient.atcCheckVariant(variant)
        );
      } catch (e: any) {
        // Older releases (Basis 7.40): /atc/worklists?checkVariant= answers 404, but
        // /atc/runs?worklistId=<variant> works and returns the verdicts inline.
        if (!parseAdtError(e).isNotFound) throw e;
        return await this.runLegacyAtc(args.name, variant, objectUrl);
      }

      // Step 1b: Fallback detection — if a non-DEFAULT variant was requested,
      // probe DEFAULT and compare IDs. Same ID = SAP silently fell back.
      // Intercept BEFORE running so results aren't silently from the wrong variant.
      let resolvedVariant = variant;
      if (variant !== 'DEFAULT') {
        try {
          const defaultWorklistId = await this.withSession(() =>
            this.adtclient.atcCheckVariant('DEFAULT')
          );
          if (worklistId === defaultWorklistId) {
            const choice = await this.elicitChoice(
              `Variant "${variant}" was not found in SATC — SAP would silently run DEFAULT instead.\n` +
              `Proceed with DEFAULT, or cancel and fix the variant name (check SATC, names are case-sensitive)?`,
              'action',
              ['Proceed with DEFAULT', 'Cancel'],
              'Cancel'
            );
            if (!choice || choice === 'Cancel') {
              this.fail(
                `abap_atc_run cancelled: variant "${variant}" does not exist in SATC. ` +
                `Use abap_atc_variants with probe_variant to test names, or check SATC transaction directly.`
              );
            }
            resolvedVariant = 'DEFAULT';
          }
        } catch (e: any) {
          // If the probe itself throws (e.g. elicitation not supported), proceed as before
          if (e.message?.includes('cancelled')) throw e;
        }
      }

      // Step 2: Trigger a fresh ATC run using the resolved ID.
      await this.notify(`Running ATC on ${args.name} (variant: ${variant})…`);
      const runResult = await this.withSession(() =>
        this.adtclient.createAtcRun(worklistId, objectUrl, 100)
      );

      // Step 3: Fetch findings using run ID + timestamp.
      await this.notify(`ATC run complete — fetching findings…`);
      const worklist = await this.withSession(() =>
        this.adtclient.atcWorklists(runResult.id, runResult.timestamp, '', false)
      );

      // Group findings by priority: 1=error, 2=warning, else=info
      const grouped: { error: any[]; warning: any[]; info: any[] } = { error: [], warning: [], info: [] };
      let totalFindings = 0;
      for (const obj of (worklist.objects || [])) {
        for (const f of (obj.findings || [])) {
          totalFindings++;
          const finding = {
            object: obj.name,
            objectType: obj.type,
            checkId: f.checkId,
            checkTitle: f.checkTitle,
            messageTitle: f.messageTitle,
            priority: f.priority,
            location: f.location ? {
              uri: f.location.uri,
              line: f.location.range ? f.location.range.start.line : undefined,
              column: f.location.range ? f.location.range.start.column : undefined
            } : undefined,
            exemptionKind: f.exemptionKind || ''
          };
          if (f.priority === 1) grouped.error.push(finding);
          else if (f.priority === 2) grouped.warning.push(finding);
          else grouped.info.push(finding);
        }
      }

      return this.success({
        name: args.name,
        variant: resolvedVariant,
        requestedVariant: variant !== resolvedVariant ? variant : undefined,
        worklistId,
        runId: runResult.id,
        findings: grouped,
        totalFindings
      });
    } catch (error: any) {
      this.fail(formatError(`abap_atc_run(${args.name})`, error));
    }
  }

  /** Where-used through the older RIS service (see lib/whereUsedLegacy.ts). */
  private async whereUsedLegacy(args: any): Promise<any> {
    const h = (this.adtclient as any).h;
    const post = (path: string, qs: Record<string, string>, body: string, contentType: string): Promise<any> =>
      this.withSession(() =>
        h.request(RIS_BASE + path, {
          method: 'POST', qs,
          headers: { 'Content-Type': contentType, Accept: 'application/xml' },
          body
        })
      );
    const bodyOf = (r: any): string => String(r?.body ?? r?.data ?? '');

    // 1. What are we looking for?
    const upType = String(args.type).toUpperCase();
    let target: RisObject;
    if (upType === 'CLAS/OM') {
      const [cls, meth] = args.method ? [args.name, args.method] : String(args.name).split('::');
      target = { trobjtype: 'CLAS', subtype: '', legacyType: 'OM', objectName: String(meth).toUpperCase(), enclObjectName: String(cls).toUpperCase(), fullName: '' };
    } else if (DDIC_PAYLOAD[upType]) {
      const [tro, legacy] = DDIC_PAYLOAD[upType];
      target = { trobjtype: tro, subtype: '', legacyType: legacy, objectName: String(args.name).toUpperCase(), enclObjectName: '', fullName: '' };
    } else {
      let objectUrl: string;
      let sourceUrl: string;
      if (NESTED_TYPES.has(upType)) {
        ({ objectUrl, sourceUrl } = await this.resolveNestedUrl(args.name, upType, args.fugr));
      } else {
        objectUrl = buildObjectUrl(args.name, args.type);
        sourceUrl = buildSourceUrl(args.name, args.type);
      }
      let uri = objectUrl;
      let body = 'x';
      if (args.line) {
        // Symbol at a cursor position: SAP resolves it from the source we send along.
        body = await this.withSession(() => this.adtclient.getObjectSource(sourceUrl));
        uri = `${sourceUrl}#start=${args.line},${args.column ?? 0}`;
      }
      const mapped = parseRisMapping(bodyOf(
        await post('fullnamemapping', { RIS_REQUEST_TYPE: 'MAP_URI_TO_RIS_REQUEST', uri }, body, 'text/plain')
      ));
      if (!mapped) {
        this.fail(`abap_where_used(${args.name}): SAP could not resolve ${uri} to a repository object. ` +
          'Check name and type; for a symbol check line/column (1-based line, column of the symbol start).');
      }
      target = mapped!;
    }

    // 2. One search per kind of using object.
    const kinds = DDIC_PAYLOAD[`${target.trobjtype}/${target.legacyType}`]
      ? [...DEFAULT_USED_IN, ...DDIC_USED_IN]
      : DEFAULT_USED_IN;
    await this.notify(`Where-used for ${target.enclObjectName ? target.enclObjectName + '=>' : ''}${target.objectName} (legacy service)…`);
    const all: LegacyUsage[] = [];
    const skipped: string[] = [];
    for (const kind of kinds) {
      try {
        const xml = bodyOf(await post('whereused', { RIS_REQUEST_TYPE: 'WHERE_USED_LAZY' }, buildRisRequest(kind, target), 'application/xml'));
        all.push(...parseRisResults(xml));
      } catch (e: any) {
        skipped.push(`${kind.join('/')}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
    if (skipped.length === kinds.length) {
      this.fail(`abap_where_used(${args.name}): every search failed — ${skipped.join('; ')}`);
    }

    const usages = realUsages(all);
    const max = Number(args.max_results) > 0 ? Number(args.max_results) : 200;
    const shown = usages.slice(0, max);

    // 3. Optional source lines.
    const SNIPPET_LIMIT = 20;
    const snippetsFor = new Map<LegacyUsage, any[]>();
    if (args.snippets) {
      for (const u of shown.slice(0, SNIPPET_LIMIT)) {
        try {
          const xml = bodyOf(await post('whereused', { RIS_REQUEST_TYPE: 'CODE_LINES' }, `<?xml version="1.0" encoding="utf-8"?>${u.raw}`, 'application/xml'));
          snippetsFor.set(u, parseRisCodeLines(xml).map(l => ({ line: l.line, column: l.columnStart, source: l.source })));
        } catch (_) { /* snippets are best effort */ }
      }
    }

    return this.success({
      name: args.name,
      type: args.type,
      mode: 'legacy',
      searchedFor: {
        type: `${target.trobjtype}/${target.legacyType}`,
        name: target.objectName,
        ...(target.enclObjectName ? { parent: target.enclObjectName } : {})
      },
      searchedIn: kinds.map(k => k.join('/')),
      ...(skipped.length ? { skipped } : {}),
      referenceCount: usages.length,
      ...(usages.length > shown.length ? { truncated: true, returned: shown.length } : {}),
      references: shown.map(u => ({
        name: u.name,
        type: u.type,
        ...(u.parent ? { parent: u.parent } : {}),
        ...(u.description && u.description !== u.name ? { description: u.description } : {}),
        uri: u.uri,
        ...(u.line ? { line: u.line } : {}),
        ...(u.include && u.include !== u.name ? { include: u.include } : {}),
        ...(snippetsFor.has(u) ? { snippets: snippetsFor.get(u) } : {})
      })),
      ...(args.snippets && shown.length > SNIPPET_LIMIT ? { snippetNote: `Snippets fetched for the first ${SNIPPET_LIMIT} references only.` } : {})
    });
  }

  /**
   * ATC for releases without the variant-lookup endpoint (see lib/atcLegacy.ts):
   * post the run directly and read the verdicts from the response body.
   */
  private async runLegacyAtc(name: string, variant: string, objectUrl: string): Promise<any> {
    await this.notify(`Running ATC on ${name} (variant: ${variant}, legacy mode)…`);
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<atc:run maximumVerdicts="200" xmlns:atc="http://www.sap.com/adt/atc">` +
      `<objectSets xmlns:adtcore="http://www.sap.com/adt/core"><objectSet kind="inclusive">` +
      `<adtcore:objectReferences><adtcore:objectReference adtcore:uri="${objectUrl}"/></adtcore:objectReferences>` +
      `</objectSet></objectSets></atc:run>`;
    const response: any = await this.withSession(() => {
      const h = (this.adtclient as any).h;
      return h.request(`/sap/bc/adt/atc/runs?worklistId=${encodeURIComponent(variant)}`, {
        method: 'POST',
        headers: { Accept: 'application/xml', 'Content-Type': 'application/xml' },
        body
      });
    });
    const xml = String(response?.body ?? response?.data ?? '');
    if (!isLegacyAtcResult(xml)) {
      this.fail(
        `abap_atc_run(${name}): variant lookup returned 404 and the direct run did not return verdicts. ` +
        `Response starts with: ${xml.slice(0, 200) || '(empty)'}`
      );
    }
    const parsed = parseLegacyAtcResult(xml);
    const grouped: { error: any[]; warning: any[]; info: any[] } = { error: [], warning: [], info: [] };
    for (const f of parsed.findings) {
      if (f.priority === 1) grouped.error.push(f);
      else if (f.priority === 2) grouped.warning.push(f);
      else grouped.info.push(f);
    }
    return this.success({
      name,
      mode: 'legacy',
      variant,
      variantNote: 'Variant lookup is not available on this release; the variant name was passed to the run as-is and could not be verified.',
      checkedObjectUrl: objectUrl,
      runId: parsed.runId,
      summary: { error: grouped.error.length, warning: grouped.warning.length, info: grouped.info.length },
      findings: grouped,
      totalFindings: parsed.findings.length,
      truncated: parsed.findings.length >= 200
    });
  }

  private async handleAtcVariants(args: any): Promise<any> {
    try {
      // Get system-level ATC customizing (properties + exemption kinds)
      const customizing = await this.withSession(() =>
        this.adtclient.atcCustomizing()
      );

      // Probe DEFAULT worklist ID
      const defaultWorklistId = await this.withSession(() =>
        this.adtclient.atcCheckVariant('DEFAULT')
      ).catch(() => null);

      // Optionally probe a specific variant for fallback detection
      let probeResult: Record<string, any> | undefined;
      if (args.probe_variant && args.probe_variant !== 'DEFAULT') {
        try {
          const probeWorklistId = await this.withSession(() =>
            this.adtclient.atcCheckVariant(args.probe_variant)
          );
          const fellBack = probeWorklistId === defaultWorklistId;
          probeResult = {
            variant: args.probe_variant,
            worklistId: probeWorklistId,
            defaultWorklistId,
            fellBackToDefault: fellBack,
            diagnosis: fellBack
              ? `"${args.probe_variant}" does NOT exist in SATC — SAP returned the same worklistId as DEFAULT. Check SATC for the exact variant name (case-sensitive).`
              : `"${args.probe_variant}" is a valid variant — it returned a different worklistId than DEFAULT.`
          };
        } catch (e: any) {
          probeResult = { variant: args.probe_variant, error: e.message };
        }
      }

      return this.success({
        note: 'Variant names are configured in SATC transaction and cannot be listed via API. Use probe_variant to test if a specific name exists.',
        defaultWorklistId,
        systemProperties: customizing.properties,
        exemptionKinds: customizing.excemptions,
        ...(probeResult ? { probeResult } : {})
      });
    } catch (error: any) {
      this.fail(formatError('abap_atc_variants', error));
    }
  }

  private async handleFindDefinition(args: any): Promise<any> {
    try {
      const sourceUrl = buildSourceUrl(args.name, args.type);
      const source = await this.withSession(() =>
        this.adtclient.getObjectSource(sourceUrl)
      ) as string;

      const startCol = args.column;
      const endCol = args.end_column ?? args.column + 1;
      const implementation = args.implementation ?? false;

      const location = await this.withSession(() =>
        this.adtclient.findDefinition(sourceUrl, source, args.line, startCol, endCol, implementation)
      );

      return this.success({
        name: args.name,
        type: args.type,
        definition: {
          uri: location.url,
          line: location.line,
          column: location.column
        }
      });
    } catch (error: any) {
      this.fail(formatError(`abap_find_definition(${args.name})`, error));
    }
  }

  private async handleFixProposals(args: any): Promise<any> {
    try {
      const sourceUrl = buildSourceUrl(args.name, args.type);
      const source = await this.withSession(() =>
        this.adtclient.getObjectSource(sourceUrl)
      ) as string;

      const proposals = await this.withSession(() =>
        this.adtclient.fixProposals(sourceUrl, source, args.line, args.column)
      );

      if (!proposals || proposals.length === 0) {
        return this.success({ name: args.name, proposals: [], note: 'No quick-fix proposals available at this position.' });
      }

      // For each proposal, fetch the actual edits so Claude can apply them directly
      const withEdits = await Promise.all(proposals.map(async (p: any) => {
        try {
          const deltas = await this.withSession(() =>
            this.adtclient.fixEdits(p, source)
          );
          return {
            description: p['adtcore:description'] || p['adtcore:name'],
            uri: p['adtcore:uri'],
            changes: deltas.map((d: any) => ({
              uri: d.uri,
              range: d.range,
              newContent: d.content
            }))
          };
        } catch {
          return {
            description: p['adtcore:description'] || p['adtcore:name'],
            uri: p['adtcore:uri'],
            changes: []
          };
        }
      }));

      return this.success({ name: args.name, proposalCount: withEdits.length, proposals: withEdits });
    } catch (error: any) {
      this.fail(formatError(`abap_fix_proposals(${args.name})`, error));
    }
  }
}
