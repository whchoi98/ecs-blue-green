import { validateRollingContext } from '../lib/rolling-context';

describe('validateRollingContext', () => {
  it('passes when includeRolling=false (no other constraints checked)', () => {
    expect(() => validateRollingContext({
      includeRolling: false, includeSecondaryCidr: false, rollingTargetSubnet: 'private1',
    })).not.toThrow();
  });

  it('throws when includeRolling=true and includeSecondaryCidr=false', () => {
    expect(() => validateRollingContext({
      includeRolling: true, includeSecondaryCidr: false, rollingTargetSubnet: 'private1',
    })).toThrow(/includeRolling.*requires.*includeSecondaryCidr/i);
  });

  it('passes when includeRolling=true and includeSecondaryCidr=true', () => {
    expect(() => validateRollingContext({
      includeRolling: true, includeSecondaryCidr: true, rollingTargetSubnet: 'private2',
    })).not.toThrow();
  });
});
