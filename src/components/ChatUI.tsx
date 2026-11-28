/* eslint-disable jsx-a11y/media-has-caption */
/* eslint-disable react/react-in-jsx-scope */
import React, { useRef, useEffect } from 'react';
import { AreaScreenshot } from './AreaScreenshot';

import { useChat } from '../hooks/useChat';
import { useAudioRecording } from '../hooks/useAudioRecording';
import { useScreenshot } from '../hooks/useScreenshot';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useRealtimeConversation } from '../hooks/useRealtimeConversation';

import { MessageList } from './chat/MessageList';
import { InputArea } from './chat/InputArea';
import { ChatHeader } from './chat/ChatHeader';
import { ScreenshotModal } from './chat/ScreenshotModal';

export default function ChatUI() {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    input,
    setInput,
    attachedImage,
    setAttachedImage,
    loading,
    useAssistantAPI,
    setUseAssistantAPI,
    handleSend,
    handleSendImage,
    stopGeneration,
    clearChat,
    systemPrompt,
    addRealtimeUserMessage,
    appendRealtimeUserDelta,
    markRealtimeThinking,
    beginRealtimeAssistantTurn,
    appendRealtimeAssistantDelta,
    finishRealtimeAssistantTurn
  } = useChat();

  const {
    isRecording: isRecordingSystem,
    isInitializing,
    isTranscribing,
    startRecording: startSystemRecording,
    stopRecording: stopSystemRecording
  } = useAudioRecording({
    onTranscriptionComplete: (text) => {
      handleSend(text);
    }
  });

  const {
    isActive: isRealtime,
    isListening,
    statusText: realtimeStatus,
    start: startRealtime,
    stop: stopRealtime
  } = useRealtimeConversation({
    instructions: systemPrompt,
    onUserTranscript: addRealtimeUserMessage,
    onUserTranscriptDelta: appendRealtimeUserDelta,
    onSpeechStopped: markRealtimeThinking,
    onAssistantTurnStart: beginRealtimeAssistantTurn,
    onAssistantDelta: appendRealtimeAssistantDelta,
    onAssistantTurnEnd: finishRealtimeAssistantTurn
  });

  const {
    isProcessing: isProcessingScreenshot,
    isAreaCaptureMode,
    setIsAreaCaptureMode,
    screenshotDataUrl,
    takeFullScreenScreenshot: takeScreenshot,
    downloadScreenshot,
    closeScreenshotModal,
    handleAreaCapture
  } = useScreenshot({
    onImageCaptured: (dataUrl) => {
      setAttachedImage(dataUrl);
    }
  });

  useKeyboardShortcuts({
    isRecording: isRecordingSystem,
    isInitializing,
    isProcessingScreenshot,
    isAreaCaptureMode,
    isRealtime,
    onStartRecording: startSystemRecording,
    onStopRecording: stopSystemRecording,
    onTakeScreenshot: takeScreenshot,
    onEnterAreaCaptureMode: () => setIsAreaCaptureMode(true),
    onStartRealtime: startRealtime,
    onStopRealtime: stopRealtime
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Handler for cursor corner-drag resizing (reduce or expand window)
  const handleCornerResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    let prevX = Number.isFinite(e.screenX) ? e.screenX : e.clientX;
    let prevY = Number.isFinite(e.screenY) ? e.screenY : e.clientY;
    if (!Number.isFinite(prevX) || !Number.isFinite(prevY)) return;

    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch (_) { }

    document.body.classList.add('resizing-window');
    document.body.style.cursor = 'default';
    document.documentElement.style.cursor = 'default';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const currentX = Number.isFinite(moveEvent.screenX) ? moveEvent.screenX : moveEvent.clientX;
      const currentY = Number.isFinite(moveEvent.screenY) ? moveEvent.screenY : moveEvent.clientY;
      if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) return;

      const deltaX = currentX - prevX;
      const deltaY = currentY - prevY;
      prevX = currentX;
      prevY = currentY;
      if (Number.isFinite(deltaX) && Number.isFinite(deltaY) && (deltaX !== 0 || deltaY !== 0)) {
        window?.Main?.resizeWindow?.(deltaX, deltaY);
      }
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      try {
        target.releasePointerCapture(upEvent.pointerId);
      } catch (_) { }
      document.body.classList.remove('resizing-window');
      document.body.style.cursor = 'default';
      document.documentElement.style.cursor = 'default';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-gray-900/50 text-white font-sans antialiased overflow-hidden relative">
      {isAreaCaptureMode && (
        <AreaScreenshot
          onCapture={(blob) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const dataUrl = reader.result as string;
              handleAreaCapture(dataUrl);
            };
            reader.readAsDataURL(blob);
          }}
          onCancel={() => {
            setIsAreaCaptureMode(false);
          }}
        />
      )}

      <ScreenshotModal
        screenshotDataUrl={screenshotDataUrl}
        onClose={closeScreenshotModal}
        onDownload={downloadScreenshot}
      />

      <ChatHeader
        messageCount={messages.length}
        useAssistantAPI={useAssistantAPI}
        setUseAssistantAPI={setUseAssistantAPI}
        clearChat={clearChat}
      />

      <MessageList
        messages={messages}
        loading={loading}
        messagesEndRef={messagesEndRef}
      />

      <InputArea
        input={input}
        setInput={setInput}
        attachedImage={attachedImage}
        onRemoveAttachment={() => setAttachedImage(null)}
        handleSend={() => handleSend()}
        loading={loading}
        stopGeneration={stopGeneration}
        isRecording={isRecordingSystem}
        isTranscribing={isTranscribing}
        startRecording={startSystemRecording}
        stopRecording={stopSystemRecording}
        isRealtime={isRealtime}
        isListening={isListening}
        realtimeStatus={realtimeStatus}
        startRealtime={startRealtime}
        stopRealtime={stopRealtime}
        isProcessingScreenshot={isProcessingScreenshot}
        isAreaCaptureMode={isAreaCaptureMode}
        onEnterAreaCaptureMode={() => setIsAreaCaptureMode(true)}
      />

      {/* Interactive Bottom-Right Corner Resize Handle */}
      <div
        className="undraggable resize-handle absolute bottom-0 right-0 w-6 h-6 cursor-default !cursor-default z-50 flex items-end justify-end p-1 text-gray-500 hover:text-white transition-colors select-none"
        style={{ WebkitAppRegion: 'no-drag', cursor: 'default' } as React.CSSProperties}
        title="Drag corner to reduce or expand window size"
        onPointerDown={handleCornerResizeStart}
      >
        <svg
          className="w-3.5 h-3.5 opacity-60 hover:opacity-100 pointer-events-none cursor-default"
          style={{ cursor: 'default' }}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <line x1="14" y1="6" x2="6" y2="14" strokeLinecap="round" />
          <line x1="14" y1="10" x2="10" y2="14" strokeLinecap="round" />
          <line x1="14" y1="14" x2="14" y2="14" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
