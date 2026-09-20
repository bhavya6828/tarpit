'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine } from './audio';
import type { ConnState, Enrichment, IntelItem, Metrics, PersonaCard, TranscriptLine } from './types';

const SERVER = process.env.NEXT_PUBLIC_TARPIT_SERVER || 'localhost:8787';
const HTTP = `http://${SERVER}`;
const WS_URL = `ws://${SERVER}/ws`;

let lineSeq = 0;
const nextId = () => `l${++lineSeq}`;

export interface Health {
  ok: boolean;
  missing: string[];
  services: { deepgram: boolean; elevenlabs: boolean; openai: boolean; elastic: string };
  models: { stt: string; tts: string; llm: string };
}

export function useTarpit() {
  const [conn, setConn] = useState<ConnState>('offline');
  const [personas, setPersonas] = useState<PersonaCard[]>([]);
  const [activePersona, setActivePersona] = useState<PersonaCard | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [partial, setPartial] = useState('');
  const [agentLive, setAgentLive] = useState('');
  const [intel, setIntel] = useState<IntelItem[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [enrichment, setEnrichment] = useState<Enrichment | null>(null);
  const [signals, setSignals] = useState<string[]>([]);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [muteWhileSpeaking, setMuteWhileSpeaking] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [lastIntelAt, setLastIntelAt] = useState(0);
  const [telephony, setTelephony] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  // ─── health probe ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      fetch(`${HTTP}/api/health`)
        .then((r) => r.json())
        .then((h) => !cancelled && setHealth(h))
        .catch(() => !cancelled && setHealth(null));
    poll();
    const t = setInterval(poll, 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // ─── audio engine ────────────────────────────────────────────────────────
  useEffect(() => {
    engineRef.current = new AudioEngine({
      onPcm: (buf) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) ws.send(buf);
      },
      onInputLevel: setInputLevel,
      onOutputLevel: setOutputLevel,
      onPlaybackDone: (turnId) => send({ type: 'playback_done', turnId }),
    });
    return () => {
      engineRef.current?.stop();
      engineRef.current = null;
    };
  }, [send]);

  // ─── socket ──────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;
    setConn('connecting');

    const ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => setConn('ready');
    ws.onclose = () => {
      setConn('offline');
      setAgentSpeaking(false);
    };
    ws.onerror = () => setErrors((e) => [...e.slice(-4), 'audio bridge unreachable — is the server running?']);

    ws.onmessage = (ev) => {
      // Binary frame = [uint32 turnId][PCM16 @24kHz]
      if (ev.data instanceof ArrayBuffer) {
        const view = new DataView(ev.data);
        const turnId = view.getUint32(0, true);
        engineRef.current?.enqueue(turnId, ev.data.slice(4));
        return;
      }

      const evt = JSON.parse(ev.data as string);
      switch (evt.type) {
        case 'hello':
          setPersonas(evt.personas);
          break;
        case 'session_start':
          setConn('live');
          setActivePersona(evt.persona);
          engineRef.current?.setAmbience(evt.persona?.id ?? null);
          setTranscript([]);
          setIntel([]);
          setEnrichment(null);
          setSignals([]);
          break;
        case 'session_end':
          setConn('ended');
          setAgentSpeaking(false);
          engineRef.current?.stopAmbience();
          if (evt.enrichment) setEnrichment(evt.enrichment);
          break;
        case 'persona_changed':
          setActivePersona(evt.persona);
          engineRef.current?.setAmbience(evt.persona?.id ?? null);
          break;
        case 'transcript_partial':
          setPartial(evt.text);
          break;
        case 'transcript':
          if (evt.speaker === 'scammer') setPartial('');
          else setAgentLive('');
          setTranscript((t) => [
            ...t,
            { id: nextId(), speaker: evt.speaker, text: evt.text, final: true, injected: evt.injected, at: Date.now() },
          ]);
          break;
        case 'agent_delta':
          setAgentLive((s) => s + evt.text);
          break;
        case 'audio_start':
          setAgentSpeaking(true);
          setAgentLive('');
          break;
        case 'audio_flush':
        case 'interrupted':
          engineRef.current?.flush();
          setAgentSpeaking(false);
          break;
        case 'state':
          if (typeof evt.agentSpeaking === 'boolean') setAgentSpeaking(evt.agentSpeaking);
          if (typeof evt.muteWhileSpeaking === 'boolean') setMuteWhileSpeaking(evt.muteWhileSpeaking);
          break;
        case 'metrics':
          setMetrics(evt);
          break;
        case 'intel':
          setIntel((prev) => [evt.item, ...prev].slice(0, 200));
          setLastIntelAt(Date.now());
          break;
        case 'enrichment':
          setEnrichment(evt.enrichment);
          break;
        case 'signals':
          setSignals(evt.signals);
          setTimeout(() => setSignals([]), 6000);
          break;
        case 'error':
          setErrors((e) => [...e.slice(-4), `${evt.scope}: ${evt.message}`]);
          break;
        default:
          break;
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  // ─── actions ─────────────────────────────────────────────────────────────

  const start = useCallback(
    async (personaId: string) => {
      setErrors([]);
      try {
        await engineRef.current?.ensurePlayback();
        await engineRef.current?.startMic();
      } catch (err) {
        setErrors((e) => [...e, `microphone blocked: ${(err as Error).message}`]);
      }
      if (wsRef.current?.readyState !== WebSocket.OPEN) connect();
      send({ type: 'start', personaId });
    },
    [connect, send]
  );

  const stop = useCallback(() => {
    send({ type: 'stop' });
    engineRef.current?.flush();
    setAgentSpeaking(false);
  }, [send]);

  const choosePersona = useCallback(
    (id: string) => {
      if (conn === 'live') send({ type: 'persona', id });
      else setActivePersona(personas.find((p) => p.id === id) || null);
    },
    [conn, personas, send]
  );

  const inject = useCallback(
    (text: string) => {
      engineRef.current?.ensurePlayback();
      send({ type: 'inject', text });
    },
    [send]
  );

  const toggleTelephony = useCallback(() => {
    setTelephony((prev) => {
      const next = !prev;
      engineRef.current?.setTelephony(next);
      return next;
    });
  }, []);

  const toggleMuteWhileSpeaking = useCallback(() => {
    const next = !muteWhileSpeaking;
    setMuteWhileSpeaking(next);
    send({ type: 'mute_while_speaking', value: next });
  }, [muteWhileSpeaking, send]);

  return {
    conn, personas, activePersona, transcript, partial, agentLive, intel, metrics,
    enrichment, signals, agentSpeaking, inputLevel, outputLevel, health,
    muteWhileSpeaking, errors, lastIntelAt, telephony,
    start, stop, choosePersona, inject, toggleMuteWhileSpeaking, toggleTelephony,
  };
}
