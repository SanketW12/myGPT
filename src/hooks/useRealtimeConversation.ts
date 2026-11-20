import { useCallback, useEffect, useRef, useState } from 'react';
import { JAVA_FULL_STACK_REALTIME_RULES } from '../prompts/javaFullStackDeveloper';

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

// Build instructions for live incoming primary speaker audio monitoring
const buildRealtimeInstructions = (instructions: string) => {
  return `${instructions.trim()}

${JAVA_FULL_STACK_REALTIME_RULES}`;
};

// Set of isolated filler tokens and short vocal reactions to reject
const FILLER_TOKENS = new Set([
  'ok', 'okay', 'k', 'kay', 'okie', 'okies',
  'hmm', 'hm', 'hmmm', 'mhm', 'mmhmm', 'mm-hmm', 'mm',
  'uh', 'um', 'ah', 'er', 'erm', 'eh',
  'yeah', 'yep', 'yes', 'yup', 'nope', 'no', 'nah',
  'right', 'alright', 'sure', 'cool', 'fine', 'nice', 'great', 'good', 'perfect', 'awesome',
  'oh', 'whoa', 'huh', 'oops', 'wow', 'ha', 'haha', 'gotcha', 'like', 'well', 'so',
  'actually', 'basically', 'hello', 'hi', 'hey', 'bye', 'goodbye', 'thanks', 'thank'
]);

// Multi-word conversational acknowledgment / filler phrases
const FILLER_PHRASES = new Set([
  'got it',
  'i see',
  'sounds good',
  'makes sense',
  'thank you',
  'thanks a lot',
  'all right',
  'you know',
  'fair enough',
  'no problem',
  'understood',
  'okay yeah',
  'yeah okay',
  'right okay',
  'uh huh',
  'uh yeah',
  'hmm okay',
  'ok cool',
  'alright cool',
  'good to know'
]);

// Common grammatical stop words that carry no substantive technical weight alone
const GRAMMAR_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my',
  'you', 'your', 'we', 'our', 'he', 'him', 'she', 'her', 'they', 'them'
]);

/**
 * Validates whether transcribed audio represents clear, meaningful speech from the primary speaker
 * rather than background noise artifacts, isolated conversational fillers ("OK", "Hmm", "Uh"), or ambient murmurs.
 */
export const isMeaningfulPrimarySpeech = (rawText: string): boolean => {
  if (!rawText) return false;

  // 1. Strip transcription non-verbal tags like [laughter], [cough], (whispering), etc.
  const cleaned = rawText
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-zA-Z0-9\s?]/g, ' ')
    .trim()
    .toLowerCase();

  if (!cleaned) return false;

  // 2. Check against multi-word filler/acknowledgment phrases
  const normalizedPhrase = cleaned.replace(/\s+/g, ' ').replace(/\?/g, '').trim();
  if (FILLER_PHRASES.has(normalizedPhrase)) {
    return false;
  }

  // 3. Tokenize into words
  const tokens = normalizedPhrase.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  // 4. Check if every single token is a filler token
  const allFillers = tokens.every((token) => FILLER_TOKENS.has(token));
  if (allFillers) {
    return false;
  }

  // 5. Extract substantive words (not fillers and not purely grammatical stops)
  const substantiveWords = tokens.filter(
    (token) => !FILLER_TOKENS.has(token) && !GRAMMAR_STOP_WORDS.has(token)
  );

  // If no substantive words remain, it carries no meaningful speech content
  if (substantiveWords.length === 0) {
    return false;
  }

  // An isolated 1 substantive word with at most 2 tokens is usually an isolated reaction/fragment,
  // unless it contains a question mark indicating a question
  if (substantiveWords.length === 1 && tokens.length <= 2 && !rawText.includes('?')) {
    return false;
  }

  return true;
};

/**
 * Configure Realtime session:
 * - Near-field neural noise reduction: rejects background noise and secondary voices.
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
        noise_reduction: {
          type: 'near_field'
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

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: SAMPLE_RATE,
  ...(typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
    ? { voiceIsolation: true as any }
    : {})
};

/**
 * Capture primary speaker audio stream with hardware & OS-level acoustic noise suppression,
 * echo cancellation, and voice isolation enabled.
 */
const captureSpeakerAudioStream = async (): Promise<MediaStream> => {
  // 1. Primary: Use getDisplayMedia to capture system audio loopback (interviewer / meeting speaker)
  try {
    console.log('🔊 [Realtime] Requesting system/speaker audio via getDisplayMedia...');
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: AUDIO_CONSTRAINTS
    });

    const audioTracks = displayStream.getAudioTracks();
    console.log(
      `🔊 [Realtime] getDisplayMedia provided ${audioTracks.length} audio track(s):`,
      audioTracks.map((t) => t.label)
    );

    // Stop and discard video tracks immediately so no screen video is captured or processed
    displayStream.getVideoTracks().forEach((track) => {
      track.stop();
    });

    if (audioTracks.length > 0) {
      const track = audioTracks[0];
      try {
        await track.applyConstraints?.(AUDIO_CONSTRAINTS);
      } catch {
        // ignore if applyConstraints is not supported
      }
      return new MediaStream([track]);
    }
  } catch (err) {
    console.warn('⚠️ [Realtime] getDisplayMedia audio capture failed or cancelled:', err);
  }

  // 2. Fallback: Search for virtual loopback devices (e.g. Teams Audio, BlackHole, Loopback, Stereo Mix)
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === 'audioinput');
    const loopbackDevice = audioInputs.find((d) =>
      /loopback|blackhole|soundflower|stereo mix|virtual|cable|teams/i.test(d.label)
    );

    if (loopbackDevice) {
      console.log(`🔊 [Realtime] Using virtual loopback device: ${loopbackDevice.label}`);
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: loopbackDevice.deviceId },
          ...AUDIO_CONSTRAINTS
        }
      });
    }
  } catch (err) {
    console.warn('⚠️ [Realtime] Virtual loopback check failed:', err);
  }

  // 3. Fallback: Default system audio input with pristine noise suppression & voice isolation
  try {
    console.log('🔊 [Realtime] Fallback to primary audio input device with noise suppression...');
    return await navigator.mediaDevices.getUserMedia({
      audio: AUDIO_CONSTRAINTS
    });
  } catch (err) {
    console.warn('⚠️ [Realtime] Standard audio fallback failed:', err);
  }

  throw new Error('Could not access audio stream. Please check audio permissions.');
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
  const hasSurfacedTranscriptRef = useRef<boolean>(false);
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
    startingRef.current = false;
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
    hasSurfacedTranscriptRef.current = false;
    isGeneratingResponseRef.current = false;
    speechActiveRef.current = false;

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

  /**
   * Trigger response generation for the complete sentence.
   * Dispatches input_audio_buffer.commit and response.create once the primary speaker has finished.
   */
  const triggerResponseGeneration = useCallback(() => {
    const ws = wsRef.current;
    if (!wantActiveRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (!hasUnprocessedSpeechRef.current) return;
    if (isGeneratingResponseRef.current) return;

    const sentenceToProcess = accumulatedUtteranceRef.current.trim();

    // Verify the accumulated speech is meaningful primary speech and not filler reactions or noise
    if (!isMeaningfulPrimarySpeech(sentenceToProcess)) {
      console.log('🔇 [Realtime Endpointing] Aborting response — utterance is non-meaningful / isolated filler:', sentenceToProcess);
      hasUnprocessedSpeechRef.current = false;
      accumulatedUtteranceRef.current = '';
      hasSurfacedTranscriptRef.current = false;
      setStatusText('Listening to primary speaker…');
      return;
    }

    console.log('🚀 [Realtime Endpointing] Meaningful primary speaker sentence captured, triggering response:', sentenceToProcess);

    isGeneratingResponseRef.current = true;
    hasUnprocessedSpeechRef.current = false;
    accumulatedUtteranceRef.current = '';
    hasSurfacedTranscriptRef.current = false;

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
      setStatusText('Listening to primary speaker…');
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
    if (!currentText) return;

    // If text is not meaningful primary speech (isolated fillers/noise), ignore it
    if (!isMeaningfulPrimarySpeech(currentText)) {
      console.log('🔇 [Realtime Endpointing] Discarding non-meaningful speech during check:', currentText);
      accumulatedUtteranceRef.current = '';
      hasUnprocessedSpeechRef.current = false;
      hasSurfacedTranscriptRef.current = false;
      setStatusText('Listening to primary speaker…');
      return;
    }

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
      // 1. Source from audio stream
      const source = captureContext.createMediaStreamSource(stream);

      // 2. Highpass filter: Eliminates sub-vocal rumble, 50/60Hz AC hum, desk bumps below 110Hz
      const highpass = captureContext.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 110;
      highpass.Q.value = 0.707;

      // 3. Lowpass filter: Eliminates high-frequency hiss, electronic whine, ultrasonic clicks above 7500Hz
      const lowpass = captureContext.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 7500;
      lowpass.Q.value = 0.707;

      // 4. Voice Formant Clarity Peaking Filter: Accentuates primary vocal intelligibility band ~1800Hz
      const clarity = captureContext.createBiquadFilter();
      clarity.type = 'peaking';
      clarity.frequency.value = 1800;
      clarity.Q.value = 1.0;
      clarity.gain.value = 3.5;

      // 5. Dynamics Compressor: Levels voice dynamics, preventing sudden ambient spikes from saturating
      const compressor = captureContext.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.15;

      // 6. ScriptProcessor for software noise gate & PCM streaming
      const processor = captureContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
      const mute = captureContext.createGain();
      mute.gain.value = 0;

      sourceNodeRef.current = source;
      processorRef.current = processor;
      muteNodeRef.current = mute;

      // Connect DSP chain
      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(clarity);
      clarity.connect(compressor);
      compressor.connect(processor);
      processor.connect(mute);
      mute.connect(captureContext.destination);

      // Adaptive Noise Floor & Primary Speaker Energy Gate
      let adaptiveNoiseFloor = 0.008;
      const MIN_SPEECH_RMS = 0.016; // Absolute minimum threshold for human speech
      const HANGOVER_FRAMES = 5; // ~425ms hangover keeps natural sentence endings intact
      let hangoverRemaining = 0;

      processor.onaudioprocess = (event) => {
        if (!wantActiveRef.current) return;
        if (wsRef.current !== ws || ws.readyState !== WebSocket.OPEN) return;
        if (captureContext.state !== 'running') {
          void captureContext.resume();
          return;
        }

        const channel = event.inputBuffer.getChannelData(0);
        const copy = new Float32Array(channel.length);
        copy.set(channel);

        // Compute RMS energy of current audio buffer
        let sumSquares = 0;
        for (let i = 0; i < copy.length; i++) {
          sumSquares += copy[i] * copy[i];
        }
        const rms = Math.sqrt(sumSquares / copy.length);

        // Adapt noise floor during quiet periods
        if (rms < adaptiveNoiseFloor * 1.5) {
          adaptiveNoiseFloor = adaptiveNoiseFloor * 0.95 + rms * 0.05;
        } else if (rms < 0.03) {
          adaptiveNoiseFloor = adaptiveNoiseFloor * 0.998 + rms * 0.002;
        }

        // Dynamic threshold must exceed adaptive noise floor by 2.2x
        const dynamicThreshold = Math.max(MIN_SPEECH_RMS, adaptiveNoiseFloor * 2.2);
        const isVoiceActive = rms >= dynamicThreshold;

        if (isVoiceActive) {
          hangoverRemaining = HANGOVER_FRAMES;
        } else if (hangoverRemaining > 0) {
          hangoverRemaining--;
        }

        const shouldPassAudio = isVoiceActive || hangoverRemaining > 0;

        // If audio is below primary speaker threshold (ambient noise, background chatter, typing),
        // zero out buffer so the server receives pure digital silence.
        if (!shouldPassAudio) {
          copy.fill(0);
        }

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
          console.warn('🔊 Speaker audio track ended unexpectedly');
          setStatusText('Speaker audio disconnected');
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
    setIsListening(true);
    setStatusText('Connecting to primary speaker audio…');

    let stream: MediaStream | null = null;
    let captureContext: AudioContext | null = null;

    try {
      captureContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = captureContext;
      await captureContext.resume();

      if (!wantActiveRef.current || intentionalCloseRef.current) {
        cleanup();
        return;
      }

      // Capture audio stream
      stream = await captureSpeakerAudioStream();

      // Check if user stopped while audio stream was initializing
      if (!wantActiveRef.current || intentionalCloseRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        cleanup();
        return;
      }

      streamRef.current = stream;

      const audioTrack = stream.getAudioTracks()[0];
      console.log('🔊 Connected primary speaker audio track:', audioTrack?.label, 'state:', audioTrack?.readyState);

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
        if (!wantActiveRef.current || intentionalCloseRef.current || !captureContext || !stream) {
          try {
            ws.close();
          } catch {}
          cleanup();
          return;
        }

        console.log('✅ Realtime WS connected (primary speaker voice isolation with intelligent endpointing)');
        setIsActive(true);
        setIsListening(true);
        setStatusText('Listening to primary speaker…');
        startingRef.current = false;

        attachSpeakerAudioPipeline(stream, captureContext, ws);
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
              // If an endpoint timer was counting down on a pause, cancel it immediately!
              if (endpointTimerRef.current) {
                clearTimeout(endpointTimerRef.current);
                endpointTimerRef.current = null;
                console.log('⏳ [Realtime VAD] Cancelled endpoint timer — speaker resumed speaking');
              }
              setStatusText('Listening to primary speaker speech…');
              break;

            case 'conversation.item.input_audio_transcription.delta':
              if (msg.delta) {
                if (endpointTimerRef.current) {
                  clearTimeout(endpointTimerRef.current);
                  endpointTimerRef.current = null;
                }
                const tentative = `${accumulatedUtteranceRef.current} ${msg.delta}`.trim();
                // Only stream delta to UI once tentative transcript represents meaningful speech
                if (isMeaningfulPrimarySpeech(tentative)) {
                  hasUnprocessedSpeechRef.current = true;
                  if (!hasSurfacedTranscriptRef.current) {
                    hasSurfacedTranscriptRef.current = true;
                    onUserTranscriptRef.current(tentative);
                  } else {
                    onUserTranscriptDeltaRef.current?.(msg.delta);
                  }
                }
              }
              break;

            case 'conversation.item.input_audio_transcription.completed':
            case 'conversation.item.input_audio_transcription.done': {
              const transcript = msg.transcript?.trim();
              if (transcript) {
                const combined = accumulatedUtteranceRef.current
                  ? (accumulatedUtteranceRef.current.includes(transcript)
                      ? accumulatedUtteranceRef.current
                      : `${accumulatedUtteranceRef.current} ${transcript}`.trim())
                  : transcript;

                // Reject isolated filler words, reactions, and background noise
                if (!isMeaningfulPrimarySpeech(combined)) {
                  console.log('🔇 [Realtime Filter] Filtered out non-meaningful speech / isolated filler:', combined);
                  accumulatedUtteranceRef.current = '';
                  hasUnprocessedSpeechRef.current = false;
                  hasSurfacedTranscriptRef.current = false;
                  if (endpointTimerRef.current) {
                    clearTimeout(endpointTimerRef.current);
                    endpointTimerRef.current = null;
                  }
                  setStatusText('Listening to primary speaker…');
                } else {
                  accumulatedUtteranceRef.current = combined;
                  hasUnprocessedSpeechRef.current = true;
                  hasSurfacedTranscriptRef.current = true;
                  onUserTranscriptRef.current(combined);

                  // If speech has already paused, schedule endpoint check with finalized text
                  if (!speechActiveRef.current) {
                    scheduleEndpointCheck();
                  }
                }
              }
              break;
            }

            case 'input_audio_buffer.speech_stopped':
              console.log('🤫 [Realtime VAD] Speech pause detected by VAD');
              speechActiveRef.current = false;
              if (hasUnprocessedSpeechRef.current && isMeaningfulPrimarySpeech(accumulatedUtteranceRef.current)) {
                scheduleEndpointCheck();
              } else if (accumulatedUtteranceRef.current && !isMeaningfulPrimarySpeech(accumulatedUtteranceRef.current)) {
                console.log('🔇 [Realtime VAD] Speech ended but utterance was not meaningful, resetting:', accumulatedUtteranceRef.current);
                accumulatedUtteranceRef.current = '';
                hasUnprocessedSpeechRef.current = false;
                hasSurfacedTranscriptRef.current = false;
                setStatusText('Listening to primary speaker…');
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
              // Continues listening to primary speaker until user disables this mode!
              setStatusText('Listening to primary speaker…');

              // If new speech was detected while the response was concluding, schedule check
              if (hasUnprocessedSpeechRef.current && !speechActiveRef.current && isMeaningfulPrimarySpeech(accumulatedUtteranceRef.current)) {
                scheduleEndpointCheck();
              }
              break;

            case 'error': {
              const errMsg = msg.error?.message || JSON.stringify(msg.error);
              console.error('❌ Realtime server error:', msg.error);
              if (/noise_reduction/i.test(errMsg)) {
                console.warn('⚠️ Realtime noise_reduction error, retrying session without noise_reduction...');
                try {
                  const fallback = buildGaSessionUpdate(instructionsRef.current);
                  delete (fallback.session.audio.input as any).noise_reduction;
                  ws.send(JSON.stringify(fallback));
                } catch {}
              }
              const recoverable =
                /buffer|cancel|already|empty|too small|no active response|noise_reduction/i.test(errMsg || '');
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

        if (!wasIntentional && wantActiveRef.current) {
          wantActiveRef.current = false;
          setStatusText(`Disconnected (${event.code}). Click to restart.`);
        } else {
          wantActiveRef.current = false;
          setStatusText('');
        }
      };
    } catch (err: any) {
      console.error('❌ Failed to start Realtime primary speaker listening:', err);
      wantActiveRef.current = false;
      startingRef.current = false;
      setStatusText(err?.message || 'Could not start primary speaker audio listening');
      cleanup();
    }
  }, [attachSpeakerAudioPipeline, cleanup, scheduleEndpointCheck, teardownMedia]);

  const stop = useCallback(() => {
    console.log('🛑 [Realtime] Stopping Realtime immediately in one go');
    wantActiveRef.current = false;
    startingRef.current = false;
    intentionalCloseRef.current = true;
    setStatusText('');
    setIsActive(false);
    setIsListening(false);
    cleanup();
  }, [cleanup]);

  const toggle = useCallback(() => {
    if (wantActiveRef.current || startingRef.current || wsRef.current || isActive || isListening) {
      stop();
    } else {
      void start();
    }
  }, [start, stop, isActive, isListening]);

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
