/**
 * Activation of function groups on older SAP releases (SAP_BASIS 7.40).
 *
 * There an activation reference activates exactly the object it points to:
 *   - the group URL            -> only the main program SAPL<group>
 *   - .../fmodules/<fm>        -> only that function module
 *   - .../includes/<include>   -> only that include
 * Sending the group URL alone therefore answers 200 and leaves function modules and includes inactive.
 * Objects that depend on each other (a function module calling a FORM of a new include) only activate
 * when they are sent in ONE request. So the request must list the group plus everything inactive in it.
 */

import type { InactiveObjectRef } from './inactiveLegacy.js';

export interface ActivationRef {
  uri: string;
  name: string;
}

function normalizeUri(uri: string): string {
  let u = (uri || '').split('#')[0].split('?')[0];
  try { u = decodeURIComponent(u); } catch (_) { /* keep as is */ }
  return u.toLowerCase().replace(/\/+$/, '');
}

/** Inactive objects that belong to the function group: the group itself, its main program, function modules and includes. */
export function inactiveInFunctionGroup(groupUrl: string, inactive: InactiveObjectRef[]): InactiveObjectRef[] {
  const base = normalizeUri(groupUrl);
  return (inactive || []).filter(o => {
    const u = normalizeUri(o.uri);
    return u === base || u.startsWith(`${base}/`);
  });
}

/**
 * References for one activation request: the group first, then the object the caller asked for,
 * then every other inactive object of the group. The group's own entries (container and
 * .../source/main, i.e. the main program) are covered by the group reference and are not repeated.
 */
export function buildFunctionGroupActivationRefs(
  groupUrl: string,
  groupName: string,
  inactive: InactiveObjectRef[],
  requested?: ActivationRef
): ActivationRef[] {
  const base = normalizeUri(groupUrl);
  const refs: ActivationRef[] = [{ uri: groupUrl, name: groupName.toUpperCase() }];
  const seen = new Set<string>([base, `${base}/source/main`]);
  const add = (uri: string, name: string) => {
    const key = normalizeUri(uri);
    if (!uri || seen.has(key)) return;
    seen.add(key);
    refs.push({ uri, name: (name || '').toUpperCase() });
  };
  if (requested) add(requested.uri, requested.name);
  for (const o of inactiveInFunctionGroup(groupUrl, inactive)) add(o.uri, o.name);
  return refs;
}
