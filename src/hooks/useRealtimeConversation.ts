import { useCallback, useEffect, useRef, useState } from 'react';
import { GO_REACT_REALTIME_RULES } from '../prompts/goReactDeveloper';

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
// GA Realtime model
const REALTIME_MODEL = 'gpt-realtime-2.1';
// Audio processor buffer size (~85ms @ 24kHz)
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

// Build instructions for live incoming speaker audio monitoring
const buildRealtimeInstructions = (instructions: string) => {
  return `${instructions.trim()}

${GO_REACT_REALTIME_RULES}`;
};

/**
 * Configure Realtime session:
 * - Semantic VAD with 'low' eagerness: waits patiently for natural speech completion instead of cutting off on brief pauses.
 * - create_response: false -> Prevents premature server responses while speaker is still talking;
 *   client-side endpointing coordinator triggers response.create once the complete sentence is finished.
 * - interrupt_response: false -> Prevents premature interruption of ongoing responses.
 */
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
        transcription: {
          model: 'gpt-4o-mini-transcribe'
        },
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'low',
          create_response: false,
          interrupt_response: false
        }
      }
    }
  }
});

/**
 * Capture audio stream directly with hardware/OS echo cancellation and noise suppression.
 * Starts instantaneously on single click without screen share pickers or dialogs.
 */
const captureAudioStream = async (): Promise<MediaStream> => {
  try {
    console.log('🎤 [Realtime] Acquiring audio stream with noise suppression & echo cancellation...');
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: SAMPLE_RATE,
        channelCount: 1
      }
    });
  } catch (err) {
    console.warn('⚠️ [Realtime] Standard getUserMedia audio failed, attempting fallback:', err);
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  }
};

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

  // Audio endpointing & sentence accumulation state
  const accumulatedUtteranceRef = useRef<string>('');
  const hasUnprocessedSpeechRef = useRef<boolean>(false);
  const isGeneratingResponseRef = useRef<boolean>(false);
  const speechActiveRef = useRef<boolean>(false);
  const endpointTimerRef = useRef<NodeJS.Timeout | null>(null);

  const sessionIdRef = useRef<number>(0);
  const wantActiveRef = useRef(false);
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

  const ensureSpeakerAudioRunning = useCallback(async () => {
    const ctx = audioContextRef.current;
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
        console.log('🔊 Speaker AudioContext resumed');
      } catch (err) {
        console.error('❌ Failed to resume speaker AudioContext:', err);
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

  const cleanup = useCallback(() => {
    sessionIdRef.current += 1;
    wantActiveRef.current = false;

    const ws = wsRef.current;
    wsRef.current = null;
    audioChunkCountRef.current = 0;

    if (endpointTimerRef.current) {
      clearTimeout(endpointTimerRef.current);
      endpointTimerRef.current = null;
    }
    accumulatedUtteranceRef.current = '';
    hasUnprocessedSpeechRef.current = false;
    isGeneratingResponseRef.current = false;
    speechActiveRef.current = false;

    teardownMedia();

    if (ws) {
      // Detach all listeners before closing so closing events never fire into this or future sessions
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close(1000, 'Normal Closure');
      } catch {
        // ignore
      }
    }

    setIsActive(false);
    setIsListening(false);
  }, [teardownMedia]);

  /**
   * Trigger response generation for the complete sentence.
   * Dispatches input_audio_buffer.commit and response.create once the speaker has finished.
   */
  const triggerResponseGeneration = useCallback(() => {
    const ws = wsRef.current;
    if (!wantActiveRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (!hasUnprocessedSpeechRef.current) return;
    if (isGeneratingResponseRef.current) return;

    const sentenceToProcess = accumulatedUtteranceRef.current.trim();
    console.log('🚀 [Realtime Endpointing] Complete sentence captured, triggering response:', sentenceToProcess);

    isGeneratingResponseRef.current = true;
    hasUnprocessedSpeechRef.current = false;
    accumulatedUtteranceRef.current = '';

    setStatusText('Thinking & Generating…');
    onSpeechStoppedRef.current?.();

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
      console.error('❌ response.create failed:', err);
      isGeneratingResponseRef.current = false;
      setStatusText('Listening to speaker output…');
    }
  }, []);

  /**
   * Schedule audio endpointing check:
   * Detects natural pauses after speech stops and triggers response generation
   * only after the sentence has completed without interrupting active speech.
   */
  const scheduleEndpointCheck = useCallback(() => {
    if (endpointTimerRef.current) {
      clearTimeout(endpointTimerRef.current);
      endpointTimerRef.current = null;
    }

    if (isGeneratingResponseRef.current) {
      return;
    }

    const currentText = accumulatedUtteranceRef.current.trim();
    // Check if the sentence has completed with terminal punctuation
    const hasPunctuation = /[.?!]$/.test(currentText);

    // If the sentence ends with terminal punctuation (. ? !), 600ms pause confirms conclusion.
    // If it ends without punctuation (potential mid-sentence hesitation), wait 1000ms
    // to give the speaker adequate time to continue speaking without premature cutoff.
    const waitMs = hasPunctuation ? 600 : 1000;

    setStatusText('Checking complete sentence…');

    endpointTimerRef.current = setTimeout(() => {
      endpointTimerRef.current = null;
      if (speechActiveRef.current) {
        console.log('🗣️ [Realtime Endpointing] Speech resumed during wait, skipping trigger.');
        return;
      }
      triggerResponseGeneration();
    }, waitMs);
  }, [triggerResponseGeneration]);

  const attachSpeakerAudioPipeline = useCallback(
    (stream: MediaStream, captureContext: AudioContext, ws: WebSocket) => {
      const source = captureContext.createMediaStreamSource(stream);

      // DSP Filter 1: 85Hz Highpass cuts out low-frequency rumble, table thumps, HVAC hum
      const highpass = captureContext.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 85;

      // DSP Filter 2: 4500Hz Lowpass cuts high-frequency hiss, fan whine, electrical noise
      const lowpass = captureContext.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 4500;

      // DSP Filter 3: DynamicsCompressor balances speaker loudness and stabilizes input levels
      const compressor = captureContext.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 30;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      const processor = captureContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
      const mute = captureContext.createGain();
      mute.gain.value = 0;

      sourceNodeRef.current = source;
      processorRef.current = processor;
      muteNodeRef.current = mute;

      // Chain: source -> highpass -> lowpass -> compressor -> processor -> mute -> destination
      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(compressor);
      compressor.connect(processor);
      processor.connect(mute);
      mute.connect(captureContext.destination);

      processor.onaudioprocess = (event) => {
        if (!wantActiveRef.current) return;
        if (wsRef.current !== ws || ws.readyState !== WebSocket.OPEN) return;
        if (captureContext.state !== 'running') {
          void captureContext.resume();
          return;
        }

        const channel = event.inputBuffer.getChannelData(0);

        // Noise gate check: compute RMS to ignore quiet background whispers/clicks
        let sumSquares = 0;
        for (let i = 0; i < channel.length; i++) {
          sumSquares += channel[i] * channel[i];
        }
        const rms = Math.sqrt(sumSquares / channel.length);
        if (rms < 0.004) {
          // Low background room noise; skip streaming to keep silence clean
          return;
        }

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
          console.error('❌ Failed to append speaker audio:', err);
        }
      };

      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          console.warn('🔊 Audio track ended unexpectedly');
          setStatusText('');
          wantActiveRef.current = false;
          cleanup();
        };
      });
    },
    [cleanup]
  );

  const start = useCallback(async () => {
    if (wantActiveRef.current) return;

    const currentSessionId = ++sessionIdRef.current;
    wantActiveRef.current = true;
    setIsActive(true);
    setIsListening(true);
    setStatusText('Connecting to audio…');

    let stream: MediaStream | null = null;
    let captureContext: AudioContext | null = null;

    try {
      // 1. Directly acquire noise-suppressed audio stream (starts immediately)
      stream = await captureAudioStream();

      // Check if user clicked to turn OFF while stream was initializing
      if (!wantActiveRef.current || sessionIdRef.current !== currentSessionId) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      captureContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = captureContext;
      if (captureContext.state === 'suspended') {
        await captureContext.resume();
      }

      // Check cancellation again
      if (!wantActiveRef.current || sessionIdRef.current !== currentSessionId) {
        stream.getTracks().forEach((t) => t.stop());
        void captureContext.close();
        return;
      }

      const apiKey = import.meta.env.VITE_API_KEY;
      if (!apiKey) {
        throw new Error('Missing VITE_API_KEY');
      }

      const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`, [
        'realtime',
        `openai-insecure-api-key.${apiKey}`
      ]);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!wantActiveRef.current || sessionIdRef.current !== currentSessionId || !captureContext || !stream) {
          try {
            ws.close(1000, 'Normal Closure');
          } catch {}
          return;
        }

        console.log('✅ Realtime WS connected');
        setIsActive(true);
        setIsListening(true);
        setStatusText('Listening to speaker speech…');

        attachSpeakerAudioPipeline(stream, captureContext, ws);
        ws.send(JSON.stringify(buildGaSessionUpdate(instructionsRef.current)));
      };

      ws.onmessage = (event) => {
        if (!wantActiveRef.current || sessionIdRef.current !== currentSessionId) return;
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case 'session.created':
            case 'session.updated':
              console.log('📡', msg.type);
              break;

            case 'input_audio_buffer.speech_started':
              console.log('🗣️ [Realtime VAD] Speaker speech started');
              speechActiveRef.current = true;
              hasUnprocessedSpeechRef.current = true;
              if (endpointTimerRef.current) {
                clearTimeout(endpointTimerRef.current);
                endpointTimerRef.current = null;
                console.log('⏳ [Realtime VAD] Cancelled endpoint timer — speaker resumed speaking');
              }
              setStatusText('Listening to speaker speech…');
              break;

            case 'conversation.item.input_audio_transcription.delta':
              if (msg.delta) {
                hasUnprocessedSpeechRef.current = true;
                if (endpointTimerRef.current) {
                  clearTimeout(endpointTimerRef.current);
                  endpointTimerRef.current = null;
                }
                onUserTranscriptDeltaRef.current?.(msg.delta);
              }
              break;

            case 'conversation.item.input_audio_transcription.completed':
            case 'conversation.item.input_audio_transcription.done': {
              const transcript = msg.transcript?.trim();
              if (transcript) {
                hasUnprocessedSpeechRef.current = true;
                if (!accumulatedUtteranceRef.current.includes(transcript)) {
                  accumulatedUtteranceRef.current = accumulatedUtteranceRef.current
                    ? `${accumulatedUtteranceRef.current} ${transcript}`
                    : transcript;
                }
                onUserTranscriptRef.current(accumulatedUtteranceRef.current);

                if (!speechActiveRef.current && hasUnprocessedSpeechRef.current) {
                  scheduleEndpointCheck();
                }
              }
              break;
            }

            case 'input_audio_buffer.speech_stopped':
              console.log('🤫 [Realtime VAD] Speech pause detected by VAD');
              speechActiveRef.current = false;
              if (hasUnprocessedSpeechRef.current) {
                scheduleEndpointCheck();
              }
              break;

            case 'response.created':
              isGeneratingResponseRef.current = true;
              setStatusText('Generating response…');
              onAssistantTurnStartRef.current();
              break;

            case 'response.output_text.delta':
              if (msg.delta) {
                onAssistantDeltaRef.current(msg.delta);
              }
              break;

            case 'response.done':
            case 'response.cancelled':
              console.log('✅ [Realtime] Response finished');
              isGeneratingResponseRef.current = false;
              onAssistantTurnEndRef.current?.();
              setStatusText('Listening to speaker output…');

              if (hasUnprocessedSpeechRef.current && !speechActiveRef.current) {
                scheduleEndpointCheck();
              }
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
        if (!wantActiveRef.current || sessionIdRef.current !== currentSessionId) return;
        console.error('❌ Realtime WS error', err);
      };

      ws.onclose = (event) => {
        // If closed intentionally by user turning it off or session changed, cleanly ignore
        if (!wantActiveRef.current || sessionIdRef.current !== currentSessionId) {
          return;
        }

        console.warn('🛑 Realtime WS closed unexpectedly', event.code, event.reason || '(no reason)');
        wsRef.current = null;
        teardownMedia();
        setIsActive(false);
        setIsListening(false);
        wantActiveRef.current = false;
        setStatusText(`Disconnected (${event.code}). Click to restart.`);
      };
    } catch (err: any) {
      if (sessionIdRef.current !== currentSessionId) return;
      console.error('❌ Failed to start Realtime listening:', err);
      wantActiveRef.current = false;
      setIsActive(false);
      setIsListening(false);
      setStatusText(err?.message || 'Could not start audio listening');
      cleanup();
    }
  }, [attachSpeakerAudioPipeline, cleanup, scheduleEndpointCheck, teardownMedia]);

  const stop = useCallback(() => {
    wantActiveRef.current = false;
    sessionIdRef.current += 1;
    setStatusText('');
    setIsActive(false);
    setIsListening(false);
    cleanup();
  }, [cleanup]);

  const toggle = useCallback(() => {
    if (wantActiveRef.current || isActive) {
      stop();
    } else {
      void start();
    }
  }, [isActive, start, stop]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && wantActiveRef.current) {
        void ensureSpeakerAudioRunning();
      }
    };
    const onFocus = () => {
      if (wantActiveRef.current) {
        void ensureSpeakerAudioRunning();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [ensureSpeakerAudioRunning]);

  useEffect(() => {
    return () => {
      wantActiveRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  return {
    isActive,
    isListening,
    statusText,
    start,
    stop,
    toggle
  };
};
