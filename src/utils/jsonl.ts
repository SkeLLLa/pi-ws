import { StringDecoder } from 'node:string_decoder';

export class JsonlSplitter {
  #buffer = '';
  #decoder = new StringDecoder('utf8');

  push(chunk: Buffer): string[] {
    this.#buffer += this.#decoder.write(chunk);

    const lines: string[] = [];
    let newlineIndex = this.#buffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const line = this.#buffer.slice(0, newlineIndex);
      lines.push(line.endsWith('\r') ? line.slice(0, -1) : line);
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      newlineIndex = this.#buffer.indexOf('\n');
    }

    return lines;
  }
}

export function parseJsonObject(input: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(input);

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object');
  }

  return parsed as Record<string, unknown>;
}
