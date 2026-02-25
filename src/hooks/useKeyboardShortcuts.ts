import { useEffect } from 'react';

interface UseKeyboardShortcutsProps {
  isRecording: boolean;
  isInitializing: boolean;
  isProcessingScreenshot: boolean;
  isAreaCaptureMode: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onTakeScreenshot: () => void;
  onEnterAreaCaptureMode: () => void;
}

export const useKeyboardShortcuts = ({
  isRecording,
  isInitializing,
  isProcessingScreenshot,
  isAreaCaptureMode,
  onStartRecording,
  onStopRecording,
  onTakeScreenshot,
  onEnterAreaCaptureMode
}: UseKeyboardShortcutsProps) => {

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // console.log('🔑 [DEBUG] Key pressed:', e.key, 'Target:', (e.target as HTMLElement).tagName);

      const isTyping = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName);
      
      // Window Movement (Arrow Keys)
      if (e.key.startsWith('Arrow')) {
        const direction = e.key.replace('Arrow', '').toLowerCase();
        // console.log(`🔑 [DEBUG] Arrow${direction} detected`);
        
        if (window.Main?.handleDirection) {
           e.preventDefault();
           window.Main.handleDirection(direction);
           // console.log(`⌨️ [RENDERER] Arrow ${direction} - Moving window`);
        }
        return;
      }

      // Block letter shortcuts if typing
      if (isTyping) return;

      const key = e.key.toLowerCase();

      if (key === 'l') {
        if (!isRecording && !isInitializing) {
          console.log('⌨️ [RENDERER] "L" pressed - Starting recording');
          onStartRecording();
        }
      } else if (key === 'p') {
        if (isRecording) {
            console.log('⌨️ [RENDERER] "P" pressed - Stopping recording');
            onStopRecording();
        }
      } else if (key === 'q') {
        if (!isProcessingScreenshot) {
            console.log('⌨️ [RENDERER] "Q" pressed - Taking screenshot');
            onTakeScreenshot();
        }
      } else if (key === 's') {
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
    onStartRecording, 
    onStopRecording, 
    onTakeScreenshot, 
    onEnterAreaCaptureMode
  ]);
};
