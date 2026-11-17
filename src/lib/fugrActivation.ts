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
import { buildObjectUrl, buildFunctionModuleUrl, buildFunctionIncludeUrl } from './urlBuilder.js';

export interface ActivationRef {
  uri: string;
  name: string;
}

export interface FunctionGroupTarget {
  /** Function group name as given by the caller. */
  group: string;
  groupUrl: string;
  /** The function module or include the caller asked for; undefined when the group itself was named. */
  requested?: ActivationRef;
}

/** FUGR, FUGR/F, FUGR/FF and FUGR/I — the types that are activated through their function group. */
export function isFunctionGroupType(type: string): boolean {
  const t = String(type || '').toUpperCase();
  return t === 'FUGR' || t === 'FUGR/F' || t === 'FUGR/FF' || t === 'FUGR/I';
}

/**
 * Resolve name/type/fugr of an activation request to the function group and the requested object.
 * Throws when a function module or include is given without its function group.
 */
export function resolveFunctionGroupTarget(name: string, type: string, fugr?: string): FunctionGroupTarget {
  const t = String(type || '').toUpperCase();
  const nested = t === 'FUGR/FF' || t === 'FUGR/I';
  if (nested && !fugr) {
    throw new Error(
      `type ${t} requires the fugr parameter (parent function group name). ` +
      `Example: fugr="/DSN/010BWE" to activate function group /DSN/010BWE.`
    );
  }
  const group = String(nested ? fugr : name);
  const groupUrl = buildObjectUrl(group, 'FUGR/F');
  const requested: ActivationRef | undefined =
    t === 'FUGR/FF' ? { uri: buildFunctionModuleUrl(group, name), name: String(name).toUpperCase() } :
    t === 'FUGR/I'  ? { uri: buildFunctionIncludeUrl(group, name), name: String(name).toUpperCase() } :
    undefined;
  return { group, groupUrl, requested };
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
