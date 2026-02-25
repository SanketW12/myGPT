import { useCallback, useRef, useState } from 'react';

interface UseRealtimeTranscriptionProps {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  language?: string;
}

export const useRealtimeTranscription = ({ onPartial, onFinal, language = 'en' }: UseRealtimeTranscriptionProps) => {
  const [isRecording, setIsRecording] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /* ----------------------------------------
     FLOAT32 → INT16 PCM
  -----------------------------------------*/
  const floatTo16BitPCM = (input: Float32Array) => {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    let offset = 0;

    for (let i = 0; i < input.length; i++, offset += 2) {
      let sample = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return buffer;
  };

  /* ----------------------------------------
     START RECORDING
  -----------------------------------------*/
  const start = useCallback(async () => {
    if (isRecording) return;

    // 0️⃣ Get microphone stream FIRST (before WebSocket)
    // This prevents WS timeout while waiting for permission
    let stream: MediaStream;
    try {
      console.log('🎤 Requesting microphone access...');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      console.log('✅ Microphone accessed');
    } catch (err) {
      console.error('❌ Failed to access microphone:', err);
      return;
    }

    // 1️⃣ WebSocket to OpenAI Realtime
    const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17', [
      'realtime',
      'openai-insecure-api-key.' + import.meta.env.VITE_API_KEY,
      'openai-beta.realtime-v1'
    ]);

    wsRef.current = ws;

    ws.onopen = async () => {
      console.log('✅ Realtime WS connected');
      setIsRecording(true);

      // 2️⃣ Init Audio Context (after WS is ready)
      const audioContext = new AudioContext({ sampleRate: 24000 }); // OpenAI Realtime prefers 24kHz
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(1024, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(audioContext.destination);

      // Buffer to accumulate 1 second of audio
      let audioBuffer: Int16Array[] = [];
      let lastSendTime = Date.now();
      const SEND_INTERVAL_MS = 1000; // Send every 1 second

      // 3️⃣ Accumulate and send audio frames every 1 second
      processor.onaudioprocess = (event) => {
        if (ws.readyState !== WebSocket.OPEN) return;

        const float32 = event.inputBuffer.getChannelData(0);
        const pcm16Buffer = floatTo16BitPCM(float32);
        const int16Array = new Int16Array(pcm16Buffer);

        // Accumulate audio data
        audioBuffer.push(int16Array);

        const now = Date.now();
        const elapsed = now - lastSendTime;

        // Send accumulated audio every 1 second
        if (elapsed >= SEND_INTERVAL_MS && audioBuffer.length > 0) {
          // Combine all buffered chunks
          const totalLength = audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
          const combined = new Int16Array(totalLength);
          let offset = 0;

          for (const chunk of audioBuffer) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }

          // Convert to base64
          const uint8Array = new Uint8Array(combined.buffer);
          const base64Audio = btoa(String.fromCharCode(...uint8Array));

          console.log(
            `📤 Sending ${audioBuffer.length} audio chunks (${totalLength} samples, ~${(elapsed / 1000).toFixed(1)}s)`
          );

          ws.send(
            JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: base64Audio
            })
          );

          // Reset buffer and timer
          audioBuffer = [];
          lastSendTime = now;
        }
      };

      // 4️⃣ Send Initial Configuration
      const configMessage = {
        type: 'session.update',
        session: {
          modalities: ['text'], // We only want text output, not audio
          instructions: 'You are a helpful assistant that transcribes audio.',
          input_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'whisper-1'
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.45,
            prefix_padding_ms: 0,
            silence_duration_ms: 0
          }
        }
      };

      console.log('📤 Sending session config:', configMessage);
      try {
        ws.send(JSON.stringify(configMessage));
      } catch (e) {
        console.error('Error sending config:', e);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('📩 WS Message:', msg.type, msg); // Full message log

        switch (msg.type) {
          case 'conversation.item.input_audio_transcription.completed':
            console.log('✅ Input transcription completed:', msg.transcript);
            if (msg.transcript) onFinal(msg.transcript);
            break;
          case 'conversation.item.input_audio_transcription.delta':
            console.log('🔤 Input delta:', msg.delta);
            if (msg.delta) onPartial(msg.delta);
            break;
          case 'error':
            console.error('❌ Server Error:', msg.error);
            break;
          default:
            console.log('ℹ️ Other message type:', msg.type);
        }
      } catch (e) {
        console.error('Error parsing WS message', e);
      }
    };

    ws.onerror = (e) => {
      console.error('❌ Realtime WS error', e);
      setIsRecording(false);
    };

    ws.onclose = () => {
      console.log('🛑 Realtime WS closed');
      setIsRecording(false);
    };
  }, [isRecording, language, onPartial, onFinal]);

  /* ----------------------------------------
     STOP RECORDING
  -----------------------------------------*/
  const stop = useCallback(() => {
    processorRef.current?.disconnect();
    audioContextRef.current?.close();

    streamRef.current?.getTracks().forEach((t) => t.stop());

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }

    processorRef.current = null;
    audioContextRef.current = null;
    streamRef.current = null;
    wsRef.current = null;

    setIsRecording(false);
  }, []);

  return {
    isRecording,
    start,
    stop
  };
};
