/* eslint-disable jsx-a11y/media-has-caption */
/* eslint-disable react/no-array-index-key */
/* eslint-disable react/react-in-jsx-scope */
import React, { useRef, useEffect } from 'react';
import { AreaScreenshot } from './AreaScreenshot';

import { useChat } from '../hooks/useChat';
import { useAudioRecording } from '../hooks/useAudioRecording';
import { useScreenshot } from '../hooks/useScreenshot';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

import { MessageList } from './chat/MessageList';
import { InputArea } from './chat/InputArea';
import { ChatHeader } from './chat/ChatHeader';
import { ScreenshotModal } from './chat/ScreenshotModal';
import { LiveTranscriptionModal } from './chat/LiveTranscriptionModal';

import { useRealtimeTranscription } from '../hooks/useLiveTranscription';

export default function ChatUI() {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Chat Logic
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
    clearChat
  } = useChat();

  // 2. Audio Logic (Whisper File-based)
  const {
    isRecording: isRecordingSystem,
    isInitializing,
    startRecording: startSystemRecording,
    stopRecording: stopSystemRecording
  } = useAudioRecording({
    onTranscriptionComplete: (text) => {
      // Provide visual feedback by setting input temporarily? 
      // Or just send it. Original logic did setInput then handleSend.
      // handleSend clears input anyway.
      handleSend(text);
    }
  });

  // 2.5 Live Transcription Logic (Realtime/Streaming)
  const [liveTranscript, setLiveTranscript] = React.useState('');

  const {
    isRecording: isLive,
    start: startLive,
    stop: stopLive
  } = useRealtimeTranscription({
    onPartial: (delta) => {
      console.log('🎯 [ChatUI] onPartial called with delta:', delta);
      // Only update the live transcript display, not the input box
      setLiveTranscript((prev) => prev + delta);
      console.log('📝 [ChatUI] Updated liveTranscript');
    },
    onFinal: (text) => {
      console.log('🎯 [ChatUI] onFinal called with text:', text);
      // Clear live transcript display after a short delay or immediately when segment finishes
      // setLiveTranscript(''); 
      // Actually, let's keep it until the next segment or stop?
      // For now, allow it to accumulate or clear? 
      // If we clear it here, the "Live UI" might flicker empty between sentences.
      // Let's clear it only when recording stops?
      // Or maybe just let it grow.
      // Ideally reset it when `start` is called? 
      // But `start` is called once for the session.
      // Let's reset `liveTranscript` when silence is detected? 
      // Simplified: Just accumulate it for the "current thought" visualization.
    }
  });

  // Clear live transcript when recording stops
  useEffect(() => {
    if (!isLive) {
      const timer = setTimeout(() => setLiveTranscript(''), 1000); // clear after 1s
      return () => clearTimeout(timer);
    }
  }, [isLive]);

  // 3. Screenshot Logic
  const {
    isProcessing: isProcessingScreenshot,
    isAreaCaptureMode,
    setIsAreaCaptureMode,
    showModal: showScreenshotModal,
    screenshotDataUrl,
    takeFullScreenScreenshot: takeScreenshot,
    captureForDownload: handleDownloadScreenshot,
    downloadScreenshot,
    closeScreenshotModal,
    handleAreaCapture
  } = useScreenshot({
    onOCRComplete: (text) => {
      handleSend(text);
    },
    onImageCaptured: (dataUrl) => {
      // Wait a tick ensures UI is unmounted/ready? 
      // Original code had a explicit setTimeout(..., 0) inside the component callback.
      // The hook just passes dataUrl back.
      handleSendImage(dataUrl);
    }
  });

  // 4. Keyboard Shortcuts
  useKeyboardShortcuts({
    isRecording: isRecordingSystem,
    isInitializing,
    isProcessingScreenshot,
    isAreaCaptureMode,
    onStartRecording: startSystemRecording,
    onStopRecording: stopSystemRecording,
    onTakeScreenshot: takeScreenshot,
    onEnterAreaCaptureMode: () => setIsAreaCaptureMode(true)
  });

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  return (
    <div className="flex flex-col h-screen w-full bg-gray-900/90 text-white font-sans antialiased overflow-hidden">

      {/* Area Screenshot Overlay */}
      {isAreaCaptureMode && (
        <AreaScreenshot
          onCapture={(blob) => {
            console.log("📸 [ChatUI] Area capture received. Blob size:", blob.size);
            // Process blob to dataURL
            const reader = new FileReader();
            reader.onloadend = () => {
              const dataUrl = reader.result as string;
              handleAreaCapture(dataUrl);
            };
            reader.readAsDataURL(blob);
          }}
          onCancel={() => {
            console.log("📸 [ChatUI] Area capture cancelled");
            setIsAreaCaptureMode(false);
          }}
        />
      )}

      {/* Screenshot Preview Modal */}
      <ScreenshotModal
        screenshotDataUrl={screenshotDataUrl}
        onClose={closeScreenshotModal}
        onDownload={downloadScreenshot}
      />

      {/* Live Transcription Modal */}
      <LiveTranscriptionModal
        isVisible={isLive}
        transcript={liveTranscript}
        onClose={stopLive}
      />

      {/* Header */}
      <ChatHeader
        messageCount={messages.length}
        useAssistantAPI={useAssistantAPI}
        setUseAssistantAPI={setUseAssistantAPI}
        clearChat={clearChat}
      />

      {/* Messages */}
      <MessageList
        messages={messages}
        loading={loading}
        messagesEndRef={messagesEndRef}
      />

      {/* Input & Controls */}
      <InputArea
        input={input}
        setInput={setInput}
        handleSend={() => handleSend()}
        loading={loading}
        stopGeneration={stopGeneration}
        isRecording={isRecordingSystem}
        startRecording={startSystemRecording}
        stopRecording={stopSystemRecording}
        isLive={isLive}
        startLive={startLive}
        stopLive={stopLive}
        isProcessingScreenshot={isProcessingScreenshot}
        isAreaCaptureMode={isAreaCaptureMode}
        onEnterAreaCaptureMode={() => setIsAreaCaptureMode(true)}
      />
    </div>
  );
}
