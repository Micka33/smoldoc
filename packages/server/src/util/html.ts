/** Minimal HTML → plain text for doc snippets (no external parser). */
export function htmlToPlainText(html: string, maxChars: number): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > maxChars) s = `${s.slice(0, maxChars)}…`;
  return s;
}
