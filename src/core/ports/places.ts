export type PlaceQuery = {
  // Free text as typed in a map search, for example "imobiliária em Belo Horizonte, MG".
  text: string;
  limit: number;
};

export type Place = {
  placeId: string;
  name: string;
  // As the provider returns it, in international format when possible. Normalized by the use case.
  phone?: string;
  website?: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
};

// Paid by request, but cheap: one request returns up to 20 places. Only open businesses come back.
export interface PlaceSource {
  readonly name: string;
  search(query: PlaceQuery): Promise<Place[]>;
}
