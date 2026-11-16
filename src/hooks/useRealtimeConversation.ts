import { useCallback, useEffect, useRef, useState } from 'react';

interface UseRealtimeConversationProps {
  instructions: string;
  onUserTranscript: (text: string) => void;
  onUserTranscriptDelta?: (delta: string) => void;
  onSpeechStopped?: () => void;
  onAssistantDelta: (delta: string) => void;
  onAssistantTurnStart: () => void;
  onAssistantTurnEnd?: () => void;
}

const SAMPLE_RATE = 24000;
// GA Realtime model (beta preview models / OpenAI-Beta header are retired)
const REALTIME_MODEL = 'gpt-realtime-2.1';
// Smaller buffer = audio reaches the server sooner (~85ms @ 24kHz)
const PROCESSOR_BUFFER_SIZE = 2048;

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const floatTo16BitPCM = (input: Float32Array) => {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  let offset = 0;

  for (let i = 0; i < input.length; i += 1, offset += 2) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
};

// Build instructions for live incoming voice session
const buildRealtimeInstructions = (instructions: string) => {
  return `${instructions.trim()}

### LIVE INCOMING VOICE RULES:
- Listen to incoming voice and respond STRICTLY from the development point of view of your explicitly defined skills: React.js, TypeScript, JavaScript, Golang, Node.js, Python, Docker, CI/CD, Cloud, and AI integration.
- ABSOLUTE CONTEXT BOUNDARY: NEVER go outside the context that has not been shared by the user. Do not invent details, assumptions, or external scenarios. Answer ONLY what was asked.
- Reply with TEXT ONLY (no audio).
- Answer immediately and directly without conversational filler ("Sure", "Certainly", "Here is").
- Keep answers crisp, punchy, and focused (typically 2 to 4 sentences for direct questions). Stop as soon as the specific development point is cleanly resolved.`;
};

// Latency-tuned session: semantic VAD (high eagerness) + text-only output
const buildGaSessionUpdate = (instructions: string) => ({
  type: 'session.update',
  session: {
    type: 'realtime',
    model: REALTIME_MODEL,
    output_modalities: ['text'],
    instructions: buildRealtimeInstructions(instructions),
    audio: {
      input: {
        format: {
          type: 'audio/pcm',
          rate: SAMPLE_RATE
        },
        // Skip noise_reduction — adds processing latency
        transcription: {
          model: 'gpt-4o-mini-transcribe'
        },
        turn_detection: {
          // Semantic VAD + high eagerness ends turns ASAP (max ~2s wait)
          type: 'semantic_vad',
          eagerness: 'high',
          create_response: true,
          interrupt_response: true
        }
      }
    }
  }
});

export const useRealtimeConversation = ({
  instructions,
  onUserTranscript,
  onUserTranscriptDelta,
  onSpeechStopped,
  onAssistantDelta,
  onAssistantTurnStart,
  onAssistantTurnEnd
}: UseRealtimeConversationProps) => {
  const [isActive, setIsActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [statusText, setStatusText] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const muteNodeRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const respondingRef = useRef(false);
  const responseLockRef = useRef(false);
  const hasUnansweredSpeechRef = useRef(false);
  const lastSpaceAtRef = useRef(0);
  const isListeningRef = useRef(false);
  const wantActiveRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const startingRef = useRef(false);
  const audioChunkCountRef = useRef(0);

  const onUserTranscriptRef = useRef(onUserTranscript);
  const onUserTranscriptDeltaRef = useRef(onUserTranscriptDelta);
  const onSpeechStoppedRef = useRef(onSpeechStopped);
  const onAssistantDeltaRef = useRef(onAssistantDelta);
  const onAssistantTurnStartRef = useRef(onAssistantTurnStart);
  const onAssistantTurnEndRef = useRef(onAssistantTurnEnd);
  const instructionsRef = useRef(instructions);

  onUserTranscriptRef.current = onUserTranscript;
  onUserTranscriptDeltaRef.current = onUserTranscriptDelta;
  onSpeechStoppedRef.current = onSpeechStopped;
  onAssistantDeltaRef.current = onAssistantDelta;
  onAssistantTurnStartRef.current = onAssistantTurnStart;
  onAssistantTurnEndRef.current = onAssistantTurnEnd;
  instructionsRef.current = instructions;

  const ensureMicRunning = useCallback(async () => {
    const ctx = audioContextRef.current;
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
        console.log('🎤 Mic AudioContext resumed');
      } catch (err) {
        console.error('❌ Failed to resume mic AudioContext:', err);
      }
    }
  }, []);

  const teardownMedia = useCallback(() => {
    try {
      processorRef.current?.disconnect();
    } catch {
      // ignore
    }
    try {
      sourceNodeRef.current?.disconnect();
    } catch {
      // ignore
    }
    try {
      muteNodeRef.current?.disconnect();
    } catch {
      // ignore
    }

    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    const captureContext = audioContextRef.current;
    audioContextRef.current = null;
    processorRef.current = null;
    sourceNodeRef.current = null;
    muteNodeRef.current = null;
    streamRef.current = null;

    if (captureContext && captureContext.state !== 'closed') {
      void captureContext.close();
    }
  }, []);

  const setListening = useCallback((next: boolean, status?: string) => {
    isListeningRef.current = next;
    setIsListening(next);
    if (status !== undefined) {
      setStatusText(status);
    } else if (next) {
      setStatusText('Listening ON — Space = done speaking');
    } else {
      setStatusText('Listening OFF — Space = resume');
    }
  }, []);

  const cleanup = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    respondingRef.current = false;
    responseLockRef.current = false;
    hasUnansweredSpeechRef.current = false;
    isListeningRef.current = false;
    audioChunkCountRef.current = 0;
    startingRef.current = false;

    teardownMedia();

    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      intentionalCloseRef.current = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
    }

    setIsActive(false);
    setIsListening(false);
  }, [teardownMedia]);

  /** Soft pause: listening OFF; generate only once per new utterance */
  const pauseListening = useCallback(() => {
    const ws = wsRef.current;
    if (!wantActiveRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (!isListeningRef.current) return;

    // Always turn listening off
    setListening(false, 'Listening OFF — Space = resume');
    onSpeechStoppedRef.current?.();

    // Already generating / already forced a response for this turn
    if (respondingRef.current || responseLockRef.current) {
      console.log('⌨️ Soft pause — listening OFF (skip duplicate generate)');
      setStatusText('Listening OFF — generating…');
      return;
    }

    // No new speech since last answer — don't regenerate the same thing
    if (!hasUnansweredSpeechRef.current) {
      console.log('⌨️ Soft pause — listening OFF (no new speech, skip generate)');
      setStatusText('Listening OFF — Space = resume');
      return;
    }

    console.log('⌨️ Soft pause — listening OFF + generate once');
    responseLockRef.current = true;
    hasUnansweredSpeechRef.current = false;
    setStatusText('Listening OFF — generating…');

    try {
      ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    } catch (err) {
      console.warn('commit failed (may already be committed):', err);
    }

    try {
      ws.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            output_modalities: ['text']
          }
        })
      );
    } catch (err) {
      console.error('response.create failed:', err);
      responseLockRef.current = false;
      setStatusText('Listening OFF — Space = resume');
    }
  }, [setListening]);

  /** Resume listening without ending the session */
  const resumeListening = useCallback(() => {
    if (!wantActiveRef.current || !wsRef.current) return;
    if (isListeningRef.current) return;
    if (respondingRef.current || responseLockRef.current) {
      setStatusText('Still generating… wait, then Space to resume');
      return;
    }

    console.log('⌨️ Resume — listening ON');
    // Fresh listen turn — wait for actual speech before Space can generate again
    hasUnansweredSpeechRef.current = false;
    setListening(true, 'Listening ON — speak, then Space');
  }, [setListening]);

  /** Space while session active: toggle listening on/off (debounced) */
  const toggleListening = useCallback(() => {
    if (!wantActiveRef.current) return;

    const now = Date.now();
    if (now - lastSpaceAtRef.current < 450) {
      return;
    }
    lastSpaceAtRef.current = now;

    if (isListeningRef.current) {
      pauseListening();
    } else {
      resumeListening();
    }
  }, [pauseListening, resumeListening]);

  const attachMicPipeline = useCallback(
    (stream: MediaStream, captureContext: AudioContext, ws: WebSocket) => {
      const source = captureContext.createMediaStreamSource(stream);
      const processor = captureContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
      const mute = captureContext.createGain();
      mute.gain.value = 0;

      sourceNodeRef.current = source;
      processorRef.current = processor;
      muteNodeRef.current = mute;

      source.connect(processor);
      // ScriptProcessor only runs while connected to destination
      processor.connect(mute);
      mute.connect(captureContext.destination);

      processor.onaudioprocess = (event) => {
        if (!wantActiveRef.current) return;
        // Listening OFF (Space soft-pause): do not stream mic audio
        if (!isListeningRef.current) return;
        if (wsRef.current !== ws || ws.readyState !== WebSocket.OPEN) return;
        if (captureContext.state !== 'running') {
          void captureContext.resume();
          return;
        }

        const channel = event.inputBuffer.getChannelData(0);
        const copy = new Float32Array(channel.length);
        copy.set(channel);
        audioChunkCountRef.current += 1;

        try {
          ws.send(
            JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: arrayBufferToBase64(floatTo16BitPCM(copy))
            })
          );
        } catch (err) {
          console.error('❌ Failed to append mic audio:', err);
        }
      };

      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          console.warn('🎤 Mic track ended unexpectedly');
          setStatusText('Microphone stopped — tap mic to restart');
          wantActiveRef.current = false;
          cleanup();
        };
      });
    },
    [cleanup]
  );

  const start = useCallback(async () => {
    if (wantActiveRef.current || startingRef.current || wsRef.current) return;
    startingRef.current = true;
    intentionalCloseRef.current = false;
    wantActiveRef.current = true;
    isListeningRef.current = true;
    responseLockRef.current = false;
    hasUnansweredSpeechRef.current = false;
    setIsListening(true);
    setStatusText('Connecting mic…');

    let stream: MediaStream | null = null;
    let captureContext: AudioContext | null = null;

    try {
      // Create AudioContext inside the click gesture so mic capture stays unlocked
      captureContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = captureContext;
      await captureContext.resume();

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;

      const micTrack = stream.getAudioTracks()[0];
      console.log('🎤 Mic track settings:', micTrack?.getSettings?.(), 'state:', micTrack?.readyState);

      const apiKey = import.meta.env.VITE_API_KEY;
      if (!apiKey) {
        throw new Error('Missing VITE_API_KEY');
      }

      // GA WebSocket: do NOT send openai-beta.realtime-v1 (beta API is retired)
      const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`, [
        'realtime',
        `openai-insecure-api-key.${apiKey}`
      ]);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!wantActiveRef.current || !captureContext || !stream) return;

        console.log('✅ Realtime GA WS connected (text-only output)');
        setIsActive(true);
        setListening(true, 'Listening ON — Space = done speaking');
        startingRef.current = false;

        attachMicPipeline(stream, captureContext, ws);
        ws.send(JSON.stringify(buildGaSessionUpdate(instructionsRef.current)));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case 'session.created':
            case 'session.updated':
              console.log('📡', msg.type);
              break;
            case 'conversation.item.input_audio_transcription.delta':
              if (msg.delta && isListeningRef.current) {
                hasUnansweredSpeechRef.current = true;
                onUserTranscriptDeltaRef.current?.(msg.delta);
              }
              break;
            case 'conversation.item.input_audio_transcription.completed':
            case 'conversation.item.input_audio_transcription.done':
              if (msg.transcript?.trim()) {
                hasUnansweredSpeechRef.current = true;
                onUserTranscriptRef.current(msg.transcript.trim());
              }
              break;
            case 'input_audio_buffer.speech_stopped':
              if (!isListeningRef.current) break;
              setStatusText('Thinking…');
              onSpeechStoppedRef.current?.();
              break;
            case 'response.created':
              respondingRef.current = true;
              responseLockRef.current = true;
              hasUnansweredSpeechRef.current = false;
              setStatusText(
                isListeningRef.current
                  ? 'Generating…'
                  : 'Listening OFF — generating…'
              );
              onAssistantTurnStartRef.current();
              break;
            case 'response.output_text.delta':
              if (msg.delta) {
                onAssistantDeltaRef.current(msg.delta);
              }
              break;
            case 'input_audio_buffer.speech_started':
              if (!isListeningRef.current) break;
              hasUnansweredSpeechRef.current = true;
              if (respondingRef.current) {
                respondingRef.current = false;
              }
              setStatusText('Listening ON — speak, then Space');
              break;
            case 'response.done':
            case 'response.cancelled':
              respondingRef.current = false;
              responseLockRef.current = false;
              hasUnansweredSpeechRef.current = false;
              onAssistantTurnEndRef.current?.();
              // Keep listening flag as-is (Space controls it). Don't auto-resume.
              setStatusText(
                isListeningRef.current
                  ? 'Listening ON — speak, then Space'
                  : 'Listening OFF — Space = resume'
              );
              break;
            case 'error': {
              const errMsg = msg.error?.message || JSON.stringify(msg.error);
              console.error('❌ Realtime server error:', msg.error);
              const recoverable =
                /buffer|cancel|already|empty|too small|no active response/i.test(errMsg || '');
              if (!recoverable) {
                setStatusText(errMsg || 'Realtime error');
              }
              break;
            }
            default:
              break;
          }
        } catch (err) {
          console.error('Error parsing Realtime message', err);
        }
      };

      ws.onerror = (err) => {
        console.error('❌ Realtime WS error', err);
        setStatusText('Realtime connection error');
      };

      ws.onclose = (event) => {
        console.warn('🛑 Realtime WS closed', event.code, event.reason || '(no reason)');
        wsRef.current = null;
        startingRef.current = false;

        const wasIntentional = intentionalCloseRef.current;
        intentionalCloseRef.current = false;

        teardownMedia();
        setIsActive(false);
        setIsListening(false);
        isListeningRef.current = false;

        if (!wasIntentional && wantActiveRef.current) {
          wantActiveRef.current = false;
          setStatusText(`Disconnected (${event.code}). Tap mic to restart.`);
        } else {
          wantActiveRef.current = false;
          setStatusText('');
        }
      };
    } catch (err) {
      console.error('❌ Failed to start Realtime conversation:', err);
      wantActiveRef.current = false;
      startingRef.current = false;
      setStatusText('Could not start microphone / Realtime');
      cleanup();
    }
  }, [attachMicPipeline, cleanup, setListening, teardownMedia]);

  const stop = useCallback(() => {
    wantActiveRef.current = false;
    intentionalCloseRef.current = true;
    setStatusText('');
    cleanup();
  }, [cleanup]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && wantActiveRef.current) {
        void ensureMicRunning();
      }
    };
    const onFocus = () => {
      if (wantActiveRef.current) {
        void ensureMicRunning();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [ensureMicRunning]);

  useEffect(() => {
    return () => {
      wantActiveRef.current = false;
      intentionalCloseRef.current = true;
      cleanup();
    };
  }, [cleanup]);

  return {
    isActive,
    isListening,
    statusText,
    start,
    stop,
    toggleListening
  };
};
