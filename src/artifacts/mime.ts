const MIME_TYPES = new Map<string, string>([
  ['.csv', 'text/csv'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.json', 'application/json'],
  ['.md', 'text/markdown'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain'],
  ['.webp', 'image/webp'],
]);

export function detectMimeType(path: string): string {
  const normalized = path.toLowerCase();

  for (const [extension, mimeType] of MIME_TYPES) {
    if (normalized.endsWith(extension)) {
      return mimeType;
    }
  }

  return 'application/octet-stream';
}
