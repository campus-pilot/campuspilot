import { describe, expect, it } from 'vitest';

import { decodeRouteParam } from './route-param';

describe('decodeRouteParam', () => {
  it('decodes ids and returns null for a malformed escape', () => {
    expect(decodeRouteParam('stu_1.cls_2.half-yearly')).toBe('stu_1.cls_2.half-yearly');
    expect(decodeRouteParam('a%2Eb')).toBe('a.b');
    expect(decodeRouteParam('%E0')).toBeNull();
  });
});
