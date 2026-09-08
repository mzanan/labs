export function chunkMarkdown(text: string, maxChars = 4000): string[] {
  maxChars = maxChars || 4000;
  if (text.length <= maxChars) return [text];
  const sections = text.split(/(?=^#{1,3} )/m);
  const chunks: string[] = [];
  let current = "";
  for (const section of sections) {
    if (current && current.length + section.length > maxChars) {
      chunks.push(current);
      current = "";
    }
    current += section;
    while (current.length > maxChars) {
      chunks.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}
