import { useState, useRef, useCallback } from 'react';
import { JAVA_FULL_STACK_WHISPER_PROMPT } from '../prompts/javaFullStackDeveloper';

interface UseAudioRecordingProps {
  onTranscriptionComplete: (text: string) => void;
}

export const useAudioRecording = ({ onTranscriptionComplete }: UseAudioRecordingProps) => {
  const [isRecordingSystem, setIsRecordingSystem] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const transcribeAudio = async (audioBlob: Blob) => {
    console.log('Transcribing audio...');
    setIsTranscribing(true);

    const file = new File([audioBlob], 'audio.ogg', { type: audioBlob.type });

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');
      formData.append('temperature', '0');
      formData.append('response_format', 'text');
      formData.append('prompt', JAVA_FULL_STACK_WHISPER_PROMPT);

      const response = await fetch(
        'https://api.openai.com/v1/audio/transcriptions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_API_KEY}`,
          },
          body: formData
        }
      );

      if (!response.ok) {
        throw new Error(`Transcription failed: ${response.status} ${response.statusText}`);
      }

      const rawText = await response.text();
      let transcribed = rawText.trim();
      try {
        const parsed = JSON.parse(transcribed);
        if (parsed.text) transcribed = parsed.text.trim();
      } catch {
        // Body is already plain text from response_format: 'text'
      }

      console.log('Transcribed text:', transcribed);

      if (transcribed) {
        onTranscriptionComplete(transcribed);
      }
    } catch (error) {
      console.error('Error in transcribing:', error);
      onTranscriptionComplete('Error transcribing audio.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const startRecording = useCallback(async () => {
    console.log('🎬 [useAudioRecording] startRecording called');

    if (isInitializing) return;
    setIsInitializing(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      console.log('✅ [useAudioRecording] Microphone stream obtained with noise suppression');

      // 2. Switch to OGG Opus (preferred)
      let mimeType = 'audio/ogg; codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm; codecs=opus';
      }
      // Fallback for Safari etc if OGG/WebM-Opus not supported? 
      // Usually webm/audio works. But user asked for specific fallback logic.
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        console.warn(`Mime type ${mimeType} not supported, falling back to audio/webm`);
        mimeType = 'audio/webm';
      }

      console.log(`Using MIME type: ${mimeType}`);

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // 4. Start upload IMMEDIATELY on stop (no extra awaits)
      mediaRecorder.onstop = () => {
        console.log('🛑 [useAudioRecording] Recording stopped, processing...');
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });

        stream.getTracks().forEach(track => track.stop());

        if (audioBlob.size > 0) {
          // fire-and-forget
          transcribeAudio(audioBlob);
        }
        setIsInitializing(false);
      };

      mediaRecorder.start(250);
      setIsRecordingSystem(true);
      setIsInitializing(false);
    } catch (error) {
      console.error('❌ [useAudioRecording] Error starting recording:', error);
      setIsInitializing(false);
      setIsRecordingSystem(false);
      alert('Could not access microphone. Please check permissions.');
    }
  }, [isInitializing, onTranscriptionComplete]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecordingSystem(false);
    }
  }, []);

  return {
    isRecording: isRecordingSystem,
    isInitializing,
    isTranscribing,
    startRecording,
    stopRecording
  };
};
