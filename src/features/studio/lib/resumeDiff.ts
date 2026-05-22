import type { ResumeChange } from "../types/studio.types";

/**
 * Extract the section name from a change path for highlighting
 * e.g., "experience[0].bullets[1]" → "experience"
 */
export function getSectionFromPath(path: string): string {
  return path.split("[")[0].split(".")[0];
}

/**
 * Get a unique key for the changed element (for animation targeting)
 * e.g., "experience[0].bullets[1]" → "experience-0-bullets-1"
 */
export function getChangeKey(path: string): string {
  return path.replace(/[\[\].]/g, "-").replace(/-+/g, "-").replace(/-$/, "");
}

/**
 * Determine which sections have been changed
 */
export function getChangedSections(changes: ResumeChange[]): Set<string> {
  return new Set(changes.map(getSectionFromPath));
}

/**
 * Create a map of path → change for quick lookup during rendering
 */
export function createChangeMap(changes: ResumeChange[]): Map<string, ResumeChange> {
  const map = new Map<string, ResumeChange>();
  for (const change of changes) {
    map.set(change.path, change);
  }
  return map;
}
