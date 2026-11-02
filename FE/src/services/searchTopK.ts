/** Number of results the buyer may request from keyword and image search. */
export const SEARCH_TOP_K_OPTIONS = [3, 5, 10] as const;
export type SearchTopK = (typeof SEARCH_TOP_K_OPTIONS)[number];
export const DEFAULT_SEARCH_TOP_K: SearchTopK = 10;
/** Candidate pool for RRF/FAISS; must stay >= every top-K option. */
export const SEARCH_CANDIDATE_K = 100;

export const isSearchTopK = (value: unknown): value is SearchTopK =>
  (SEARCH_TOP_K_OPTIONS as readonly unknown[]).includes(value);

/** Parses a <select> value; anything outside the allowed levels falls back to the default. */
export const parseSearchTopK = (value: string): SearchTopK => {
  const n = Number(value);
  return isSearchTopK(n) ? n : DEFAULT_SEARCH_TOP_K;
};
