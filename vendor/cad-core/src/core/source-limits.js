// Shared limits for editable source snapshots in browser and editor hosts.
export const SOURCE_LIMITS = Object.freeze({ files: 1024, fileBytes: 1024 * 1024, projectBytes: 16 * 1024 * 1024 });
export function checkSourceBudget(files, bytes) {
  if (files > SOURCE_LIMITS.files || bytes > SOURCE_LIMITS.projectBytes)
    throw Error('Project exceeds source limits (1024 source files / 16 MiB)');
}
