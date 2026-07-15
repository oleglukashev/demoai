export interface DocFile {
  id: string;
  name: string;
  createdAt: string;
  _count: { chunks: number };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  pending?: boolean;
}

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3006";
