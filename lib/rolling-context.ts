export interface RollingContext {
  includeRolling: boolean;
  includeSecondaryCidr: boolean;
  rollingTargetSubnet: 'private1' | 'private2';
}

export function validateRollingContext(ctx: RollingContext): void {
  if (!ctx.includeRolling) return;
  if (!ctx.includeSecondaryCidr) {
    throw new Error('includeRolling=true requires includeSecondaryCidr=true (Rolling stack needs private2 subnets carved)');
  }
}
