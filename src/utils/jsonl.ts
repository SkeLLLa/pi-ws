import { StringDecoder } from 'node:string_decoder';

export class JsonlSplitter {
  #buffer = '';
  #decoder = new StringDecoder('utf8');
  readonly #maxLineBytes: number;

  constructor({ maxLineBytes = 1024 * 1024 }: { maxLineBytes?: number } = {}) {
    this.#maxLineBytes = maxLineBytes;
  }

  push(chunk: Buffer): string[] {
    this.#buffer += this.#decoder.write(chunk);
    this.#assertWithinLimit();

    const lines: string[] = [];
    let newlineIndex = this.#buffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const line = this.#buffer.slice(0, newlineIndex);
      lines.push(line.endsWith('\r') ? line.slice(0, -1) : line);
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      this.#assertWithinLimit();
      newlineIndex = this.#buffer.indexOf('\n');
    }

    return lines;
  }

  flush(): string[] {
    this.#buffer += this.#decoder.end();
    this.#assertWithinLimit();

    if (this.#buffer === '') {
      return [];
    }

    const line = this.#buffer;
    this.#buffer = '';
    return [line.endsWith('\r') ? line.slice(0, -1) : line];
  }

  #assertWithinLimit(): void {
    if (Buffer.byteLength(this.#buffer, 'utf8') > this.#maxLineBytes) {
      this.#buffer = '';
      throw new Error(
        `JSONL line exceeds max size of ${String(this.#maxLineBytes)} bytes`,
      );
    }
  }
}

export function parseJsonObject(input: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(input);

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object');
  }

  return parsed as Record<string, unknown>;
}
