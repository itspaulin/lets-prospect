export type RawPage = { url: string; html: string };

// No pages means "could not read it", never "has nothing"; problem says why.
export type RawSiteRead = { pages: RawPage[]; problem?: string };

export interface PageFetcher {
  // Home page plus up to maxPages - 1 same-site pages whose path matches linkPattern, as raw HTML.
  fetchRaw(domain: string, options: { linkPattern: RegExp; maxPages: number }): Promise<RawSiteRead>;
}
