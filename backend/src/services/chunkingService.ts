import crypto from "node:crypto";

export interface TextChunk {
  index: number;
  content: string;
  contentHash: string;
}

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

export const chunkText = (
  input: string,
  maxCharacters = 1200,
  overlapCharacters = 200
): TextChunk[] => {
  if (!Number.isInteger(maxCharacters) || maxCharacters <= 0 ||
      !Number.isInteger(overlapCharacters) || overlapCharacters < 0 ||
      overlapCharacters >= maxCharacters) {
    throw new Error("Invalid chunking limits");
  }

  const text = normalize(input);
  if (!text) return [];
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxCharacters, text.length);
    if (end < text.length) {
      const boundary = Math.max(
        text.lastIndexOf(". ", end),
        text.lastIndexOf(" ", end)
      );
      if (boundary > start + Math.floor(maxCharacters / 2)) end = boundary + 1;
    }
    const content = text.slice(start, end).trim();
    if (content) {
      chunks.push({
        index: chunks.length,
        content,
        contentHash: crypto.createHash("sha256").update(content).digest("hex"),
      });
    }
    if (end >= text.length) break;
    start = Math.max(end - overlapCharacters, start + 1);
  }
  return chunks;
};
