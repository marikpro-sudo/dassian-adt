import { isFlatInactiveList, parseFlatInactiveList } from '../../lib/inactiveLegacy';

const FLAT =
  '<?xml version="1.0" encoding="utf-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">' +
  '<adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/zcl_demo" adtcore:type="CLAS/OC" adtcore:name="ZCL_DEMO" adtcore:packageName="$TMP"/>' +
  '<adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/programs/zdemo" adtcore:type="PROG/P" adtcore:name="ZDEMO"/>' +
  '</adtcore:objectReferences>';

describe('inactiveLegacy', () => {
  it('detects the flat list', () => {
    expect(isFlatInactiveList(FLAT)).toBe(true);
    expect(isFlatInactiveList('<ioc:inactiveObjects xmlns:ioc="x"><ioc:entry><ioc:object><ioc:ref adtcore:name="A"/></ioc:object></ioc:entry></ioc:inactiveObjects>')).toBe(false);
    expect(isFlatInactiveList('')).toBe(false);
  });

  it('parses name, type, uri and optional package', () => {
    expect(parseFlatInactiveList(FLAT)).toEqual([
      { name: 'ZCL_DEMO', type: 'CLAS/OC', uri: '/sap/bc/adt/oo/classes/zcl_demo', package: '$TMP' },
      { name: 'ZDEMO', type: 'PROG/P', uri: '/sap/bc/adt/programs/programs/zdemo' }
    ]);
  });

  it('returns an empty list for an empty answer', () => {
    expect(parseFlatInactiveList('<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>')).toEqual([]);
    expect(parseFlatInactiveList('')).toEqual([]);
  });
});
