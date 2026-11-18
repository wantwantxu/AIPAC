export type PublishPayload = {
  title: string;
  content: string;
  summary?: string;
  tags?: string[];
  imageUrl?: string;
  sourceUrl?: string;
};

export type PublishResult = {
  remoteId?: string;
  remoteUrl?: string;
};

export interface Publisher {
  type: string;
  publish(
    config: Record<string, unknown>,
    payload: PublishPayload
  ): Promise<PublishResult>;
}
