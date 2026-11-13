import {
  buildRisRequest, parseRisMapping, parseRisResults, parseRisCodeLines, realUsages, tagValue, DDIC_PAYLOAD
} from '../../lib/whereUsedLegacy';

const MAPPING =
  '<?xml version="1.0" encoding="utf-8"?><ris_data_request><trobjtype>CLAS</trobjtype><subtype/><legacy_type>OM</legacy_type>' +
  '<object_name>DISPLAY_ALV</object_name><encl_object_name>ZCL_DEMO_ALV</encl_object_name><scope_trobjtype/><scope_subtype/>' +
  '<scope_legacy_type/><scope_object_name/><scope_encl_object_name/><full_name>\\TY:ZCL_DEMO_ALV\\ME:DISPLAY_ALV</full_name>' +
  '<suppress_selection_dialog>X</suppress_selection_dialog></ris_data_request>';

const result = (name: string, parent: string, uri: string, include: string) =>
  `<ris_where_used_result><object_type><trobjtype>CLAS</trobjtype><subtype/><legacy_type>OC</legacy_type></object_type>` +
  `<object_name>${name}</object_name>${parent ? `<encl_object_name>${parent}</encl_object_name>` : '<encl_object_name/>'}` +
  `<description>Text &amp; more</description><uri>${uri}</uri><object_descriptor><control_data><text/><ob_type>OM</ob_type></control_data>` +
  `<list_data>${include ? `<object>${include}</object>` : '<object/>'}<encl_objec/><object_row>000000</object_row></list_data>` +
  `</object_descriptor></ris_where_used_result>`;

const RESULTS =
  '<?xml version="1.0" encoding="utf-8"?><ris_where_used_results>' +
  result('ZCL_DEMO', '', '/sap/bc/adt/oo/classes/zcl_demo', '') +
  result('RUN', 'ZCL_DEMO', '/sap/bc/adt/oo/classes/zcl_demo/source/main#start=227,0', 'ZCL_DEMO======================CM003') +
  '</ris_where_used_results>';

describe('whereUsedLegacy', () => {
  it('reads the object a uri was mapped to', () => {
    expect(parseRisMapping(MAPPING)).toEqual({
      trobjtype: 'CLAS', subtype: '', legacyType: 'OM', objectName: 'DISPLAY_ALV',
      enclObjectName: 'ZCL_DEMO_ALV', fullName: '\\TY:ZCL_DEMO_ALV\\ME:DISPLAY_ALV'
    });
    expect(parseRisMapping('')).toBeNull();
    expect(parseRisMapping('<ris_data_request><trobjtype/><object_name/></ris_data_request>')).toBeNull();
  });

  it('puts the using kind in object_type and the target in payload', () => {
    const xml = buildRisRequest(['PROG', 'P'], {
      trobjtype: 'FUGR', subtype: '', legacyType: 'FF', objectName: 'Z_FM', enclObjectName: 'SAPLZFG', fullName: ''
    });
    expect(xml).toContain('<object_type><trobjtype>PROG</trobjtype><subtype></subtype><legacy_type>P</legacy_type></object_type>');
    expect(xml).toContain('<payload><trobjtype>FUGR</trobjtype><subtype></subtype><legacy_type>FF</legacy_type>' +
      '<object_name>Z_FM</object_name><encl_object_name>SAPLZFG</encl_object_name><full_name></full_name></payload>');
    expect(buildRisRequest(['CLAS', 'OC'], {
      trobjtype: 'CLAS', subtype: '', legacyType: 'OM', objectName: 'A&B<', enclObjectName: '', fullName: ''
    })).toContain('<object_name>A&amp;B&lt;</object_name>');
  });

  it('parses usages, separating grouping rows from real hits', () => {
    const all = parseRisResults(RESULTS);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ name: 'ZCL_DEMO', isContainer: true, uri: '/sap/bc/adt/oo/classes/zcl_demo' });
    expect(all[0].line).toBeUndefined();
    expect(all[1]).toMatchObject({
      name: 'RUN', type: 'CLAS/OC', parent: 'ZCL_DEMO', description: 'Text & more',
      uri: '/sap/bc/adt/oo/classes/zcl_demo/source/main', line: 227,
      include: 'ZCL_DEMO======================CM003', isContainer: false
    });
    expect(all[1].raw.startsWith('<ris_where_used_result>')).toBe(true);
    expect(parseRisResults('')).toEqual([]);
  });

  it('drops grouping rows and duplicates', () => {
    const all = parseRisResults(RESULTS);
    expect(realUsages([...all, ...all]).map(u => u.name)).toEqual(['RUN']);
  });

  it('parses code lines with columns and strips the leading colon', () => {
    const xml =
      '<ris_source_code_results><ris_source_code_result><ris_result_line_ids><ris_result_line_id>' +
      '<ris_result_line_ident>233 </ris_result_line_ident><ris_result_column_start>30</ris_result_column_start>' +
      '<ris_result_column_end>44</ris_result_column_end></ris_result_line_id></ris_result_line_ids><ris_result_source_lines>' +
      '<ris_result_source_line><ris_source_line_ident>233 </ris_source_line_ident>' +
      '<ris_source_line>:    DATA(lv_ok) = lo_display-&gt;display_alv( ).</ris_source_line>' +
      '<uri>/sap/bc/adt/oo/classes/zcl_demo/source/main#start=233,0</uri></ris_result_source_line>' +
      '</ris_result_source_lines></ris_source_code_result></ris_source_code_results>';
    expect(parseRisCodeLines(xml)).toEqual([{
      line: 233, columnStart: 30, columnEnd: 44,
      source: '    DATA(lv_ok) = lo_display->display_alv( ).',
      uri: '/sap/bc/adt/oo/classes/zcl_demo/source/main'
    }]);
    expect(parseRisCodeLines('<ris_source_code_results/>')).toEqual([]);
  });

  it('decodes url-encoded angle brackets and knows the dictionary kinds', () => {
    expect(tagValue('<a>X-%3EY</a>', 'a')).toBe('X->Y');
    expect(tagValue('<a/>', 'a')).toBe('');
    expect(DDIC_PAYLOAD.TABL).toEqual(['TABL', 'DT']);
    expect(DDIC_PAYLOAD.STRU).toEqual(['TABL', 'DS']);
  });
});
