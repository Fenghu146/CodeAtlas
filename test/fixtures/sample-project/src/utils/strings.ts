/** Normalize a display name. */
export function formatName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Truncate a string to a maximum length. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}
