/**
 * The raw "70% skeleton" exactly as the LLM may return it — deliberately
 * loose (any keys, any value shapes). normalize.ts in the parser feature is
 * the single place that turns this tolerant shape into strict Shot objects.
 */
export type SkeletonItem = Record<string, unknown>
