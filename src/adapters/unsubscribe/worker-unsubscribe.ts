import { createHmac } from 'node:crypto';
import type { OptOut, Unsubscribe } from '../../core/ports/unsubscribe.js';
import { hashValue } from '../../core/rules/render.js';

export type WorkerUnsubscribeConfig = { baseUrl: string; secret: string; apiToken: string; timeoutMs?: number; fetchImpl?: typeof fetch };

// Must stay identical to `sign` in worker/descadastro/src/handler.ts.
export const signHash = (secret: string, hash: string): string => createHmac('sha256', secret).update(hash).digest('hex');

export class WorkerUnsubscribe implements Unsubscribe {
  private readonly baseUrl: string;

  constructor(private readonly config: WorkerUnsubscribeConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  url(email: string): string {
    const hash = hashValue(email);
    return `${this.baseUrl}/d?e=${hash}&s=${signHash(this.config.secret, hash)}`;
  }

  async fetchOptOuts(): Promise<OptOut[]> {
    const doFetch = this.config.fetchImpl ?? fetch;
    const items: OptOut[] = [];
    let cursor: string | undefined;
    do {
      const response = await doFetch(`${this.baseUrl}/api/optouts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {
        headers: { authorization: `Bearer ${this.config.apiToken}` },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      });
      if (!response.ok) throw new Error(`serviço de descadastro respondeu ${response.status}`);
      const page = (await response.json()) as { items?: OptOut[]; next?: string | null };
      items.push(...(page.items ?? []));
      cursor = page.next ?? undefined;
    } while (cursor);
    return items;
  }
}
