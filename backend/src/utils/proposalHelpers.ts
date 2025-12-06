/**
 * Proposal Helper Utilities
 */

/**
 * Normalize proposal signers from various formats to a string array
 */
export function normalizeProposalSigners(value: any): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((s) => (typeof s === 'string' ? s : s?.toString()))
      .filter((s) => s && s.length > 0);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((s) => (typeof s === 'string' ? s : s?.toString()))
          .filter((s) => s && s.length > 0);
      }
    } catch {
      // Not JSON, treat as single string
      return value.length > 0 ? [value] : [];
    }
  }

  return [];
}

