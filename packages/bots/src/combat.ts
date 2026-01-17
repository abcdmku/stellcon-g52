export function estimatedWinProb(attacker: number, defender: number) {
  const a = Math.max(0, attacker);
  const d = Math.max(0, defender);
  if (a <= 0 && d <= 0) return 0.5;
  if (d <= 0) return 1;
  if (a <= 0) return 0;
  const z = (a - d) / Math.sqrt(a + d + 1);
  return 1 / (1 + Math.exp(-z));
}

export function fleetsNeededForProbability(defender: number, desiredProb: number, maxExtra = 80) {
  const d = Math.max(0, defender);
  if (d === 0) return 1;
  const targetProb = Math.max(0.05, Math.min(0.95, desiredProb));
  for (let a = Math.max(1, d); a < d + maxExtra; a += 1) {
    if (estimatedWinProb(a, d) >= targetProb) return a;
  }
  return d + maxExtra;
}
