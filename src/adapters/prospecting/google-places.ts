import { z } from 'zod';
import { DomainError } from '../../core/errors.js';
import type { Place, PlaceQuery, PlaceSource } from '../../core/ports/places.js';

const BASE_URL = 'https://places.googleapis.com/v1';
const PAGE_SIZE = 20;
// Text Search stops after 3 pages, 60 places.
const MAX_RESULTS = 60;

// Phone and website put the request in the Enterprise tier of Places API (New). Ask for nothing beyond what a lead needs.
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.formattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'nextPageToken',
].join(',');

const response = z.object({
  places: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.object({ text: z.string() }).nullish(),
        internationalPhoneNumber: z.string().nullish(),
        websiteUri: z.string().nullish(),
        formattedAddress: z.string().nullish(),
        rating: z.number().nullish(),
        userRatingCount: z.number().nullish(),
        businessStatus: z.string().nullish(),
      }),
    )
    .optional(),
  nextPageToken: z.string().nullish(),
});

export type GooglePlacesOptions = { apiKey: string; fetch?: typeof fetch; baseUrl?: string };

export class GooglePlacesClient implements PlaceSource {
  readonly name = 'google places';
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: GooglePlacesOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? BASE_URL;
  }

  async search(query: PlaceQuery): Promise<Place[]> {
    const wanted = Math.min(query.limit, MAX_RESULTS);
    const places: Place[] = [];
    let pageToken: string | undefined;
    do {
      const body = {
        textQuery: query.text,
        languageCode: 'pt-BR',
        regionCode: 'BR',
        pageSize: Math.min(PAGE_SIZE, wanted - places.length),
        ...(pageToken ? { pageToken } : {}),
      };
      const page = await this.request(body);
      for (const item of page.places ?? []) {
        // Closed businesses are noise: nobody answers the phone.
        if (item.businessStatus && item.businessStatus !== 'OPERATIONAL') continue;
        places.push({
          placeId: item.id,
          name: item.displayName?.text.trim() || item.id,
          phone: item.internationalPhoneNumber ?? undefined,
          website: item.websiteUri ?? undefined,
          address: item.formattedAddress ?? undefined,
          rating: item.rating ?? undefined,
          reviewCount: item.userRatingCount ?? undefined,
        });
      }
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken && places.length < wanted);
    return places.slice(0, wanted);
  }

  private async request(body: unknown): Promise<z.infer<typeof response>> {
    const res = await this.fetchImpl(`${this.baseUrl}/places:searchText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await providerError(res);
    const parsed = response.safeParse(await res.json());
    if (!parsed.success) throw new DomainError('provider_error', `Resposta inesperada do Google Places: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
    return parsed.data;
  }
}

const providerError = async (res: Response): Promise<DomainError> => {
  const detail = await res.text().catch(() => '');
  const message = (() => {
    try {
      return (JSON.parse(detail) as { error?: { message?: string } }).error?.message;
    } catch {
      return undefined;
    }
  })();
  if (res.status === 400 && message?.toLowerCase().includes('api key')) return new DomainError('provider_error', 'Google Places recusou a chave de API. Confira GOOGLE_PLACES_API_KEY.');
  if (res.status === 403) return new DomainError('provider_error', `Google Places negou o acesso (403): ${(message ?? 'confira se a Places API (New) está ativada e se o faturamento está ligado').slice(0, 200)}`);
  if (res.status === 429) return new DomainError('provider_error', 'Google Places: cota atingida (429). Tente mais tarde.');
  return new DomainError('provider_error', `Google Places respondeu ${res.status}: ${(message ?? detail).slice(0, 200)}`);
};
