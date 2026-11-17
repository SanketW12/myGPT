import { useState, useRef, useEffect, useCallback } from 'react';
import OpenAI from 'openai';
import { FULL_STACK_DEVELOPER_PROMPT } from '../prompts/fullStackDeveloper';

const DEFAULT_TEMPERATURE = Number(import.meta.env.VITE_TEMPERATURE || 0.2);
const CHAT_MODEL = import.meta.env.VITE_MODEL || 'gpt-4o-mini';

// Reusable OpenAI client instance for persistent connection reuse & minimal latency
const openaiClient = new OpenAI({
  apiKey: import.meta.env.VITE_API_KEY,
  dangerouslyAllowBrowser: true
});

interface Message {
  role: string;
  content: string;
  image?: string;
}

export const useChat = () => {
  const systemPrompt =
    import.meta.env.VITE_SYSTEM_PROMPT || FULL_STACK_DEVELOPER_PROMPT;

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

  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(messages));
  }, [messages]);

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
    setLoading(false);
  }, []);

  const handleSendImage = useCallback(
    async (imageDataUrl: string, customText?: string) => {
      setLoading(true);

      const userText = (customText !== undefined ? customText : input).trim();
      const userMessage: Message = { role: 'user', content: userText, image: imageDataUrl };
      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      setAttachedImage(null);

      try {
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const promptText =
          userText ||
          'This is a technical development problem or code question. Provide the solution or shortest explanation strictly from the development perspective of the stated skills (React, TypeScript, JavaScript, Golang, Node.js, Python, Docker, CI/CD, Cloud, AI integration). Do NOT go outside the context provided in the image.';

        const contentPayload: any[] = [
          {
            type: 'input_text',
            text: promptText
          },
          { type: 'input_image', image_url: imageDataUrl, detail: 'auto' }
        ];

        const stream = await openaiClient.responses.create(
          {
            model: CHAT_MODEL,
            max_output_tokens: 800,
            temperature: DEFAULT_TEMPERATURE,
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
        for await (const chunk of stream) {
          if (chunk.type === 'response.created' && chunk.response?.id) {
            assistantPreviousResponseIdRef.current = chunk.response.id;
          }

          const content = chunk.type === 'response.output_text.delta' ? chunk.delta : '';
          if (content) {
            if (isFirstChunk) {
              setLoading(false);
              isFirstChunk = false;
            }
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
      }
    },
    [input, systemPrompt, useAssistantAPI]
  );

  // Responses API logic (fast streaming text flow)
  const handleSendWithResponses = async (text: string) => {
    try {
      setLoading(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const stream = await openaiClient.responses.create(
        {
          model: CHAT_MODEL,
          stream: true,
          max_output_tokens: 800,
          temperature: DEFAULT_TEMPERATURE,
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
      for await (const chunk of stream) {
        const content = chunk.type === 'response.output_text.delta' ? chunk.delta : '';
        if (content) {
          if (isFirstChunk) {
            setLoading(false);
            isFirstChunk = false;
          }
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
      setLoading(false);
    } catch (error) {
      console.error('Error in Responses API:', error);
      setLoading(false);
    }
  };

  // Conversation-style assistant flow using Responses API chaining.
  const handleSendWithConversationAPI = async (text: string) => {
    try {
      setLoading(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const stream = await openaiClient.responses.create(
        {
          model: CHAT_MODEL,
          stream: true,
          max_output_tokens: 800,
          temperature: DEFAULT_TEMPERATURE,
          instructions: systemPrompt,
          previous_response_id: assistantPreviousResponseIdRef.current || undefined,
          input: text
        },
        { signal: controller.signal }
      );

      let assistantMessage = '';
      let isFirstChunk = true;
      for await (const chunk of stream) {
        if (chunk.type === 'response.created') {
          assistantPreviousResponseIdRef.current = chunk.response.id;
        }

        const content = chunk.type === 'response.output_text.delta' ? chunk.delta : '';
        if (content) {
          if (isFirstChunk) {
            setLoading(false);
            isFirstChunk = false;
          }
          assistantMessage += content;
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content: assistantMessage };
              return updated;
            }
            return [...prev, { role: 'assistant', content: assistantMessage }];
          });
        }
      }
      setLoading(false);
    } catch (error) {
      console.error('Error in Conversation API flow:', error);
      setLoading(false);
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
