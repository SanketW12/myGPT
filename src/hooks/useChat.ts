import { useState, useRef, useEffect, useCallback } from 'react';
import OpenAI from 'openai';
import {
  GO_REACT_DEVELOPER_PROMPT,
  GO_REACT_IMAGE_PROMPT
} from '../prompts/goReactDeveloper';

const rawModel = (import.meta.env.VITE_MODEL || 'gpt-4.1').trim();
// OpenAI has deprecated legacy 'gpt-4' (returns model_not_found); automatically route to 'gpt-4.1'
const DEFAULT_MODEL = rawModel === 'gpt-4' ? 'gpt-4.1' : rawModel;
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
      const maxDim = 1600;
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
      // High-quality JPEG reduces 5MB raw retina screenshot to ~150KB, speeding up upload 20x
      resolve(canvas.toDataURL('image/jpeg', 0.85));
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
    import.meta.env.VITE_SYSTEM_PROMPT || GO_REACT_DEVELOPER_PROMPT;

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

        const promptText = userText || GO_REACT_IMAGE_PROMPT;

        // Compress retina/4K screenshot to fast 150KB JPEG for immediate network upload
        const optimizedImage = await optimizeImageForVision(imageDataUrl);

        const contentPayload: any[] = [
          {
            type: 'input_text',
            text: promptText
          },
          { type: 'input_image', image_url: optimizedImage, detail: 'auto' }
        ];

        const stream = await openaiClient.responses.create(
          {
            model: DEFAULT_MODEL,
            max_output_tokens: MAX_OUTPUT_TOKENS,
            ...optionalTemperature,
            stream: true,
            instructions: systemPrompt,
            previous_response_id: useAssistantAPI ? (assistantPreviousResponseIdRef.current || undefined) : undefined,
            input: [
              {
                role: 'user',
                content: contentPayload
              }
            ]
          },
          { signal: controller.signal }
        );

        let assistantMessage = '';
        let isFirstChunk = true;
        let lastUpdateTime = 0;

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
            if (now - lastUpdateTime > 35) {
              lastUpdateTime = now;
              updateAssistantMessage(assistantMessage);
            }
          }
        }
        updateAssistantMessage(assistantMessage);
      } catch (error) {
        console.error('❌ Error sending image to OpenAI:', error);
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Error: Unable to process image with OpenAI.' }]);
      } finally {
        isStreamingRef.current = false;
        setLoading(false);
      }
    },
    [input, systemPrompt, useAssistantAPI, updateAssistantMessage]
  );

  // Responses API logic (fast streaming text flow)
  const handleSendWithResponses = async (text: string) => {
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
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text
                }
              ]
            }
          ]
        },
        { signal: controller.signal }
      );

      let assistantMessage = '';
      let isFirstChunk = true;
      let lastUpdateTime = 0;

      for await (const chunk of stream) {
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
          if (now - lastUpdateTime > 35) {
            lastUpdateTime = now;
            updateAssistantMessage(assistantMessage);
          }
        }
      }
      updateAssistantMessage(assistantMessage);
      setLoading(false);
    } catch (error) {
      console.error('Error in Responses API:', error);
      setLoading(false);
    } finally {
      isStreamingRef.current = false;
    }
  };

  // Conversation-style assistant flow using Responses API chaining.
  const handleSendWithConversationAPI = async (text: string) => {
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
          if (now - lastUpdateTime > 35) {
            lastUpdateTime = now;
            updateAssistantMessage(assistantMessage);
          }
        }
      }
      updateAssistantMessage(assistantMessage);
      setLoading(false);
    } catch (error) {
      console.error('Error in Conversation API flow:', error);
      setLoading(false);
    } finally {
      isStreamingRef.current = false;
    }
  };

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

  const isSendingRef = useRef(false);

  const handleSend = useCallback(
    async (text?: string, imageAttachment?: string) => {
      const messageText = (text !== undefined ? text : input).trim();
      const imageToSend = imageAttachment !== undefined ? imageAttachment : attachedImage;

      // If both text and image are empty, do nothing
      if (!messageText && !imageToSend) return;

      // If a request is already running, abort it immediately so the new request is processed with zero delay
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      // Guard against concurrent double-entry while setting up
      if (isSendingRef.current) return;
      isSendingRef.current = true;

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
          await handleSendWithResponses(messageText);
        }
      } finally {
        isSendingRef.current = false;
      }
    },
    [input, attachedImage, useAssistantAPI, handleSendImage, handleSendWithConversationAPI, handleSendWithResponses]
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
