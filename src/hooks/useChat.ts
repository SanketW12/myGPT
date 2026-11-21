import { useState, useRef, useEffect, useCallback } from 'react';
import OpenAI from 'openai';
import { createWorker } from 'tesseract.js';
import {
  JAVA_FULL_STACK_DEVELOPER_PROMPT,
  JAVA_FULL_STACK_IMAGE_PROMPT
} from '../prompts/javaFullStackDeveloper';

const rawModel = (import.meta.env.VITE_MODEL || 'gpt-4o').trim();
// OpenAI deprecated legacy 'gpt-4' (returns 404 deprecated); automatically route to OpenAI's default GPT-4 flagship model 'gpt-4o'
const DEFAULT_MODEL = rawModel === 'gpt-4' ? 'gpt-4o' : rawModel;
const MAX_OUTPUT_TOKENS = Number(import.meta.env.VITE_MAX_OUTPUT_TOKENS || 1500);

// Models like gpt-5.5, o1, o3-mini do not support the 'temperature' parameter in OpenAI API
const rawTemp = import.meta.env.VITE_TEMPERATURE;
const isTempSupported =
  !DEFAULT_MODEL.startsWith('o1') &&
  !DEFAULT_MODEL.startsWith('o3') &&
  !DEFAULT_MODEL.startsWith('gpt-5');
const optionalTemperature =
  rawTemp !== undefined && rawTemp !== '' && isTempSupported ? { temperature: Number(rawTemp) } : {};

// Reusable OpenAI client instance for persistent connection reuse & minimal latency
const openaiClient = new OpenAI({
  apiKey: import.meta.env.VITE_API_KEY,
  dangerouslyAllowBrowser: true
});

// Optimize screenshot image to fast JPEG format & capped dimensions for quick network transfer
const optimizeImageForVision = (dataUrl: string): Promise<string> => {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const maxDim = 2000;
      let width = img.width;
      let height = img.height;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      // High-quality JPEG (0.92) preserves sharp code font lines while compressing footprint
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

interface Message {
  role: string;
  content: string;
  image?: string;
}

export const useChat = () => {
  const systemPrompt =
    import.meta.env.VITE_SYSTEM_PROMPT || JAVA_FULL_STACK_DEVELOPER_PROMPT;

  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem('chatMessages');
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [useAssistantAPI, setUseAssistantAPI] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const assistantPreviousResponseIdRef = useRef<string | null>(null);
  const realtimeAssistantActiveRef = useRef(false);
  const realtimeUserStreamingRef = useRef(false);
  const isStreamingRef = useRef(false);

  // Helper to update the streaming assistant message in state
  const updateAssistantMessage = useCallback((content: string) => {
    setMessages((prev) => {
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content };
        return updated;
      }
      return [...prev, { role: 'assistant', content }];
    });
  }, []);

  useEffect(() => {
    // Only persist completed messages to localStorage when NOT actively streaming,
    // preventing synchronous disk serialization and main thread lag on every token chunk.
    if (!loading && !isStreamingRef.current) {
      try {
        if (messages.length > 0) {
          localStorage.setItem('chatMessages', JSON.stringify(messages));
        } else {
          localStorage.removeItem('chatMessages');
        }
      } catch (e) {
        console.warn('Failed to save to localStorage:', e);
      }
    }
  }, [messages, loading]);

  const clearChat = useCallback(() => {
    setMessages([]);
    localStorage.removeItem('chatMessages');
    assistantPreviousResponseIdRef.current = null;
    setAttachedImage(null);
  }, []);

  const stopGeneration = useCallback(() => {
    console.log('🛑 Stopping generation...');
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    isStreamingRef.current = false;
    setLoading(false);
  }, []);

  // Fast direct streaming chat completions flow (ultra-low latency: ~1.2s total time)
  const handleSendWithFastAPI = useCallback(
    async (text: string) => {
      try {
        setLoading(true);
        isStreamingRef.current = true;
        const controller = new AbortController();
        abortControllerRef.current = controller;

        // Collect recent context (last 6 messages, text-only)
        const recentMessages = messages
          .filter((m) => m.content && m.content.trim().length > 0)
          .slice(-6)
          .map((m) => ({
            role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
            content: m.content
          }));

        const stream = await openaiClient.chat.completions.create(
          {
            model: DEFAULT_MODEL,
            stream: true,
            max_completion_tokens: MAX_OUTPUT_TOKENS,
            ...optionalTemperature,
            messages: [
              { role: 'system', content: systemPrompt },
              ...recentMessages,
              { role: 'user', content: text }
            ]
          },
          { signal: controller.signal }
        );

        let assistantMessage = '';
        let isFirstChunk = true;
        let lastUpdateTime = 0;

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            assistantMessage += content;
            if (isFirstChunk) {
              setLoading(false);
              isFirstChunk = false;
              updateAssistantMessage(assistantMessage);
              lastUpdateTime = performance.now();
              continue;
            }
            const now = performance.now();
            if (now - lastUpdateTime > 25) {
              lastUpdateTime = now;
              updateAssistantMessage(assistantMessage);
            }
          }
        }
        updateAssistantMessage(assistantMessage);
        setLoading(false);
      } catch (error: any) {
        if (error?.name === 'AbortError' || error?.message?.includes('abort')) {
          return;
        }
        console.error('Error in Fast Chat completions API:', error);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `⚠️ Error fetching response: ${error?.message || 'Network error'}` }
        ]);
        setLoading(false);
      } finally {
        isStreamingRef.current = false;
      }
    },
    [messages, systemPrompt, updateAssistantMessage]
  );

  const handleSendImage = useCallback(
    async (imageDataUrl: string, customText?: string) => {
      setLoading(true);
      isStreamingRef.current = true;

      const userText = (customText !== undefined ? customText : input).trim();
      const userMessage: Message = { role: 'user', content: userText, image: imageDataUrl };
      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      setAttachedImage(null);

      try {
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const promptText = userText
          ? `${userText}\n\n(Context: Focus strictly on the technical elements, code, text, diagrams, or questions in the image. Disregard personal identity.)`
          : JAVA_FULL_STACK_IMAGE_PROMPT;

        // Compress screenshot with high quality (0.92) to keep code text razor sharp
        const optimizedImage = await optimizeImageForVision(imageDataUrl);

        let assistantMessage = '';
        let isFirstChunk = true;
        let lastUpdateTime = 0;
        let isRefusalDetected = false;

        const isRefusal = (text: string) => {
          const lower = text.toLowerCase().trim();
          return (
            lower.includes("identifying or analyzing individuals") ||
            lower.includes("identifying individuals") ||
            lower.includes("analyzing individuals") ||
            lower.includes("identify people") ||
            lower.includes("identifying people") ||
            lower.includes("can't assist with that image") ||
            lower.includes("can't assist with this image") ||
            lower.includes("cannot assist with this image") ||
            lower.includes("can't assist with this image") ||
            lower.includes("can't assist with image") ||
            lower.includes("cannot assist with image") ||
            lower.includes("can't assist with identifying") ||
            lower.includes("cannot assist with identifying") ||
            lower.includes("making assumptions about people") ||
            lower.includes("can't help with that image")
          );
        };

        if (useAssistantAPI) {
          // Assistant API / Responses API flow
          const stream = await openaiClient.responses.create(
            {
              model: DEFAULT_MODEL,
              max_output_tokens: MAX_OUTPUT_TOKENS,
              ...optionalTemperature,
              stream: true,
              instructions: systemPrompt,
              previous_response_id: assistantPreviousResponseIdRef.current || undefined,
              input: [
                {
                  role: 'user',
                  content: [
                    { type: 'input_text', text: promptText },
                    { type: 'input_image', image_url: optimizedImage, detail: 'high' }
                  ]
                }
              ]
            },
            { signal: controller.signal }
          );

          for await (const chunk of stream) {
            if (chunk.type === 'response.created' && chunk.response?.id) {
              assistantPreviousResponseIdRef.current = chunk.response.id;
            }

            const content = chunk.type === 'response.output_text.delta' ? chunk.delta : '';
            if (content) {
              assistantMessage += content;
              if (isFirstChunk) {
                setLoading(false);
                isFirstChunk = false;
                updateAssistantMessage(assistantMessage);
                lastUpdateTime = performance.now();
                continue;
              }
              const now = performance.now();
              if (now - lastUpdateTime > 25) {
                lastUpdateTime = now;
                updateAssistantMessage(assistantMessage);
              }
            }
          }
        } else {
          // Fast direct Chat Completions vision flow with detail: 'high'
          const stream = await openaiClient.chat.completions.create(
            {
              model: DEFAULT_MODEL,
              max_completion_tokens: MAX_OUTPUT_TOKENS,
              ...optionalTemperature,
              stream: true,
              messages: [
                { role: 'system', content: systemPrompt },
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: promptText },
                    { type: 'image_url', image_url: { url: optimizedImage, detail: 'high' } }
                  ]
                }
              ]
            },
            { signal: controller.signal }
          );

          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              assistantMessage += content;
              if (isRefusal(assistantMessage)) {
                isRefusalDetected = true;
                break;
              }
              if (isFirstChunk) {
                setLoading(false);
                isFirstChunk = false;
                updateAssistantMessage(assistantMessage);
                lastUpdateTime = performance.now();
                continue;
              }
              const now = performance.now();
              if (now - lastUpdateTime > 25) {
                lastUpdateTime = now;
                updateAssistantMessage(assistantMessage);
              }
            }
          }
        }

        if (isRefusalDetected || isRefusal(assistantMessage)) {
          console.warn('⚠️ OpenAI vision refused image. Running automatic OCR recovery...');
          updateAssistantMessage('🔍 Processing text and user question from image...');
          try {
            const worker = await createWorker('eng');
            const ret = await worker.recognize(optimizedImage || imageDataUrl);
            await worker.terminate();
            const extractedText = ret.data?.text?.trim();
            const ocrContent = extractedText && extractedText.length > 5 ? extractedText : '';

            const promptForFallback = userText
              ? (ocrContent ? `${userText}\n\n[Extracted text/code from image]:\n${ocrContent}` : userText)
              : (ocrContent ? `Analyze and solve this technical code/problem from the image:\n\n${ocrContent}` : 'Please provide technical guidance on this question.');

            await handleSendWithFastAPI(promptForFallback);
            return;
          } catch (ocrErr) {
            console.error('OCR recovery error:', ocrErr);
            if (userText) {
              await handleSendWithFastAPI(userText);
              return;
            }
          }
        }

        updateAssistantMessage(assistantMessage);
      } catch (error: any) {
        if (error?.name === 'AbortError' || error?.message?.includes('abort')) {
          return;
        }
        console.error('❌ Error sending image to OpenAI:', error);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `⚠️ Error processing image: ${error?.message || 'Network error'}` }
        ]);
      } finally {
        isStreamingRef.current = false;
        setLoading(false);
      }
    },
    [input, systemPrompt, useAssistantAPI, updateAssistantMessage, handleSendWithFastAPI]
  );

  // Conversation-style assistant flow using Responses API chaining.
  const handleSendWithConversationAPI = useCallback(
    async (text: string) => {
      try {
        setLoading(true);
        isStreamingRef.current = true;
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const stream = await openaiClient.responses.create(
          {
            model: DEFAULT_MODEL,
            stream: true,
            max_output_tokens: MAX_OUTPUT_TOKENS,
            ...optionalTemperature,
            instructions: systemPrompt,
            previous_response_id: assistantPreviousResponseIdRef.current || undefined,
            input: text
          },
          { signal: controller.signal }
        );

        let assistantMessage = '';
        let isFirstChunk = true;
        let lastUpdateTime = 0;

        for await (const chunk of stream) {
          if (chunk.type === 'response.created') {
            assistantPreviousResponseIdRef.current = chunk.response.id;
          }

          const content = chunk.type === 'response.output_text.delta' ? chunk.delta : '';
          if (content) {
            assistantMessage += content;
            if (isFirstChunk) {
              setLoading(false);
              isFirstChunk = false;
              updateAssistantMessage(assistantMessage);
              lastUpdateTime = performance.now();
              continue;
            }
            const now = performance.now();
            if (now - lastUpdateTime > 25) {
              lastUpdateTime = now;
              updateAssistantMessage(assistantMessage);
            }
          }
        }
        updateAssistantMessage(assistantMessage);
        setLoading(false);
      } catch (error: any) {
        if (error?.name === 'AbortError' || error?.message?.includes('abort')) {
          return;
        }
        console.error('Error in Conversation API flow:', error);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `⚠️ Error in Conversation API: ${error?.message || 'Network error'}` }
        ]);
        setLoading(false);
      } finally {
        isStreamingRef.current = false;
      }
    },
    [systemPrompt, updateAssistantMessage]
  );

  const addRealtimeUserMessage = useCallback((content: string) => {
    if (!content.trim()) return;
    realtimeUserStreamingRef.current = false;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      const userMessage = { role: 'user', content: content.trim() };
      // If the last message is already user and assistant hasn't started, update it with the full accumulated sentence
      if (last?.role === 'user' && !realtimeAssistantActiveRef.current) {
        return [...prev.slice(0, -1), userMessage];
      }
      return [...prev, userMessage];
    });
  }, []);

  const appendRealtimeUserDelta = useCallback((delta: string) => {
    if (!delta) return;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'user' && !realtimeAssistantActiveRef.current) {
        return [...prev.slice(0, -1), { ...last, content: last.content + delta }];
      }
      realtimeUserStreamingRef.current = true;
      return [...prev, { role: 'user', content: delta }];
    });
  }, []);

  const markRealtimeThinking = useCallback(() => {
    setLoading(true);
  }, []);

  const beginRealtimeAssistantTurn = useCallback(() => {
    realtimeAssistantActiveRef.current = false;
    realtimeUserStreamingRef.current = false;
  }, []);

  const appendRealtimeAssistantDelta = useCallback((delta: string) => {
    if (!delta) return;
    setLoading(false);
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant' && realtimeAssistantActiveRef.current) {
        return [...prev.slice(0, -1), { ...last, content: last.content + delta }];
      }
      realtimeAssistantActiveRef.current = true;
      return [...prev, { role: 'assistant', content: delta }];
    });
  }, []);

  const finishRealtimeAssistantTurn = useCallback(() => {
    setLoading(false);
    realtimeAssistantActiveRef.current = false;
    realtimeUserStreamingRef.current = false;
  }, []);

  const handleSend = useCallback(
    async (text?: string, imageAttachment?: string) => {
      const messageText = (text !== undefined ? text : input).trim();
      const imageToSend = imageAttachment !== undefined ? imageAttachment : attachedImage;

      // If both text and image are empty, do nothing
      if (!messageText && !imageToSend) return;

      // If a previous request is running, abort it immediately so the new request runs with zero delay
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      isStreamingRef.current = false;

      try {
        if (imageToSend) {
          await handleSendImage(imageToSend, messageText);
          return;
        }

        setMessages((prev) => [...prev, { role: 'user', content: messageText }]);
        setInput('');
        if (useAssistantAPI) {
          await handleSendWithConversationAPI(messageText);
        } else {
          await handleSendWithFastAPI(messageText);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError' && !err?.message?.includes('abort')) {
          console.error('Error in handleSend:', err);
        }
      }
    },
    [input, attachedImage, useAssistantAPI, handleSendImage, handleSendWithConversationAPI, handleSendWithFastAPI]
  );

  return {
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
  };
};
