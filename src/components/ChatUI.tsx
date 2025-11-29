/* eslint-disable jsx-a11y/media-has-caption */
/* eslint-disable react/no-array-index-key */
/* eslint-disable react/react-in-jsx-scope */
import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, Headphones } from 'lucide-react';
import axios from 'axios';
import OpenAI from 'openai';
import MarkdownPreview from '@uiw/react-markdown-preview';
import TypingEffect from './TypingEffect';
import TypeLoading from './TypeLoading';
import { getResponse, runAssistant, sendMessage } from '../services';

export default function ChatUI() {
  // Load messages from localStorage on mount
  const [messages, setMessages] = useState<{ role: string; content: string }[]>(() => {
    const saved = localStorage.getItem('chatMessages');
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [useAssistantAPI, setUseAssistantAPI] = useState(true); // Toggle between APIs
  const [isRecordingSystem, setIsRecordingSystem] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  
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

  // Keyboard shortcuts for recording
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input or textarea
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecordingSystem, isInitializing]); // Re-bind when state changes to ensure fresh closure access if needed, though functions rely on refs/state setters which are stable or handled.

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
        model: 'gpt-4o-mini', // or 'gpt-4' for better quality
        messages: conversationMessages,
        stream: true,
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
      {/* Header with API Toggle and Clear Chat button */}
      <div className="p-3 border-b border-gray-700/50 bg-gray-800/50 flex justify-between items-center">
        <div className="flex items-center gap-3">
          {messages.length > 0 && (
            <span className="text-sm text-gray-400">{messages.length} messages</span>
          )}
          
          {/* API Mode Toggle */}
          <button
            onClick={() => setUseAssistantAPI(!useAssistantAPI)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 ${
              useAssistantAPI 
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
            className={`p-3 w-fit min-w-60 overflow-hidden max-w-xl lg:max-w-[50rem] rounded-2xl ${
              msg.role === 'user' ? 'bg-blue-500 ml-auto' : 'bg-gray-700'
            }`}
          >
            {msg.role === 'user' ? (
              <div className="text-white">
                {msg.content}
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
            className={`p-3 hover:opacity-80 rounded-lg cursor-default ${
              isRecordingSystem ? 'bg-red-500 animate-pulse' : 'bg-gray-900'
            }`}
            title="Listen to System Audio"
          >
            <Headphones size={20} color={isRecordingSystem ? 'white' : 'white'} />
          </button>
        </div>
      </div>
    </div>
  );
}
