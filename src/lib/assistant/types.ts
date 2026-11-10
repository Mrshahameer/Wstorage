// Shapes shared by the assistant API and the chat UI. No server imports here,
// so the browser bundle can use these types too.

export interface FileItem {
  id: string;
  name: string;
  ext: string | null;
  contentType: string | null;
  size: number;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  liveUrl: string | null;
  folder: string | null; // top-level folder name inside the campaign
}

export interface CampaignItem {
  id: string;
  name: string;
  path: string; // Category › Vertical › Campaign
  link: string;
  note?: string;
}

/** One block of results in a reply. A multi-part ask returns several. */
export type Section =
  | {
      kind: "files";
      label: string; // "ACA (Obamacare) Pure Inbound · Landing Pages"
      path: string;
      campaign: { id: string; name: string };
      folder: { id: string; name: string } | null; // null = whole campaign
      link: string; // opens the folder (or campaign) in the library
      files: FileItem[];
      total: number; // may exceed files.length when capped
      note?: string;
    }
  | { kind: "campaigns"; label: string; note?: string; campaigns: CampaignItem[] }
  | { kind: "note"; label: string; text: string };

/** How a reply was produced, shown under every assistant message. */
export interface AssistantMeta {
  mode: "ai" | "keyword";
  provider?: string;
  model?: string;
  steps?: number; // model calls used for this reply
  ms: number;
  reasonCode?: string; // why keyword mode was used
  reason?: string;
}

export interface AssistantResponse {
  reply: string;
  sections: Section[];
  meta: AssistantMeta;
}

export const MAX_QUERY_CHARS = 4000;
