import { describe, expect, it } from 'vitest';

import { classGrowthHref, classResultsHref, decodeRouteParam } from './route-param';

describe('decodeRouteParam', () => {
  it('decodes ids and returns null for a malformed escape', () => {
    expect(decodeRouteParam('stu_1.cls_2.half-yearly')).toBe('stu_1.cls_2.half-yearly');
    expect(decodeRouteParam('a%2Eb')).toBe('a.b');
    expect(decodeRouteParam('%E0')).toBeNull();
  });
});

describe('class links', () => {
  it('puts the class record id in the path, escaped', () => {
    expect(classResultsHref('stu_1.cls_2')).toBe('/results/class/stu_1.cls_2');
    expect(classGrowthHref('a/b')).toBe('/growth/class/a%2Fb');
  });
});
