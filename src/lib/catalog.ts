// Title search and metadata from the frameXTV backend (CORS-open, TMDB-backed).

const API_BASES = ["https://api.framextv.tech", "https://api.framextv.xyz"];
let activeBase = 0;

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < API_BASES.length; attempt++) {
    const base = API_BASES[(activeBase + attempt) % API_BASES.length];
    try {
      const res = await fetch(`${base}${path}`, { signal });
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`The catalog returned HTTP ${res.status}.`);
      activeBase = (activeBase + attempt) % API_BASES.length;
      return (await res.json()) as T;
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("The catalog is unreachable.");
}

const NO_IMAGE = "placeholder.com";
const image = (url?: string) =>
  url && !url.includes(NO_IMAGE) ? url : undefined;

export interface SearchResult {
  id: string;
  type: "movie" | "tv";
  title: string;
  year?: string;
  poster?: string;
  backdrop?: string;
  overview?: string;
}

export async function searchTitles(
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const data = await get<{ results?: Array<Record<string, string>> }>(
    `/api/search?q=${encodeURIComponent(query)}&type=all&page=1`,
    signal,
  );
  return (data.results ?? [])
    .filter((r) => r.type === "movie" || r.type === "tv")
    .map((r) => ({
      id: String(r.id),
      type: r.type as "movie" | "tv",
      title: r.title,
      year: r.year || undefined,
      poster: image(r.poster || r.image),
      backdrop: image(r.backdrop),
      overview: r.overview,
    }));
}

export interface SeasonSummary {
  number: number;
  name: string;
  episodeCount: number;
}

export interface ShowDetails {
  id: string;
  title: string;
  poster?: string;
  backdrop?: string;
  seasons: SeasonSummary[];
}

export async function getShow(
  id: string,
  signal?: AbortSignal,
): Promise<ShowDetails> {
  const d = await get<{
    title: string;
    poster?: string;
    backdrop?: string;
    seasons?: Array<{
      season_number: number;
      name: string;
      episode_count: number;
    }>;
  }>(`/api/tv/${encodeURIComponent(id)}`, signal);
  const seasons = (d.seasons ?? [])
    .map((s) => ({
      number: s.season_number,
      name: s.name,
      episodeCount: s.episode_count,
    }))
    .filter((s) => s.episodeCount > 0);
  // Specials go last; most people want season 1 first.
  seasons.sort((a, b) =>
    a.number === 0 ? 1 : b.number === 0 ? -1 : a.number - b.number,
  );
  return {
    id,
    title: d.title,
    poster: image(d.poster),
    backdrop: image(d.backdrop),
    seasons,
  };
}

export interface Episode {
  number: number;
  name: string;
  overview?: string;
  still?: string;
  airDate?: string;
}

export async function getSeason(
  id: string,
  season: number,
  signal?: AbortSignal,
): Promise<Episode[]> {
  const d = await get<{
    episodes?: Array<{
      episode_number: number;
      name: string;
      overview?: string;
      still?: string;
      air_date?: string;
    }>;
  }>(`/api/season?id=${encodeURIComponent(id)}&season=${season}`, signal);
  return (d.episodes ?? []).map((e) => ({
    number: e.episode_number,
    name: e.name,
    overview: e.overview,
    still: image(e.still),
    airDate: e.air_date,
  }));
}

export interface Provider {
  id: string;
  name: string;
  tagline?: string;
}

export async function getProviders(): Promise<Provider[]> {
  const d = await get<{ providers?: Array<Provider & { status?: string }> }>(
    "/api/providers",
  );
  return (d.providers ?? []).filter((p) => p.status !== "unavailable");
}
