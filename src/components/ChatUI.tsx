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
    stop: stopRealtime,
    toggleListening
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
    onOCRComplete: (text) => {
      handleSend(text);
    },
    onImageCaptured: (dataUrl) => {
      handleSendImage(dataUrl);
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
    onToggleListening: toggleListening
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  return (
    <div className="flex flex-col h-screen w-full bg-gray-900/50 text-white font-sans antialiased overflow-hidden">
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
        handleSend={() => handleSend()}
        loading={loading}
        stopGeneration={stopGeneration}
        isRecording={isRecordingSystem}
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
    </div>
  );
}
