import { useEffect, useRef, useCallback } from 'react';

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
  // Use refs so event handlers always access the freshest state
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;

  const isInitializingRef = useRef(isInitializing);
  isInitializingRef.current = isInitializing;

  const isRealtimeRef = useRef(isRealtime);
  isRealtimeRef.current = isRealtime;

  const onStartRecordingRef = useRef(onStartRecording);
  onStartRecordingRef.current = onStartRecording;

  const onStopRecordingRef = useRef(onStopRecording);
  onStopRecordingRef.current = onStopRecording;

  const recordingStartTimeRef = useRef<number>(0);
  const shiftDownWithoutOtherKeyRef = useRef<boolean>(false);
  const lastToggleTimeRef = useRef<number>(0);

  // Toggle audio listening mode (Start if not recording, Stop & Send if recording)
  const handleToggleRecording = useCallback((source: string) => {
    const now = Date.now();
    // Debounce triggers within 150ms to avoid duplicate hardware event signals
    if (now - lastToggleTimeRef.current < 150) {
      console.log(`⏱️ Ignored rapid toggle from "${source}" within 150ms`);
      return;
    }
    lastToggleTimeRef.current = now;

    if (isInitializingRef.current || isRealtimeRef.current) {
      return;
    }

    if (!isRecordingRef.current) {
      console.log(`⌨️ [RENDERER] "${source}" triggered - Starting voice listening (recording)`);
      recordingStartTimeRef.current = Date.now();
      onStartRecordingRef.current();
    } else {
      const elapsed = Date.now() - recordingStartTimeRef.current;
      // Minimal grace period (100ms) to prevent accidental immediate double triggers
      if (elapsed < 100) {
        return;
      }
      console.log(`⌨️ [RENDERER] "${source}" triggered - Stopping recording and sending directly to chat`);
      onStopRecordingRef.current();
    }
  }, []);

  // Listen for native Fn key events sent from the Electron main process
  useEffect(() => {
    if (window.Main?.on) {
      const unsubscribe = window.Main.on('fn-key-pressed', () => {
        handleToggleRecording('Fn (native)');
      });
      return () => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      };
    }
  }, [handleToggleRecording]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore automatic OS repeats when holding a key down
      if (e.repeat) return;

      // Shift Key: Start audio listening mode & Send request (single button toggle)
      if (e.key === 'Shift') {
        // If already recording, pressing Shift immediately stops recording and sends to chat
        if (isRecordingRef.current) {
          e.preventDefault();
          handleToggleRecording('Shift');
          return;
        }

        // If not recording:
        const isTyping = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName);
        const inputVal = isTyping ? ((e.target as HTMLInputElement).value || '') : '';

        // If not typing or input is empty, start recording immediately on keydown
        if (!isTyping || inputVal.trim() === '') {
          e.preventDefault();
          handleToggleRecording('Shift');
          return;
        } else {
          // If input has text, mark Shift as down so releasing it alone can toggle
          shiftDownWithoutOtherKeyRef.current = true;
          return;
        }
      } else {
        // Any other key pressed while Shift is held down (e.g. typing capital letters) clears the flag
        shiftDownWithoutOtherKeyRef.current = false;
      }

      // Fn / Function / Globe key detection in browser DOM
      const isFnKey =
        e.key === 'Fn' ||
        e.key === 'FnLock' ||
        e.key === 'Globe' ||
        e.code === 'Fn' ||
        e.code === 'Globe' ||
        (e as any).keyCode === 63 ||
        (e as any).which === 63;

      if (isFnKey) {
        e.preventDefault();
        handleToggleRecording('Fn (DOM)');
        return;
      }

      const isTyping = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName);

      // Window Movement (Arrow Keys when not typing)
      if (!isTyping && e.key.startsWith('Arrow')) {
        const direction = e.key.replace('Arrow', '').toLowerCase();
        if (window.Main?.handleDirection) {
          e.preventDefault();
          window.Main.handleDirection(direction);
          return;
        }
      }

      // Block letter shortcuts if typing in input/textarea
      if (isTyping) return;

      const key = e.key.toLowerCase();

      // Mic shortcuts: K start, P stop
      if (key === 'k') {
        if (!isRecordingRef.current && !isInitializingRef.current && !isRealtimeRef.current) {
          console.log('⌨️ [RENDERER] "K" pressed - Starting recording');
          onStartRecordingRef.current();
        }
        return;
      }

      if (key === 'p') {
        if (isRecordingRef.current) {
          console.log('⌨️ [RENDERER] "P" pressed - Stopping recording');
          onStopRecordingRef.current();
        }
        return;
      }

      // Realtime: Space starts session, or toggles listening ON/OFF while active.
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

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        if (shiftDownWithoutOtherKeyRef.current) {
          shiftDownWithoutOtherKeyRef.current = false;
          handleToggleRecording('Shift (tap)');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
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
    onToggleListening,
    handleToggleRecording
  ]);
};
