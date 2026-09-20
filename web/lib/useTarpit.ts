'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine } from './audio';
import type { ConnState, Enrichment, IntelItem, Metrics, PersonaCard, Speaker, TranscriptLine } from './types';
import { bridgeOfflineMessage, emptySessionView } from './sessionView';
import {
  appendUniqueError,
  parseSocketMessage,
  reconnectDelay,
  resolveServerUrls,
} from './connection';

const SERVER = process.env.NEXT_PUBLIC_TARPIT_SERVER || 'localhost:8787';
const ACCESS_TOKEN = process.env.NEXT_PUBLIC_TARPIT_TOKEN || '';
const PAGE_PROTOCOL = typeof window === 'undefined' ? 'http:' : window.location.protocol;
const URLS = resolveServerUrls(SERVER, PAGE_PROTOCOL);
const WS_URL = `${URLS.ws}${ACCESS_TOKEN ? `?token=${encodeURIComponent(ACCESS_TOKEN)}` : ''}`;
const invalidBridgeMessage = 'audio bridge sent an invalid frame';

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

  const send = useCallback((message: Record<string, unknown>) => {
    const socket = wsRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      setErrors((current) => appendUniqueError(current, bridgeOfflineMessage));
      return false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;

    const poll = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        current.abort();
      }, 5000);

      try {
        const response = await fetch(`${URLS.http}/api/health`, { signal: current.signal });
        if (!response.ok) throw new Error(`health ${response.status}`);
        const payload = await response.json();
        if (active && controller === current) setHealth(payload);
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        if (active && controller === current && (timedOut || !aborted)) setHealth(null);
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 8000);
    return () => {
      active = false;
      window.clearInterval(interval);
      controller?.abort();
    };
  }, []);

  useEffect(() => {
    engineRef.current = new AudioEngine({
      onPcm: (buffer) => {
        const socket = wsRef.current;
        if (socket?.readyState !== WebSocket.OPEN) return;
        try {
          socket.send(buffer);
        } catch {
          setErrors((current) => appendUniqueError(current, bridgeOfflineMessage));
        }
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

  useEffect(() => {
    let disposed = false;
    let attempts = 0;
    let reconnectTimer: number | null = null;
    let signalTimer: number | null = null;

    const connect = () => {
      if (disposed) return;
      const current = wsRef.current;
      if (current && current.readyState <= WebSocket.OPEN) return;

      setConn('connecting');
      const socket = new WebSocket(WS_URL);
      socket.binaryType = 'arraybuffer';
      wsRef.current = socket;

      socket.onopen = () => {
        if (disposed || wsRef.current !== socket) return;
        attempts = 0;
        setConn('ready');
        setErrors((currentErrors) => currentErrors.filter((message) => message !== bridgeOfflineMessage));
      };

      socket.onclose = () => {
        if (wsRef.current === socket) wsRef.current = null;
        engineRef.current?.flush();
        engineRef.current?.stopAmbience();
        if (disposed) return;
        setConn('offline');
        setAgentSpeaking(false);
        const delay = reconnectDelay(attempts);
        attempts += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        if (!disposed) setErrors((currentErrors) => appendUniqueError(currentErrors, bridgeOfflineMessage));
      };

      socket.onmessage = (message) => {
        if (disposed || wsRef.current !== socket) return;
        const parsed = parseSocketMessage(message.data);
        if (parsed.kind === 'invalid') {
          setErrors((currentErrors) => appendUniqueError(currentErrors, invalidBridgeMessage));
          return;
        }
        if (parsed.kind === 'audio') {
          engineRef.current?.enqueue(parsed.turnId, parsed.payload);
          return;
        }

        const event = parsed.event;
        switch (event.type) {
          case 'hello':
            if (Array.isArray(event.personas)) setPersonas(event.personas as PersonaCard[]);
            break;
          case 'session_start': {
            const fresh = emptySessionView();
            const persona = event.persona as PersonaCard;
            engineRef.current?.flush();
            setConn('live');
            setActivePersona(persona);
            engineRef.current?.setAmbience(persona?.id ?? null);
            setTranscript(fresh.transcript);
            setPartial(fresh.partial);
            setAgentLive(fresh.agentLive);
            setIntel(fresh.intel);
            setMetrics(fresh.metrics);
            setEnrichment(fresh.enrichment);
            setSignals(fresh.signals);
            setAgentSpeaking(fresh.agentSpeaking);
            break;
          }
          case 'session_end':
            setConn('ended');
            setAgentSpeaking(false);
            engineRef.current?.stopAmbience();
            if (event.enrichment) setEnrichment(event.enrichment as Enrichment);
            break;
          case 'persona_changed': {
            const persona = event.persona as PersonaCard;
            setActivePersona(persona);
            engineRef.current?.setAmbience(persona?.id ?? null);
            break;
          }
          case 'transcript_partial':
            if (typeof event.text === 'string') setPartial(event.text);
            break;
          case 'transcript':
            if (typeof event.text !== 'string') break;
            if (event.speaker === 'scammer') setPartial('');
            else setAgentLive('');
            setTranscript((currentTranscript) => [
              ...currentTranscript,
              {
                id: nextId(),
                speaker: event.speaker as Speaker,
                text: event.text as string,
                final: true,
                injected: Boolean(event.injected),
                at: Date.now(),
              },
            ]);
            break;
          case 'agent_delta':
            if (typeof event.text === 'string') setAgentLive((text) => text + event.text);
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
            if (typeof event.agentSpeaking === 'boolean') setAgentSpeaking(event.agentSpeaking);
            if (typeof event.muteWhileSpeaking === 'boolean') setMuteWhileSpeaking(event.muteWhileSpeaking);
            break;
          case 'metrics':
            setMetrics(event as unknown as Metrics);
            break;
          case 'intel':
            if (event.item) setIntel((currentIntel) => [event.item as IntelItem, ...currentIntel].slice(0, 200));
            setLastIntelAt(Date.now());
            break;
          case 'enrichment':
            if (event.enrichment) setEnrichment(event.enrichment as Enrichment);
            break;
          case 'signals':
            if (Array.isArray(event.signals)) {
              setSignals(event.signals.filter((signal): signal is string => typeof signal === 'string'));
              if (signalTimer) window.clearTimeout(signalTimer);
              signalTimer = window.setTimeout(() => setSignals([]), 6000);
            }
            break;
          case 'error':
            setErrors((currentErrors) => appendUniqueError(currentErrors, `${String(event.scope)}: ${String(event.message)}`));
            break;
          default:
            break;
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (signalTimer) window.clearTimeout(signalTimer);
      const socket = wsRef.current;
      wsRef.current = null;
      socket?.close();
    };
  }, []);

  const start = useCallback(
    async (personaId: string) => {
      setErrors([]);
      try {
        await engineRef.current?.ensurePlayback();
        await engineRef.current?.startMic();
      } catch (error) {
        setErrors((currentErrors) => appendUniqueError(currentErrors, `microphone blocked: ${(error as Error).message}`));
      }
      send({ type: 'start', personaId });
    },
    [send]
  );

  const stop = useCallback(() => {
    send({ type: 'stop' });
    engineRef.current?.flush();
    setAgentSpeaking(false);
  }, [send]);

  const choosePersona = useCallback(
    (id: string) => {
      if (conn === 'live') send({ type: 'persona', id });
      else setActivePersona(personas.find((persona) => persona.id === id) || null);
    },
    [conn, personas, send]
  );

  const inject = useCallback(
    (text: string) => {
      engineRef.current?.ensurePlayback().catch((error) => {
        setErrors((currentErrors) => appendUniqueError(currentErrors, `audio playback blocked: ${(error as Error).message}`));
      });
      send({ type: 'inject', text });
    },
    [send]
  );

  const toggleTelephony = useCallback(() => {
    setTelephony((current) => {
      const next = !current;
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
    conn,
    personas,
    activePersona,
    transcript,
    partial,
    agentLive,
    intel,
    metrics,
    enrichment,
    signals,
    agentSpeaking,
    inputLevel,
    outputLevel,
    health,
    muteWhileSpeaking,
    errors,
    lastIntelAt,
    telephony,
    start,
    stop,
    choosePersona,
    inject,
    toggleMuteWhileSpeaking,
    toggleTelephony,
  };
}
