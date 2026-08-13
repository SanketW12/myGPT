import { useEffect } from 'react';

interface UseKeyboardShortcutsProps {
  isRecording: boolean;
  isInitializing: boolean;
  isProcessingScreenshot: boolean;
  isAreaCaptureMode: boolean;
  isRealtime: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onTakeScreenshot: () => void;
  onEnterAreaCaptureMode: () => void;
  onStartRealtime: () => void;
  onToggleListening: () => void;
}

export const useKeyboardShortcuts = ({
  isRecording,
  isInitializing,
  isProcessingScreenshot,
  isAreaCaptureMode,
  isRealtime,
  onStartRecording,
  onStopRecording,
  onTakeScreenshot,
  onEnterAreaCaptureMode,
  onStartRealtime,
  onToggleListening
}: UseKeyboardShortcutsProps) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isTyping = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName);

      // Window Movement (Arrow Keys)
      if (e.key.startsWith('Arrow')) {
        const direction = e.key.replace('Arrow', '').toLowerCase();
        if (window.Main?.handleDirection) {
          e.preventDefault();
          window.Main.handleDirection(direction);
        }
        return;
      }

      // Block letter shortcuts if typing
      if (isTyping) return;

      const key = e.key.toLowerCase();

      // Old mic: K start, P stop
      if (key === 'k') {
        if (!isRecording && !isInitializing && !isRealtime) {
          console.log('⌨️ [RENDERER] "K" pressed - Starting old mic');
          onStartRecording();
        }
        return;
      }

      if (key === 'p') {
        if (isRecording) {
          console.log('⌨️ [RENDERER] "P" pressed - Stopping old mic');
          onStopRecording();
        }
        return;
      }

      // Realtime: Space starts session, or toggles listening ON/OFF while active.
      // Full stop is mic-icon only.
      if (e.code === 'Space' || key === ' ') {
        e.preventDefault();
        if (isInitializing || isRecording) return;
        if (isRealtime) {
          console.log('⌨️ [RENDERER] Space pressed - Toggle listening');
          onToggleListening();
        } else {
          console.log('⌨️ [RENDERER] Space pressed - Starting Realtime');
          onStartRealtime();
        }
        return;
      }

      if (key === 'q') {
        if (!isProcessingScreenshot) {
          console.log('⌨️ [RENDERER] "Q" pressed - Taking screenshot');
          onTakeScreenshot();
        }
        return;
      }

      if (key === 's') {
        if (!isAreaCaptureMode && !isProcessingScreenshot) {
          console.log('⌨️ [RENDERER] "S" pressed - Entering area capture mode');
          onEnterAreaCaptureMode();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isRecording,
    isInitializing,
    isProcessingScreenshot,
    isAreaCaptureMode,
    isRealtime,
    onStartRecording,
    onStopRecording,
    onTakeScreenshot,
    onEnterAreaCaptureMode,
    onStartRealtime,
    onToggleListening
  ]);
};
