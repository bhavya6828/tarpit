import type { Enrichment, IntelItem, Metrics, TranscriptLine } from './types';

export interface EmptySessionView {
  transcript: TranscriptLine[];
  partial: string;
  agentLive: string;
  intel: IntelItem[];
  metrics: Metrics | null;
  enrichment: Enrichment | null;
  signals: string[];
  agentSpeaking: boolean;
}

export const bridgeOfflineMessage = 'audio bridge unreachable, is the server running?';

export const emptySessionView = (): EmptySessionView => ({
  transcript: [],
  partial: '',
  agentLive: '',
  intel: [],
  metrics: null,
  enrichment: null,
  signals: [],
  agentSpeaking: false,
});

export function normalizeInjectedText(text: string, live: boolean) {
  const clean = text.trim();
  return live && clean ? clean : null;
}
