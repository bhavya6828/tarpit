export type Speaker = 'scammer' | 'persona';

export interface PersonaCard {
  id: string;
  name: string;
  age: number;
  tagline: string;
  accent: string;
  color: string;
}

export interface TranscriptLine {
  id: string;
  speaker: Speaker;
  text: string;
  final: boolean;
  injected?: boolean;
  at: number;
}

export interface IntelItem {
  id: string;
  session_id: string;
  type: string;
  label: string;
  value: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  score: number;
  speaker: string;
  meta: Record<string, string | number>;
  source_utterance: string;
  '@timestamp': string;
}

export interface Metrics {
  sessionId: string;
  status: string;
  secondsWasted: number;
  costDestroyed: number;
  victimsShielded: number;
  turns: number;
  interruptions: number;
  intelCount: number;
  persona: string;
}

export interface Enrichment {
  scam_type: string;
  claimed_org: string | null;
  claimed_name: string | null;
  payment_rail: string | null;
  amount_demanded: string | null;
  pressure_tactics: string[];
  confidence: number;
}

export type ConnState = 'offline' | 'connecting' | 'ready' | 'live' | 'ended';
