import type { ResumeJSON, ResumeChange } from "../types/studio.types";

/**
 * Apply a list of changes to a resume JSON object (immutable — returns new object)
 */
export function applyChanges(json: ResumeJSON, changes: ResumeChange[]): ResumeJSON {
  const result = structuredClone(json);
  for (const change of changes) {
    try {
      setNestedValue(result, change.path, change.new);
    } catch (e) {
      console.warn(`[jsonPatch] Failed to apply change at ${change.path}:`, e);
    }
  }
  return result;
}

/**
 * Parse a path like "experience[0].bullets[1]" and set a value
 */
function setNestedValue(obj: any, path: string, value: any): void {
  const parts = path.match(/([^[\].]+)|\[(\d+)\]/g);
  if (!parts || parts.length === 0) return;

  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i].replace(/[\[\]]/g, "");
    const idx = parseInt(part);
    current = isNaN(idx) ? current[part] : current[idx];
    if (current === undefined || current === null) return;
  }

  const lastPart = parts[parts.length - 1].replace(/[\[\]]/g, "");
  const lastIdx = parseInt(lastPart);
  if (isNaN(lastIdx)) {
    current[lastPart] = value;
  } else {
    current[lastIdx] = value;
  }
}

/**
 * Get a value from a nested path
 */
export function getNestedValue(obj: any, path: string): any {
  const parts = path.match(/([^[\].]+)|\[(\d+)\]/g);
  if (!parts) return undefined;

  let current = obj;
  for (const part of parts) {
    const clean = part.replace(/[\[\]]/g, "");
    const idx = parseInt(clean);
    current = isNaN(idx) ? current?.[clean] : current?.[idx];
    if (current === undefined) return undefined;
  }
  return current;
}

/**
 * Compute a human-readable diff summary from changes
 */
export function summarizeChanges(changes: ResumeChange[]): string {
  if (changes.length === 0) return "No changes";
  if (changes.length === 1) {
    const section = changes[0].path.split("[")[0];
    return `Updated ${section}`;
  }
  const sections = [...new Set(changes.map((c) => c.path.split("[")[0]))];
  return `Updated ${sections.join(", ")}`;
}
