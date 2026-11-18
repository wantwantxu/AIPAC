export type CollectedItem = {
  externalId: string;
  title: string;
  url?: string;
  content?: string;
  raw?: unknown;
};

export interface Collector {
  type: string;
  collect(config: Record<string, unknown>): Promise<CollectedItem[]>;
}
