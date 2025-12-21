/* eslint-disable jsx-a11y/media-has-caption */
/* eslint-disable react/no-array-index-key */
/* eslint-disable react/react-in-jsx-scope */
import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, Headphones, Camera, Download, Crop } from 'lucide-react';
import { AreaScreenshot } from './AreaScreenshot';
import axios from 'axios';
import OpenAI from 'openai';
import MarkdownPreview from '@uiw/react-markdown-preview';
import { createWorker } from 'tesseract.js';
import TypingEffect from './TypingEffect';
import TypeLoading from './TypeLoading';
import { getResponse, runAssistant, sendMessage } from '../services';

export default function ChatUI() {
  // Load messages from localStorage on mount
  const [messages, setMessages] = useState<{ role: string; content: string; image?: string }[]>(() => {
    const saved = localStorage.getItem('chatMessages');
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [useAssistantAPI, setUseAssistantAPI] = useState(false); // Toggle between APIs
  const [isRecordingSystem, setIsRecordingSystem] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isProcessingScreenshot, setIsProcessingScreenshot] = useState(false);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [showScreenshotModal, setShowScreenshotModal] = useState(false);
  const [isAreaCaptureMode, setIsAreaCaptureMode] = useState(false);

  // Debug state changes
  useEffect(() => {
    console.log(`🔍 [ChatUI] isAreaCaptureMode changed to: ${isAreaCaptureMode}`);
  }, [isAreaCaptureMode]);


  const model: OpenAI.ChatModel = 'gpt-4o-mini';
  const max_tokens = 1000;

  // Refs for aborting streams
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamRef = useRef<any>(null);

  // Refs for recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const transcribeAudio = async (audioBlob: Blob) => {
    console.log('Transcribing audio...');
    const file = new File([audioBlob], 'system-audio.webm', { type: 'audio/webm' });

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('model', 'whisper-1');

      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        formData,
        {
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_API_KEY}`,
            'Content-Type': 'multipart/form-data'
          }
        }
      );

      const text = response.data.text;
      console.log('Transcribed text:', text);

      if (text && text.trim()) {
        setInput(text);
        handleSend(text);
      }
    } catch (error) {
      console.error('Error in transcribing:', error);
    }
  };

  // Helper function to wait for window.Main to be available
  const waitForElectronAPI = async (timeout = 5000): Promise<boolean> => {
    const startTime = Date.now();
    while (!window.Main) {
      if (Date.now() - startTime > timeout) {
        console.error('❌ [RENDERER] Timeout waiting for window.Main');
        return false;
      }
      console.log('⏳ [RENDERER] Waiting for window.Main...');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log('✅ [RENDERER] window.Main is now available!');
    return true;
  };

  const handleSendImage = async (imageDataUrl: string) => {
    setIsProcessingScreenshot(true);
    setLoading(true);

    // Add user message to UI
    const userMessage = { role: 'user', content: '', image: imageDataUrl };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const openai = new OpenAI({
        apiKey: import.meta.env.VITE_API_KEY,
        dangerouslyAllowBrowser: true
      });

      const systemPrompt = import.meta.env.VITE_SYSTEM_PROMPT ||
        "Give response in humanized format, question may be related to javascript, react or web development";

      const stream = await openai.chat.completions.create({
        model: model, // or 'gpt-4' for better quality


        max_tokens: max_tokens,
        temperature: 0,
        top_p: 0.1,
        presence_penalty: 0,
        frequency_penalty: 0,

        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'This is question of coding or maybe a problem statement, please provide the solution' },
              {
                type: 'image_url',
                image_url: {
                  url: imageDataUrl,
                },
              },
            ],
          },
        ],
        stream: true,
      });

      let assistantMessage = '';
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          assistantMessage += content;
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content: assistantMessage };
              return updated;
            } else {
              return [...prev, { role: 'assistant', content: assistantMessage }];
            }
          });
        }
      }
    } catch (error) {
      console.error('❌ Error sending image to OpenAI:', error);
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Error: Unable to process image with OpenAI.' }]);
    } finally {
      setLoading(false);
      setIsProcessingScreenshot(false);
    }
  };

  const performOCR = async (imageDataUrl: string) => {
    console.log('🔍 Performing OCR...');
    setIsProcessingScreenshot(true);

    try {
      const worker = await createWorker('eng');
      const ret = await worker.recognize(imageDataUrl);
      console.log('OCR Text:', ret.data.text);

      await worker.terminate();

      if (ret.data.text && ret.data.text.trim()) {
        const text = `Screenshot Text:\n${ret.data.text}`;
        // setInput(text); // Optional: set input if you want user to edit
        handleSend(text);
      } else {
        console.log('⚠️ No text found in screenshot');
      }
    } catch (error) {
      console.error('OCR Error:', error);
    } finally {
      setIsProcessingScreenshot(false);
    }
  };

  const takeScreenshot = async () => {
    console.log('📸 Taking screenshot...');
    if (isProcessingScreenshot) return;

    setIsProcessingScreenshot(true);

    try {
      // Get sources
      const sources = await window.Main.getDesktopSources();
      // Find the primary screen (usually the first one or one with 'Screen 1' or similar)
      const screenSource = sources.find((s: any) => s.name.includes('Screen') || s.name.includes('Entire Screen')) || sources[0];

      if (!screenSource) {
        console.error('No screen source found');
        setIsProcessingScreenshot(false);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: screenSource.id,
            minWidth: 1280,
            maxWidth: 4000,
            minHeight: 720,
            maxHeight: 4000
          }
        } as any
      });

      // Create a video element to capture the frame
      const video = document.createElement('video');
      video.srcObject = stream;
      video.onloadedmetadata = async () => {
        video.play();

        // Create canvas to draw the frame
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Stop the stream
          stream.getTracks().forEach(track => track.stop());

          // Convert to image data URL
          const imageDataUrl = canvas.toDataURL('image/png');
          console.log('✅ Full screen screenshot captured successfully! Length:', imageDataUrl.length);

          // Perform OCR
          await performOCR(imageDataUrl);
        } else {
          setIsProcessingScreenshot(false);
        }
      };
    } catch (error) {
      console.error('Error taking screenshot:', error);
      setIsProcessingScreenshot(false);
    }
  };

  const handleDownloadScreenshot = async () => {
    console.log('⬇️ Taking screenshot...');
    try {
      // Request screenshot with thumbnail
      const sources = await window.Main.getDesktopSources({
        fetchThumbnail: true,
        thumbnailSize: { width: 1920, height: 1080 }
      });


      const screenSource = sources.find((s: any) => s.name.includes('Screen') || s.name.includes('Entire Screen')) || sources[0];

      if (screenSource && screenSource.thumbnail) {
        // Store the screenshot and show modal
        setScreenshotDataUrl(screenSource.thumbnail);
        setShowScreenshotModal(true);
        console.log('✅ Screenshot captured and modal opened');
      } else {
        console.error('❌ Failed to get screenshot thumbnail');
      }
    } catch (error) {
      console.error('❌ Error taking screenshot:', error);
    }
  };

  const downloadScreenshot = () => {
    if (screenshotDataUrl) {
      const link = document.createElement('a');
      link.href = screenshotDataUrl;
      link.download = `screenshot-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      console.log('✅ Screenshot download initiated');
    }
  };

  const closeScreenshotModal = () => {
    setShowScreenshotModal(false);
    setScreenshotDataUrl(null);
  };

  const startSystemRecording = async () => {
    console.log('🎬 [RENDERER] startRecording called (Microphone only)');

    if (isInitializing) {
      return;
    }

    setIsInitializing(true);

    try {
      // Directly request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('✅ [RENDERER] Microphone stream obtained');

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        console.log(`🎵 [RENDERER] Using audio track: ${audioTracks[0].label}`);
      }

      // Determine the best MIME type for recording
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm; codecs=opus')) {
        mimeType = 'audio/webm; codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
        mimeType = 'audio/ogg';
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log('🛑 [RENDERER] Recording stopped, processing...');
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());

        if (audioBlob.size > 0) {
          await transcribeAudio(audioBlob);
        }
        setIsInitializing(false);
      };

      mediaRecorder.start();
      setIsRecordingSystem(true);
      setIsInitializing(false);
      console.log('🔴 [RENDERER] Microphone recording started');

    } catch (error) {
      console.error('❌ [RENDERER] Error starting microphone recording:', error);
      setIsInitializing(false);
      setIsRecordingSystem(false);
      alert('Could not access microphone. Please check permissions.');
    }
  };



  const stopGeneration = () => {
    console.log('🛑 Stopping generation...');

    // Stop Assistant API stream
    if (streamRef.current) {
      try {
        streamRef.current.controller.abort();
      } catch (error) {
        console.log('Could not abort stream via controller, trying direct abort');
      }
      streamRef.current = null;
    }

    // Stop Chat Completions API stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setLoading(false);
  };



  const stopSystemRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecordingSystem(false);
    }
  };

  // Debug: Check what's available on window
  useEffect(() => {
    console.log('🔍 [DEBUG] Checking window object...');
    console.log('🔍 [DEBUG] window.Main:', window.Main);
    console.log('🔍 [DEBUG] window keys:', Object.keys(window).filter(k => k.includes('Main') || k.includes('ipc')));
    console.log('🔍 [DEBUG] typeof window.Main:', typeof window.Main);
  }, []);

  // Keyboard shortcuts for recording and window movement
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      console.log('🔑 [DEBUG] Key pressed:', e.key, 'Target:', (e.target as HTMLElement).tagName);

      const isTyping = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName);
      console.log('🔑 [DEBUG] isTyping:', isTyping);

      // Arrow keys for window movement - work even when typing
      if (e.key === 'ArrowUp') {
        console.log('🔑 [DEBUG] ArrowUp detected, calling handleDirection');
        console.log('🔑 [DEBUG] window.Main exists?', !!window.Main);
        console.log('🔑 [DEBUG] window.Main.handleDirection exists?', !!window.Main?.handleDirection);
        e.preventDefault();
        if (window.Main?.handleDirection) {
          window.Main.handleDirection('up');
          console.log('⌨️ [RENDERER] Arrow Up - Moving window up');
        } else {
          console.error('❌ [RENDERER] window.Main.handleDirection is not available. Preload script may not be loaded.');
        }
        return;
      } else if (e.key === 'ArrowDown') {
        console.log('🔑 [DEBUG] ArrowDown detected, calling handleDirection');
        e.preventDefault();
        if (window.Main?.handleDirection) {
          window.Main.handleDirection('down');
          console.log('⌨️ [RENDERER] Arrow Down - Moving window down');
        } else {
          console.error('❌ [RENDERER] window.Main.handleDirection is not available.');
        }
        return;
      } else if (e.key === 'ArrowLeft') {
        console.log('🔑 [DEBUG] ArrowLeft detected, calling handleDirection');
        e.preventDefault();
        if (window.Main?.handleDirection) {
          window.Main.handleDirection('left');
          console.log('⌨️ [RENDERER] Arrow Left - Moving window left');
        } else {
          console.error('❌ [RENDERER] window.Main.handleDirection is not available.');
        }
        return;
      } else if (e.key === 'ArrowRight') {
        console.log('🔑 [DEBUG] ArrowRight detected, calling handleDirection');
        e.preventDefault();
        if (window.Main?.handleDirection) {
          window.Main.handleDirection('right');
          console.log('⌨️ [RENDERER] Arrow Right - Moving window right');
        } else {
          console.error('❌ [RENDERER] window.Main.handleDirection is not available.');
        }
        return;
      }

      // Don't trigger letter shortcuts if user is typing in an input or textarea
      if (isTyping) {
        console.log('🔑 [DEBUG] Blocking letter shortcuts - user is typing');
        return;
      }

      if (e.key.toLowerCase() === 'l') {
        if (!isRecordingSystem && !isInitializing) {
          console.log('⌨️ [RENDERER] "L" pressed - Starting recording');
          startSystemRecording();
        }
      } else if (e.key.toLowerCase() === 'p') {
        if (isRecordingSystem) {
          console.log('⌨️ [RENDERER] "P" pressed - Stopping recording');
          stopSystemRecording();
        }
      } else if (e.key.toLowerCase() === 'q') {
        if (!isProcessingScreenshot) {
          console.log('⌨️ [RENDERER] "Q" pressed - Taking screenshot');
          takeScreenshot();
        }
      } else if (e.key.toLowerCase() === 's') {
        if (!isAreaCaptureMode && !isProcessingScreenshot) {
          console.log('⌨️ [RENDERER] "S" pressed - Entering area capture mode');
          setIsAreaCaptureMode(true);
        }
      }
    };

    console.log('🔑 [DEBUG] Keyboard event listener registered');
    console.log('🔑 [DEBUG] window.Main available at mount?', !!window.Main);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      console.log('🔑 [DEBUG] Keyboard event listener removed');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRecordingSystem, isInitializing, isProcessingScreenshot, isAreaCaptureMode]);

  // Save messages to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);



  // ============ UNIFIED SEND HANDLER ============
  const handleSend = async (text?: string) => {
    if (useAssistantAPI) {
      await handleSendWithAssistant(text);
    } else {
      await handleSendWithChatCompletions(text);
    }
  };

  // ============ ASSISTANTS API IMPLEMENTATION ============
  const handleSendWithAssistant = async (text?: string) => {
    const messageText = text || input;
    if (!messageText.trim()) return;

    const userMessage = { role: 'user', content: messageText };
    setMessages((prev) => [...prev, userMessage]);
    const currentInput = messageText;
    setInput('');
    setLoading(true);

    try {
      console.log('🚀 Starting handleSend with Assistants API...');

      // Initialize OpenAI client
      const openai = new OpenAI({
        apiKey: import.meta.env.VITE_API_KEY,
        dangerouslyAllowBrowser: true // Required for browser/Electron
      });

      console.log('✅ OpenAI client initialized');

      // Send message to thread
      await sendMessage(currentInput);
      console.log('✅ Message sent to thread');

      const threadId = import.meta.env.VITE_THREAD_ID;
      const assistantId = import.meta.env.VITE_ASSISTANT_ID;

      console.log('📋 Thread ID:', threadId);
      console.log('📋 Assistant ID:', assistantId);

      // Create a streaming run using OpenAI SDK
      console.log('🌊 Creating stream...');
      const stream = openai.beta.threads.runs.stream(threadId, {
        assistant_id: assistantId
      });
      streamRef.current = stream;

      console.log('✅ Stream created:', stream);

      let assistantMessage = '';

      // Listen to streaming events
      stream
        .on('textCreated', () => {
          console.log('🎯 EVENT: textCreated - Assistant started responding...');
          // Add empty assistant message when streaming starts
          setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
        })
        .on('textDelta', (textDelta) => {
          console.log('📝 EVENT: textDelta - Received chunk:', textDelta.value);
          // Update message in real-time as chunks arrive
          assistantMessage += textDelta.value;

          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            // If last message is from assistant, update it
            if (lastMsg && lastMsg.role === 'assistant') {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: 'assistant',
                content: assistantMessage
              };
              return updated;
            } else {
              // Otherwise append new assistant message
              return [...prev, { role: 'assistant', content: assistantMessage }];
            }
          });
        })
        .on('textDone', () => {
          console.log('✅ EVENT: textDone - Assistant finished responding');
          setLoading(false);
        })
        .on('messageDone', (message) => {
          console.log('📬 EVENT: messageDone', message);
        })
        .on('runStepDone', (runStep) => {
          console.log('👣 EVENT: runStepDone', runStep);
        })
        .on('end', () => {
          console.log('🏁 EVENT: Stream ended');
        })
        .on('error', (error) => {
          console.error('❌ EVENT: Stream error:', error);
          setLoading(false);
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: 'Error: Unable to get response.' }
          ]);
        });

      console.log('⏳ Waiting for stream to complete...');
      // Wait for the stream to complete
      const finalRun = await stream.finalRun();
      console.log('✅ Stream completed. Final run:', finalRun);
    } catch (error) {
      console.error('❌ Error in handleSend:', error);
      setLoading(false);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Error: Unable to get response.' }
      ]);
    }
  };

  // OPTION 2: Using Chat Completions API (FASTER alternative)
  const handleSendWithChatCompletions = async (text?: string) => {
    const messageText = text || input;
    if (!messageText.trim()) return;

    const userMessage = { role: 'user', content: messageText };
    setMessages((prev) => [...prev, userMessage]);
    const currentInput = messageText;
    setInput('');
    setLoading(true);

    try {
      console.log('🚀 Starting handleSend with Chat Completions...');

      // Initialize OpenAI client
      const openai = new OpenAI({
        apiKey: import.meta.env.VITE_API_KEY,
        dangerouslyAllowBrowser: true
      });

      // System prompt - Add your assistant's instructions here
      const systemPrompt = import.meta.env.VITE_SYSTEM_PROMPT ||
        "You are a helpful AI assistant. Be concise, friendly, and accurate in your responses.";

      // Build conversation history with system message
      const conversationMessages = [
        { role: 'system' as const, content: systemPrompt },
        ...messages.map(msg => ({
          role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: msg.content
        })),
        { role: 'user' as const, content: currentInput }
      ];

      console.log('🌊 Creating chat completion stream...');

      // Create AbortController for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Create streaming chat completion
      const stream = await openai.chat.completions.create({
        model: model, // or 'gpt-4' for better quality
        messages: conversationMessages,
        stream: true,
        max_tokens: max_tokens,
        temperature: 0,
        top_p: 0.1,
        presence_penalty: 0,
        frequency_penalty: 0
      }, { signal: controller.signal });

      let assistantMessage = '';
      let messageAdded = false;

      // Process the stream
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';

        if (content) {
          assistantMessage += content;
          console.log('📝 Received chunk:', content);

          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: 'assistant',
                content: assistantMessage
              };
              return updated;
            } else {
              return [...prev, { role: 'assistant', content: assistantMessage }];
            }
          });
        }
      }

      console.log('✅ Stream completed');
      setLoading(false);
    } catch (error) {
      console.error('❌ Error in handleSend:', error);
      setLoading(false);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Error: Unable to get response.' }
      ]);
    }
  };
  console.log(messages);

  // Clear chat history
  const clearChat = () => {
    setMessages([]);
    localStorage.removeItem('chatMessages');
  };


  return (
    <div className="flex flex-col h-screen w-full bg-gray-900/90 text-white">
      {isAreaCaptureMode && (
        <AreaScreenshot
          onCapture={(blob) => {
            console.log("📸 [ChatUI] Area capture received from component. Blob size:", blob.size);
            setIsAreaCaptureMode(false);

            // Start processing in next tick to avoid blocking UI close
            setTimeout(() => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const dataUrl = reader.result as string;
                console.log("✅ Area screenshot data URL generated successfully!");
                handleSendImage(dataUrl);
              };
              reader.readAsDataURL(blob);
            }, 0);
          }}
          onCancel={() => {
            console.log("📸 [ChatUI] onCancel triggered");
            setIsAreaCaptureMode(false);
          }}
        />
      )}
      {/* Screenshot Modal */}
      {showScreenshotModal && screenshotDataUrl && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={closeScreenshotModal}
        >
          <div
            className="bg-gray-800 rounded-lg p-4 max-w-5xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Screenshot Preview</h3>
              <button
                onClick={closeScreenshotModal}
                className="text-gray-400 hover:text-white text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <img
              src={screenshotDataUrl}
              alt="Screenshot"
              className="max-w-full h-auto rounded"
            />
            <div className="flex gap-3 mt-4 justify-end">
              <button
                onClick={downloadScreenshot}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Download
              </button>
              <button
                onClick={closeScreenshotModal}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Header with API Toggle and Clear Chat button */}
      <div className="p-3 border-b border-gray-700/50 bg-gray-800/50 flex justify-between items-center">
        <div className="flex items-center gap-3">
          {messages.length > 0 && (
            <span className="text-sm text-gray-400">{messages.length} messages</span>
          )}

          {/* API Mode Toggle */}
          <button
            onClick={() => setUseAssistantAPI(!useAssistantAPI)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 ${useAssistantAPI
              ? 'bg-purple-600 hover:bg-purple-700'
              : 'bg-green-600 hover:bg-green-700'
              }`}
          >
            <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
            {useAssistantAPI ? '🔧 Assistant API (Active)' : '⚡ Fast API (Active)'}
          </button>
        </div>

        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            Clear Chat
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`p-3 w-fit min-w-60 overflow-hidden max-w-xl lg:max-w-[50rem] rounded-2xl ${msg.role === 'user' ? 'bg-blue-500 ml-auto' : 'bg-gray-700'
              }`}
          >
            {msg.role === 'user' ? (
              <div className="text-white">
                {msg.image && (
                  <img src={msg.image} alt="User upload" className="max-w-full rounded-lg mb-2 border border-blue-400 shadow-sm" />
                )}
                <div className={msg.image ? 'text-xs opacity-70 mt-1' : ''}>
                  {msg.content}
                </div>
              </div>
            ) : (
              <MarkdownPreview className="!bg-transparent !text-white" source={msg.content} />
            )}
          </div>
        ))}
        {loading && messages.length > 0 && (
          <div className="p-3  max-w-xs rounded-2xl bg-gray-700">
            <TypeLoading />
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="p-4 border-t border-gray-700 flex items-center bg-gray-800 relative">
        {isRecordingSystem && (
          <div className="absolute -top-10 left-0 right-0 flex justify-center">
            <div className="bg-red-600 text-white px-4 py-1 rounded-full text-sm font-medium animate-pulse flex items-center gap-2">
              <span className="w-2 h-2 bg-white rounded-full"></span>
              Listening to Microphone...
            </div>
          </div>
        )}
        {isProcessingScreenshot && (
          <div className="absolute -top-10 left-0 right-0 flex justify-center">
            <div className="bg-blue-600 text-white px-4 py-1 rounded-full text-sm font-medium animate-pulse flex items-center gap-2">
              <span className="w-2 h-2 bg-white rounded-full"></span>
              Processing Screenshot...
            </div>
          </div>
        )}
        <input
          type="text"
          className="flex-1 bg-transparent border-none outline-none p-2 cursor-default"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <div className="flex gap-4">
          <button
            onClick={loading ? stopGeneration : () => handleSend()}
            className={`p-3 hover:opacity-80 rounded-lg cursor-default ${loading ? 'bg-red-600' : 'bg-gray-900'}`}
          >
            {loading ? <Square size={20} fill="white" /> : <Send size={20} />}
          </button>

          <button
            onClick={isRecordingSystem ? stopSystemRecording : startSystemRecording}
            className={`p-3 hover:opacity-80 rounded-lg cursor-default ${isRecordingSystem ? 'bg-red-500 animate-pulse' : 'bg-gray-900'
              }`}
            title="Listen to Microphone"
          >
            <Headphones size={20} color={isRecordingSystem ? 'white' : 'white'} />
          </button>

          {/* <button
            onClick={takeScreenshot}
            className={`p-3 hover:opacity-80 rounded-lg cursor-default ${isProcessingScreenshot ? 'bg-blue-500 animate-pulse' : 'bg-gray-900'
              }`}
            title="Take Screenshot (Q)"
          >
            <Camera size={20} color={isProcessingScreenshot ? 'white' : 'white'} />
          </button> */}

          <button
            onClick={() => setIsAreaCaptureMode(true)}
            className={`p-3 hover:opacity-80 rounded-lg cursor-default ${isAreaCaptureMode ? 'bg-blue-500 animate-pulse' : 'bg-gray-900'
              }`}
            title="Area Screenshot (S)"
          >
            <Crop size={20} color={isAreaCaptureMode ? 'white' : 'white'} />
          </button>

          {/* <button
            onClick={handleDownloadScreenshot}
            className="p-3 hover:opacity-80 rounded-lg cursor-default bg-gray-900"
            title="Download Screenshot"
          >
            <Download size={20} color="white" />
          </button> */}
        </div>
      </div>
    </div>
  );
}
