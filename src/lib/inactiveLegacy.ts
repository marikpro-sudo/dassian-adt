/**
 * Inactive objects on older SAP releases (SAP_BASIS 7.40).
 *
 * GET /sap/bc/adt/activation/inactiveobjects answers there with a flat
 *   <adtcore:objectReferences><adtcore:objectReference adtcore:uri=… adtcore:type=… adtcore:name=… adtcore:packageName=…/>…
 * instead of the newer <ioc:inactiveObjects><ioc:entry>… envelope, so abap-adt-api reads it as an empty list.
 */

export interface InactiveObjectRef {
  name: string;
  type: string;
  uri: string;
  package?: string;
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`\\badtcore:${name}="([^"]*)"`).exec(tag);
  return m
    ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    : '';
}

/** True when the body is the old flat list rather than the ioc:inactiveObjects envelope. */
export function isFlatInactiveList(xml: string): boolean {
  return /<adtcore:objectReferences\b/.test(xml || '') && !/<ioc:/.test(xml || '');
}

export function parseFlatInactiveList(xml: string): InactiveObjectRef[] {
  const refs = (xml || '').match(/<adtcore:objectReference\b[^>]*>/g) || [];
  return refs
    .map(tag => {
      const pkg = attr(tag, 'packageName');
      return { name: attr(tag, 'name'), type: attr(tag, 'type'), uri: attr(tag, 'uri'), ...(pkg ? { package: pkg } : {}) };
    })
    .filter(r => r.name);
}
