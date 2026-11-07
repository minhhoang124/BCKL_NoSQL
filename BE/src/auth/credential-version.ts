// Legacy tokens predate cv. Never accept them after the first password change.
export function credentialMatches(claim: unknown, current: number): boolean {
  return claim === undefined
    ? current === 1
    : Number.isSafeInteger(claim) && claim === current;
}
