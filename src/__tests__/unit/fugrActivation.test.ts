import {
  buildFunctionGroupActivationRefs,
  inactiveInFunctionGroup,
  isFunctionGroupType,
  resolveFunctionGroupTarget
} from '../../lib/fugrActivation';

const GROUP_URL = '/sap/bc/adt/functions/groups/zdemo_fg';

const INACTIVE = [
  { name: 'ZDEMO_FG', type: 'FUGR/F', uri: '/sap/bc/adt/functions/groups/zdemo_fg' },
  { name: 'Z_DEMO_FM', type: 'FUGR/FF', uri: '/sap/bc/adt/functions/groups/zdemo_fg/fmodules/z_demo_fm' },
  { name: 'LZDEMO_FGF01', type: 'FUGR/I', uri: '/sap/bc/adt/functions/groups/zdemo_fg/includes/lzdemo_fgf01' },
  { name: 'SAPLZDEMO_FG', type: 'FUGR/I', uri: '/sap/bc/adt/functions/groups/zdemo_fg/source/main' },
  { name: 'Z_OTHER_FM', type: 'FUGR/FF', uri: '/sap/bc/adt/functions/groups/zdemo_fg2/fmodules/z_other_fm' },
  { name: 'ZCL_DEMO', type: 'CLAS/OC', uri: '/sap/bc/adt/oo/classes/zcl_demo' }
];

describe('fugrActivation', () => {
  it('picks only the objects of the group', () => {
    expect(inactiveInFunctionGroup(GROUP_URL, INACTIVE).map(o => o.name)).toEqual([
      'ZDEMO_FG', 'Z_DEMO_FM', 'LZDEMO_FGF01', 'SAPLZDEMO_FG'
    ]);
    expect(inactiveInFunctionGroup(GROUP_URL, [])).toEqual([]);
  });

  it('does not take a group whose name only starts the same', () => {
    expect(inactiveInFunctionGroup('/sap/bc/adt/functions/groups/zdemo', INACTIVE)).toEqual([]);
  });

  it('lists the group, then the requested object, then the rest, without the main program twice', () => {
    const refs = buildFunctionGroupActivationRefs(GROUP_URL, 'zdemo_fg', INACTIVE, {
      uri: '/sap/bc/adt/functions/groups/zdemo_fg/includes/lzdemo_fgf01',
      name: 'lzdemo_fgf01'
    });
    expect(refs).toEqual([
      { uri: GROUP_URL, name: 'ZDEMO_FG' },
      { uri: '/sap/bc/adt/functions/groups/zdemo_fg/includes/lzdemo_fgf01', name: 'LZDEMO_FGF01' },
      { uri: '/sap/bc/adt/functions/groups/zdemo_fg/fmodules/z_demo_fm', name: 'Z_DEMO_FM' }
    ]);
  });

  it('keeps the requested object when the inactive list is empty or unavailable', () => {
    expect(buildFunctionGroupActivationRefs(GROUP_URL, 'ZDEMO_FG', [], {
      uri: '/sap/bc/adt/functions/groups/zdemo_fg/fmodules/z_demo_fm',
      name: 'Z_DEMO_FM'
    })).toEqual([
      { uri: GROUP_URL, name: 'ZDEMO_FG' },
      { uri: '/sap/bc/adt/functions/groups/zdemo_fg/fmodules/z_demo_fm', name: 'Z_DEMO_FM' }
    ]);
    expect(buildFunctionGroupActivationRefs(GROUP_URL, 'ZDEMO_FG', [])).toEqual([{ uri: GROUP_URL, name: 'ZDEMO_FG' }]);
  });

  it('recognises the types that are activated through their group', () => {
    expect(['FUGR', 'fugr/f', 'FUGR/FF', 'FUGR/I'].map(isFunctionGroupType)).toEqual([true, true, true, true]);
    expect(['CLAS', 'PROG/I', 'PROG/P', ''].map(isFunctionGroupType)).toEqual([false, false, false, false]);
  });

  it('resolves a group, a function module and an include to the group and the requested object', () => {
    expect(resolveFunctionGroupTarget('ZDEMO_FG', 'FUGR')).toEqual({ group: 'ZDEMO_FG', groupUrl: GROUP_URL, requested: undefined });
    expect(resolveFunctionGroupTarget('z_demo_fm', 'FUGR/FF', 'ZDEMO_FG')).toEqual({
      group: 'ZDEMO_FG',
      groupUrl: GROUP_URL,
      requested: { uri: '/sap/bc/adt/functions/groups/zdemo_fg/fmodules/z_demo_fm', name: 'Z_DEMO_FM' }
    });
    expect(resolveFunctionGroupTarget('LZDEMO_FGF01', 'fugr/i', 'zdemo_fg').requested).toEqual({
      uri: '/sap/bc/adt/functions/groups/zdemo_fg/includes/lzdemo_fgf01',
      name: 'LZDEMO_FGF01'
    });
  });

  it('refuses a function module or include without its group', () => {
    expect(() => resolveFunctionGroupTarget('Z_DEMO_FM', 'FUGR/FF')).toThrow(/requires the fugr parameter/);
    expect(() => resolveFunctionGroupTarget('LZDEMO_FGF01', 'FUGR/I')).toThrow(/requires the fugr parameter/);
  });

  it('matches namespaced groups regardless of URL encoding and case', () => {
    const inactive = [
      { name: '/DSN/FM1', type: 'FUGR/FF', uri: '/sap/bc/adt/functions/groups/%2Fdsn%2Ffg/fmodules/%2Fdsn%2Ffm1' }
    ];
    const refs = buildFunctionGroupActivationRefs('/sap/bc/adt/functions/groups/%2fdsn%2ffg', '/dsn/fg', inactive);
    expect(refs.map(r => r.name)).toEqual(['/DSN/FG', '/DSN/FM1']);
  });
});
