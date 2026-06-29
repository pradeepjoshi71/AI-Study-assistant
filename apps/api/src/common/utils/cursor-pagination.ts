/**
 * Base64 cursor-based pagination helper.
 * Encodes the cursor as: base64(id + ":" + createdAtString)
 */
export function encodeCursor(id: string, createdAt: Date): string {
  const payload = `${id}:${createdAt.toISOString()}`;
  return Buffer.from(payload, "utf-8").toString("base64");
}

/**
 * Decodes a base64 pagination cursor into the last record's id and createdAt.
 */
export function decodeCursor(cursor: string): { id: string; createdAt: Date } | null {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const parts = decoded.split(":");
    if (parts.length < 2) return null;
    const id = parts[0];
    const dateStr = parts.slice(1).join(":"); // Reassemble in case date contains colons
    const createdAt = new Date(dateStr);
    if (isNaN(createdAt.getTime())) return null;
    return { id, createdAt };
  } catch {
    return null;
  }
}
