import { execSync } from 'child_process';

describe('cdk synth (full app)', () => {
  it('synthesizes default context (Blue only) without error', () => {
    const out = execSync('npx cdk synth --quiet 2>&1', { encoding: 'utf-8' });
    expect(out).not.toMatch(/error/i);
  }, 120000);

  it('synthesizes with includeSecondaryCidr=true without error', () => {
    const out = execSync('npx cdk synth --quiet --context includeSecondaryCidr=true 2>&1', { encoding: 'utf-8' });
    expect(out).not.toMatch(/error/i);
  }, 120000);

  it('synthesizes with includeGreen=true (Green TGs added with weight 0) without error', () => {
    const out = execSync('npx cdk synth --quiet --context includeSecondaryCidr=true --context includeGreen=true 2>&1', { encoding: 'utf-8' });
    expect(out).not.toMatch(/error/i);
  }, 120000);
});
