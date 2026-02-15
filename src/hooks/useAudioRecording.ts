import { useState, useRef, useCallback } from 'react';
// Removed axios import as we are moving to fetch

interface UseAudioRecordingProps {
  onTranscriptionComplete: (text: string) => void;
}

export const useAudioRecording = ({ onTranscriptionComplete }: UseAudioRecordingProps) => {
  const [isRecordingSystem, setIsRecordingSystem] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const transcribeAudio = async (audioBlob: Blob) => {

    console.log('Transcribing audio...');

    // 2. Switch to OGG Opus extension for file name mostly, type comes from blob
    const file = new File([audioBlob], 'audio.ogg', { type: audioBlob.type });

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('model', 'whisper-1');

      // 3. Use native fetch instead of Axios
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

      const data = await response.json();
      console.log('Transcribed text:', data.text);

      if (data.text && data.text.trim()) {
        onTranscriptionComplete(data.text);
      }
    } catch (error) {
      console.error('Error in transcribing:', error);
      // Optional: Reset UI on error or handle it
      onTranscriptionComplete('Error transcribing audio.');
    }
  };

  const startRecording = useCallback(async () => {
    console.log('🎬 [useAudioRecording] startRecording called');

    if (isInitializing) return;
    setIsInitializing(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('✅ [useAudioRecording] Microphone stream obtained');

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

      mediaRecorder.start();
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
    startRecording,
    stopRecording
  };
};
