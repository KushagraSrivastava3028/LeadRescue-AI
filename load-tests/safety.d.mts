export type LoadStage = { duration: string; seconds: number; target: number; name: string };
export const JOURNEY_STEPS: readonly { name: string; path: string }[];
export function validateTarget(
  input?: string,
  stagingAllowlist?: string,
): { origin: string; kind: 'local' | 'staging' };
export function validateEnvironmentGuard(payload: unknown, targetKind: string): boolean;
export function loadProfile(name?: string): LoadStage[];
export function phaseAt(stages: LoadStage[], elapsedMilliseconds: number): string;
export function summaryLabel(input?: string): string;
