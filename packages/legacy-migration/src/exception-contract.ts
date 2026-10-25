import { stableJson } from './source-evidence.ts';
import type {
  SourceRebuildException,
  SourceValidationIssue,
} from './source-validation.ts';

export type ExceptionArtifact = {
  schemaVersion: 2;
  blocking: SourceValidationIssue[];
  rebuilds: SourceRebuildException[];
  warnings: Array<Record<string, unknown>>;
};

export function canonicalBlockingIssues(issues: SourceValidationIssue[]) {
  return issues.toSorted((left, right) =>
    stableJson(left).localeCompare(stableJson(right)));
}

/** A checksum-bound exception file cannot omit, downgrade, rename, or add a blocker. */
export function assertCanonicalExceptionArtifact(
  artifact: ExceptionArtifact,
  actualBlocking: SourceValidationIssue[],
  actualRebuilds: SourceRebuildException[],
) {
  if (artifact.schemaVersion !== 2 || !Array.isArray(artifact.blocking) ||
    !Array.isArray(artifact.rebuilds) || !Array.isArray(artifact.warnings))
    throw new Error('Exceptions artifact does not use canonical schema version 2');
  if (stableJson(artifact.blocking) !== stableJson(canonicalBlockingIssues(actualBlocking)))
    throw new Error('Exceptions artifact blocking findings do not exactly match source validation');
  if (artifact.blocking.length)
    throw new Error('Source contains unresolved non-approvable blocking findings');
  if (stableJson(artifact.rebuilds) !== stableJson(actualRebuilds))
    throw new Error('Signed rebuild exceptions do not exactly match source evidence');
}
