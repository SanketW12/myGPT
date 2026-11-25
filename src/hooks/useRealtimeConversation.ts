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

/**
 * Evaluates whether a transcript represents clear, meaningful speech from the primary speaker,
 * or if it is merely background noise, acoustic artifacts, or isolated filler reactions (e.g., "OK", "Hmm", "Uh").
 */
const isMeaningfulPrimarySpeech = (text: string): boolean => {
  if (!text) return false;
  const clean = text.trim();
  if (clean.length < 2) return false;

  // Filter out transcription hallucination tags like [Music], [Laughter], [Applause], (Clears throat), etc.
  if (/^(\[[^\]]+\]|\([^\)]+\)|\*+[^*]+\*+)$/i.test(clean)) {
    return false;
  }

  // Normalize punctuation and lower-case
  const normalized = clean.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, '');

  // Isolated filler words, interjections, or passive reactions
  const ISOLATED_FILLERS = new Set([
    'ok', 'okay', 'k',
    'hmm', 'hmmm', 'hm',
    'uh', 'um', 'uhh', 'umm',
    'ah', 'ahh',
    'yeah', 'yep', 'yup', 'yea',
    'right', 'alright', 'all right',
    'sure',
    'oh', 'ooh',
    'huh', 'whoa', 'wow',
    'mhm', 'uh-huh', 'uh-oh',
    'ha', 'haha', 'hehe',
    'hello', 'hi', 'hey',
    'bye', 'goodbye',
    'thanks', 'thank you',
    'test', 'testing',
    'yes', 'no'
  ]);

  if (ISOLATED_FILLERS.has(normalized)) {
    return false;
  }

  // Check word count: isolated 1-word non-technical responses are discarded
  const words = clean.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 1) {
    const singleWord = normalized;
    // Allow single words only if they are substantive technical keywords or explicit query commands
    const TECHNICAL_QUERY_KEYWORDS = new Set([
      'explain', 'clarify', 'elaborate', 'continue', 'reconcile',
      'docker', 'kubernetes', 'typescript', 'javascript', 'react', 'redux', 'nextjs',
      'architecture', 'hydrate', 'memoize', 'debounce', 'throttle'
    ]);
    if (!TECHNICAL_QUERY_KEYWORDS.has(singleWord)) {
      return false;
    }
  }

  // Must contain alphabetic speech content
  if (!/[a-zA-Z]/.test(clean)) {
    return false;
  }

  return true;
};

// Build instructions for live voice listening focusing on the primary speaker
const buildRealtimeInstructions = (instructions: string) => {
  return `${instructions.trim()}

### 🎯 PRIMARY SPEAKER AUDIO FILTERING & INTERACTION RULES:
- Focus EXCLUSIVELY on the primary speaker's clear and meaningful human speech.
- STRICTLY IGNORE background noise, environmental sounds, side conversations, room murmurs, and secondary speakers.
- STRICTLY IGNORE isolated filler words, acknowledgments, or brief reactions such as "OK", "Okay", "Hmm", "Uh", "Um", "Yeah", "Right", "Ah", "Sure", "Haha", "Cough", or random ambient sounds when they are not part of a coherent question or substantive technical discussion.
- Only respond when the primary speaker has expressed a clear, meaningful question, prompt, or technical statement.
- If the incoming audio is just background noise, chatter, or isolated filler words without substantive context, DO NOT generate a response.
- Reply with TEXT ONLY (no audio output).
- Follow the mandatory response structure: lead with the Direct Answer, followed by a concrete Real-World Example from 5 years of production experience.`;
};

/**
 * Configure Realtime session:
 * - Server VAD with strict threshold (0.65) and far_field noise reduction to eliminate background chatter and noise.
 * - silence_duration_ms: 600ms waits for natural thought pauses.
 * - create_response: false -> Prevents premature server responses; client endpointing validates meaningful speech before response.create.
 * - interrupt_response: false -> Prevents premature interruption.
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
        noise_reduction: {
          type: 'far_field'
        },
        transcription: {
          model: 'gpt-4o-mini-transcribe'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.65,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
          create_response: false,
          interrupt_response: false
        }
      }
    }
  }
});

/**
 * Capture primary speaker voice stream with maximum noise filtering and voice isolation.
 * Directly activates primary microphone with native hardware echo cancellation,
 * noise suppression, and auto gain control (zero screen-share picker popups).
 */
const capturePrimaryAudioStream = async (): Promise<MediaStream> => {
  // 1. Check for dedicated virtual loopback audio devices (e.g., BlackHole, Teams, Soundflower, Loopback)
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === 'audioinput');
    const loopbackDevice = audioInputs.find((d) =>
      /loopback|blackhole|soundflower|stereo mix|virtual|cable|teams/i.test(d.label)
    );

    if (loopbackDevice) {
      console.log(`🔊 [Realtime] Found loopback audio device: ${loopbackDevice.label}`);
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: loopbackDevice.deviceId },
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    }
  } catch (err) {
    console.warn('⚠️ [Realtime] Loopback device check failed:', err);
  }

  // 2. Directly capture primary microphone with full voice isolation (instant single-click activation)
  console.log('🎤 [Realtime] Directly activating primary microphone with voice isolation');
  return await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: SAMPLE_RATE,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
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

  // Web Audio DSP filter nodes
  const highpassRef = useRef<BiquadFilterNode | null>(null);
  const lowpassRef = useRef<BiquadFilterNode | null>(null);
  const voicePresenceRef = useRef<BiquadFilterNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);

  // Audio endpointing & sentence accumulation state
  const accumulatedUtteranceRef = useRef<string>('');
  const hasUnprocessedSpeechRef = useRef<boolean>(false);
  const isGeneratingResponseRef = useRef<boolean>(false);
  const speechActiveRef = useRef<boolean>(false);
  const endpointTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  const ensureAudioRunning = useCallback(async () => {
    const ctx = audioContextRef.current;
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
        console.log('🔊 AudioContext resumed');
      } catch (err) {
        console.error('❌ Failed to resume AudioContext:', err);
      }
    }
  }, []);

  const teardownMedia = useCallback(() => {
    try {
      highpassRef.current?.disconnect();
    } catch {
      // ignore
    }
    try {
      lowpassRef.current?.disconnect();
    } catch {
      // ignore
    }
    try {
      voicePresenceRef.current?.disconnect();
    } catch {
      // ignore
    }
    try {
      compressorRef.current?.disconnect();
    } catch {
      // ignore
    }
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
    highpassRef.current = null;
    lowpassRef.current = null;
    voicePresenceRef.current = null;
    compressorRef.current = null;
    processorRef.current = null;
    sourceNodeRef.current = null;
    muteNodeRef.current = null;
    streamRef.current = null;

    if (captureContext && captureContext.state !== 'closed') {
      void captureContext.close();
    }
  }, []);

  const cleanup = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    audioChunkCountRef.current = 0;
    startingRef.current = false;

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
      // Detach event listeners so closed sockets never fire into new sessions
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'Normal closure');
        }
      } catch {
        // ignore
      }
    }

    setIsActive(false);
    setIsListening(false);
  }, [teardownMedia]);

  /**
   * Trigger response generation for the verified, meaningful primary speech.
   * Dispatches input_audio_buffer.commit and response.create once speech has concluded.
   */
  const triggerResponseGeneration = useCallback(() => {
    const ws = wsRef.current;
    if (!wantActiveRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (!hasUnprocessedSpeechRef.current) return;
    if (isGeneratingResponseRef.current) return;

    const sentenceToProcess = accumulatedUtteranceRef.current.trim();

    // Verify speech is meaningful and not isolated filler / background noise
    if (!isMeaningfulPrimarySpeech(sentenceToProcess)) {
      console.log('🔇 [Realtime Filter] Ignored non-meaningful speech / isolated filler:', sentenceToProcess);
      accumulatedUtteranceRef.current = '';
      hasUnprocessedSpeechRef.current = false;
      setStatusText('Listening for primary speaker voice…');
      return;
    }

    console.log('🚀 [Realtime Endpointing] Meaningful speech captured, triggering response:', sentenceToProcess);

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
      setStatusText('Listening for primary speaker voice…');
    }
  }, []);

  /**
   * Schedule audio endpointing check:
   * Detects natural pauses after speech stops and triggers response generation
   * only after a complete, meaningful sentence from the primary speaker has concluded.
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
    if (!isMeaningfulPrimarySpeech(currentText)) {
      console.log('🔇 [Realtime Endpointing] Skipping endpoint check for non-meaningful speech:', currentText);
      accumulatedUtteranceRef.current = '';
      hasUnprocessedSpeechRef.current = false;
      setStatusText('Listening for primary speaker voice…');
      return;
    }

    // Check if the sentence has completed with terminal punctuation (. ? !)
    const hasPunctuation = /[.?!]$/.test(currentText);
    const waitMs = hasPunctuation ? 600 : 1000;

    setStatusText('Verifying primary speaker speech…');

    endpointTimerRef.current = setTimeout(() => {
      endpointTimerRef.current = null;
      if (speechActiveRef.current) {
        console.log('🗣️ [Realtime Endpointing] Speech resumed during wait, continuing to listen.');
        return;
      }
      triggerResponseGeneration();
    }, waitMs);
  }, [triggerResponseGeneration]);

  const attachPrimaryAudioPipeline = useCallback(
    (stream: MediaStream, captureContext: AudioContext, ws: WebSocket) => {
      const source = captureContext.createMediaStreamSource(stream);

      // 1. High-pass filter to eliminate sub-audio rumble, AC hum, and table thuds below 85Hz
      const highpass = captureContext.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 85;
      highpass.Q.value = 0.707;
      highpassRef.current = highpass;

      // 2. Low-pass filter to cut out high-frequency electrical hiss and ultrasonic clicks above 7500Hz
      const lowpass = captureContext.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 7500;
      lowpass.Q.value = 0.707;
      lowpassRef.current = lowpass;

      // 3. Peaking voice-presence filter centered at 2.2kHz (+3dB) to enhance human vocal clarity
      const voicePresence = captureContext.createBiquadFilter();
      voicePresence.type = 'peaking';
      voicePresence.frequency.value = 2200;
      voicePresence.Q.value = 1.0;
      voicePresence.gain.value = 3.0;
      voicePresenceRef.current = voicePresence;

      // 4. Dynamics compressor to normalize voice levels and attenuate quiet room reflections
      const compressor = captureContext.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 10;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      compressorRef.current = compressor;

      const processor = captureContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
      const mute = captureContext.createGain();
      mute.gain.value = 0;

      sourceNodeRef.current = source;
      processorRef.current = processor;
      muteNodeRef.current = mute;

      // Audio processing graph
      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(voicePresence);
      voicePresence.connect(compressor);
      compressor.connect(processor);
      processor.connect(mute);
      mute.connect(captureContext.destination);

      // Noise gate threshold: RMS below NOISE_GATE_RMS is treated as environmental silence
      const NOISE_GATE_RMS = 0.015;
      const silentBuffer = new Float32Array(PROCESSOR_BUFFER_SIZE);

      processor.onaudioprocess = (event) => {
        if (!wantActiveRef.current) return;
        if (wsRef.current !== ws || ws.readyState !== WebSocket.OPEN) return;
        if (captureContext.state !== 'running') {
          void captureContext.resume();
          return;
        }

        const channel = event.inputBuffer.getChannelData(0);

        // Compute RMS energy
        let sum = 0;
        for (let i = 0; i < channel.length; i++) {
          sum += channel[i] * channel[i];
        }
        const rms = Math.sqrt(sum / channel.length);

        // Filter out quiet environmental noises, keyboard clicks, breathing, and room hum:
        // If energy is below the primary speech threshold, substitute with clean silence
        const dataToSend = rms >= NOISE_GATE_RMS ? channel : silentBuffer;

        audioChunkCountRef.current += 1;

        try {
          ws.send(
            JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: arrayBufferToBase64(floatTo16BitPCM(dataToSend))
            })
          );
        } catch (err) {
          console.error('❌ Failed to append audio:', err);
        }
      };

      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          console.warn('🔊 Audio track ended unexpectedly');
          setStatusText('Audio disconnected');
          wantActiveRef.current = false;
          cleanup();
        };
      });
    },
    [cleanup]
  );

  const start = useCallback(async () => {
    // If already active or starting, prevent duplicate concurrent starts
    if (wantActiveRef.current || startingRef.current) return;

    // Reset any lingering previous state/audio cleanly before starting fresh
    cleanup();

    startingRef.current = true;
    intentionalCloseRef.current = false;
    wantActiveRef.current = true;
    setIsListening(true);
    setStatusText('Activating real-time voice listening…');

    let stream: MediaStream | null = null;
    let captureContext: AudioContext | null = null;

    try {
      captureContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = captureContext;
      await captureContext.resume();

      // Capture primary speaker audio stream with hardware noise suppression & echo cancellation
      stream = await capturePrimaryAudioStream();
      streamRef.current = stream;

      const audioTrack = stream.getAudioTracks()[0];
      console.log('🔊 Connected primary audio track:', audioTrack?.label, 'state:', audioTrack?.readyState);

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
        if (!wantActiveRef.current || !captureContext || !stream) return;

        console.log('✅ Realtime WS connected (primary speaker voice listening active)');
        setIsActive(true);
        setIsListening(true);
        setStatusText('Listening for primary speaker voice…');
        startingRef.current = false;

        attachPrimaryAudioPipeline(stream, captureContext, ws);
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

            case 'input_audio_buffer.speech_started':
              console.log('🗣️ [Realtime VAD] Primary speaker speech started');
              speechActiveRef.current = true;
              hasUnprocessedSpeechRef.current = true;
              if (endpointTimerRef.current) {
                clearTimeout(endpointTimerRef.current);
                endpointTimerRef.current = null;
                console.log('⏳ [Realtime VAD] Cancelled endpoint timer — speaker resumed speaking');
              }
              setStatusText('Listening to primary speaker…');
              break;

            case 'conversation.item.input_audio_transcription.delta':
              if (msg.delta) {
                hasUnprocessedSpeechRef.current = true;
                if (endpointTimerRef.current) {
                  clearTimeout(endpointTimerRef.current);
                  endpointTimerRef.current = null;
                }
                // Only pass deltas that aren't raw hallucinated brackets
                if (!/^\[.+\]$/.test(msg.delta.trim())) {
                  onUserTranscriptDeltaRef.current?.(msg.delta);
                }
              }
              break;

            case 'conversation.item.input_audio_transcription.completed':
            case 'conversation.item.input_audio_transcription.done': {
              const transcript = msg.transcript?.trim();
              if (transcript) {
                // If standalone transcript is an isolated filler word (e.g. "Hmm", "OK"),
                // and there is no prior accumulated context, discard it
                const isIsolatedFiller = !isMeaningfulPrimarySpeech(transcript) && !accumulatedUtteranceRef.current;
                if (isIsolatedFiller) {
                  console.log('🔇 [Realtime Filter] Discarding isolated filler transcript:', transcript);
                  break;
                }

                hasUnprocessedSpeechRef.current = true;
                // Accumulate completed segment into full sentence
                if (!accumulatedUtteranceRef.current.includes(transcript)) {
                  accumulatedUtteranceRef.current = accumulatedUtteranceRef.current
                    ? `${accumulatedUtteranceRef.current} ${transcript}`
                    : transcript;
                }

                // Only surface to user transcript if utterance has meaningful content
                if (isMeaningfulPrimarySpeech(accumulatedUtteranceRef.current)) {
                  onUserTranscriptRef.current(accumulatedUtteranceRef.current);
                }

                // If speech has already paused, schedule endpoint check with finalized text
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
              setStatusText('Thinking & Generating…');
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
              setStatusText('Listening for primary speaker voice…');

              // If new speech was detected while the response was concluding, schedule check
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
        console.error('❌ Realtime WS error', err);
        setStatusText('Realtime connection error');
      };

      ws.onclose = (event) => {
        console.warn('🛑 Realtime WS closed', event.code, event.reason || '(no reason)');
        // If this event belongs to an old/superseded WebSocket, ignore completely
        if (wsRef.current !== ws && wsRef.current !== null) {
          return;
        }

        wsRef.current = null;
        startingRef.current = false;

        const wasIntentional = intentionalCloseRef.current;
        intentionalCloseRef.current = false;

        teardownMedia();
        setIsActive(false);
        setIsListening(false);

        // 1000 = Normal Closure, 1005 = No Status Received (clean local close). Neither is an error!
        const isCleanClose = event.code === 1000 || event.code === 1005;

        if (!wasIntentional && !isCleanClose && wantActiveRef.current) {
          wantActiveRef.current = false;
          setStatusText(`Disconnected (${event.code}). Click to restart.`);
        } else {
          wantActiveRef.current = false;
          setStatusText('');
        }
      };
    } catch (err: any) {
      console.error('❌ Failed to start Realtime voice listening:', err);
      wantActiveRef.current = false;
      startingRef.current = false;
      setStatusText(err?.message || 'Could not start voice listening');
      cleanup();
    }
  }, [attachPrimaryAudioPipeline, cleanup, scheduleEndpointCheck, teardownMedia]);

  const stop = useCallback(() => {
    wantActiveRef.current = false;
    startingRef.current = false;
    intentionalCloseRef.current = true;
    setStatusText('');
    cleanup();
  }, [cleanup]);

  const toggle = useCallback(() => {
    if (wantActiveRef.current || startingRef.current || isActive || isListening || wsRef.current) {
      stop();
    } else {
      void start();
    }
  }, [isActive, isListening, start, stop]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && wantActiveRef.current) {
        void ensureAudioRunning();
      }
    };
    const onFocus = () => {
      if (wantActiveRef.current) {
        void ensureAudioRunning();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [ensureAudioRunning]);

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
    toggle
  };
};
