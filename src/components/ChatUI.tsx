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
    isActive: isRealtimeActive,
    isListening,
    statusText: realtimeStatus,
    start: startRealtime,
    stop: stopRealtime,
    toggle: toggleRealtime
  } = useRealtimeConversation({
    instructions: systemPrompt,
    onUserTranscript: addRealtimeUserMessage,
    onUserTranscriptDelta: appendRealtimeUserDelta,
    onSpeechStopped: markRealtimeThinking,
    onAssistantTurnStart: beginRealtimeAssistantTurn,
    onAssistantDelta: appendRealtimeAssistantDelta,
    onAssistantTurnEnd: finishRealtimeAssistantTurn
  });

  // Realtime is considered active if actively connected or listening for speaker audio
  const isRealtime = isRealtimeActive || isListening;

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
    // Instant scroll during chat updates prevents browser animation frame drops and stutter
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages, loading]);

  // Handler for cursor corner-drag resizing (reduce or expand window)
  const handleCornerResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    let prevX = e.screenX;
    let prevY = e.screenY;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.screenX - prevX;
      const deltaY = moveEvent.screenY - prevY;
      prevX = moveEvent.screenX;
      prevY = moveEvent.screenY;
      if (deltaX !== 0 || deltaY !== 0) {
        window?.Main?.resizeWindow?.(deltaX, deltaY);
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
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
        className="undraggable absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize z-50 flex items-end justify-end p-1 text-gray-500 hover:text-white transition-colors"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        title="Drag corner with cursor to reduce or expand window size"
        onMouseDown={handleCornerResizeStart}
      >
        <svg
          className="w-3 h-3 opacity-60 hover:opacity-100"
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
