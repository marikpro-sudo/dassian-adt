import { isLegacyAtcResult, parseLegacyAtcResult, atcObjectUrlForNested } from '../../lib/atcLegacy';

const SAMPLE =
  '<?xml version="1.0" encoding="utf-8"?><atc:result verdicts="2" adtcore:uri="/sap/bc/adt/atc/runs/005056A3ED551FE1B7DA1B843FE45CD3" xmlns:atc="http://www.sap.com/adt/atc" xmlns:adtcore="http://www.sap.com/adt/core"><verdicts>' +
  '<verdict adtcore:uri="/sap/bc/adt/atc/runs/005056A3ED551FE1B7DA1B843FE45CD3/verdicts/1" priority="2" checkTitle="SELECT bypassing buffer" messageTitle="Access to &quot;T&quot; cannot use buffer" exemptionType="no">' +
  '<objectAttributes author="DEV" adtcore:uri="/sap/bc/adt/programs/programs/zdisplay_users_3/source/main#start=29,0" adtcore:type="PROG" adtcore:name="ZDISPLAY_USERS_3" adtcore:packageName="ZMSD"/>' +
  '<atom:link href="/sap/bc/adt/documentation/atc/documents/x" rel="http://www.sap.com/adt/relations/documentation" type="text/html" xmlns:atom="http://www.w3.org/2005/Atom"/></verdict>' +
  '<verdict adtcore:uri="/sap/bc/adt/atc/runs/005056A3ED551FE1B7DA1B843FE45CD3/verdicts/2" priority="3" checkTitle="SLIN" messageTitle="No text element" exemptionType="no">' +
  '<objectAttributes author="DEV" adtcore:uri="/sap/bc/adt/programs/programs/zdisplay_users_3/source/main#start=35,0" adtcore:type="PROG" adtcore:name="ZDISPLAY_USERS_3" adtcore:packageName="ZMSD"/></verdict>' +
  '</verdicts></atc:result>';

describe('atcLegacy', () => {
  it('detects the legacy inline-verdict format', () => {
    expect(isLegacyAtcResult(SAMPLE)).toBe(true);
    expect(isLegacyAtcResult('<atc:worklistRun xmlns:atc="x"><atc:worklistId>1</atc:worklistId></atc:worklistRun>')).toBe(false);
    expect(isLegacyAtcResult('')).toBe(false);
  });

  it('parses verdicts with priority, titles and line', () => {
    const r = parseLegacyAtcResult(SAMPLE);
    expect(r.runId).toBe('005056A3ED551FE1B7DA1B843FE45CD3');
    expect(r.findings).toHaveLength(2);
    expect(r.findings[0]).toEqual({
      object: 'ZDISPLAY_USERS_3',
      objectType: 'PROG',
      checkTitle: 'SELECT bypassing buffer',
      messageTitle: 'Access to "T" cannot use buffer',
      priority: 2,
      location: { uri: '/sap/bc/adt/programs/programs/zdisplay_users_3/source/main', line: 29, column: 0 },
      exemptionKind: 'no'
    });
    expect(r.findings[1].priority).toBe(3);
    expect(r.findings[1].location?.line).toBe(35);
  });

  it('returns no findings for a clean run', () => {
    const clean = '<atc:result verdicts="0" adtcore:uri="/sap/bc/adt/atc/runs/ABC" xmlns:atc="a" xmlns:adtcore="b"/>';
    expect(isLegacyAtcResult(clean)).toBe(true);
    expect(parseLegacyAtcResult(clean)).toEqual({ runId: 'ABC', findings: [] });
  });

  it('maps function module / include urls to the group url', () => {
    expect(atcObjectUrlForNested('/sap/bc/adt/functions/groups/zfg/fmodules/z_fm')).toBe('/sap/bc/adt/functions/groups/zfg');
    expect(atcObjectUrlForNested('/sap/bc/adt/functions/groups/zfg/includes/lzfgtop')).toBe('/sap/bc/adt/functions/groups/zfg');
    expect(atcObjectUrlForNested('/sap/bc/adt/functions/groups/zfg')).toBe('/sap/bc/adt/functions/groups/zfg');
  });
});
