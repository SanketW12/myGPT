import { useState, useRef, useEffect, useCallback } from 'react';
import OpenAI from 'openai';

interface Message {
  role: string;
  content: string;
  image?: string;
}

export const useChat = () => {
  const systemPrompt =
    import.meta.env.VITE_SYSTEM_PROMPT ||
    `You are a senior software engineer with real-world industry experience.
Your task is to answer technical questions in a **human, natural, interview-friendly way**.

Follow these rules strictly:

1. Speak like a real engineer, not a textbook.
   - Use phrases like: "In my experience", "Usually what I do is", 
     "One thing to watch out for is..."
   - Avoid robotic, academic, or documentation-style language.

2. Start every answer with a spoken-style explanation:
   - Short direct answer (1-2 lines)
   - Practical explanation with real-world context
   - One realistic example or scenario
   - Optional trade-offs or pitfalls (if applicable)

3. After providing your complete answer, ALWAYS add these three sections at the end with answers:

   **Must-say points**
   - Core concepts you MUST mention in an interview
   - Missing these would be considered a weak answer

   **Good-to-say points**
   - Strong points that show experience and clarity
   - Improve interviewer confidence but are not mandatory

   **Bonus points**
   - Advanced insights, edge cases, performance tips, or real-world learnings
   - These differentiate senior candidates from average ones

4. Keep the tone:
   - Confident but humble
   - Conversational and natural
   - Sounds like a live interview answer, not a blog post

5. Focus on:
   - Why something is used (not just what it is)
   - When to use it vs when NOT to use it
   - Performance, scalability, maintainability trade-offs

6. If the question is frontend-related:
   - Prefer React, TypeScript, hooks, rendering behavior, performance
   - Mention real app scenarios (large apps, re-renders, APIs, UX)

7. If the question is backend / system-related:
   - Mention scalability, latency, failure cases, trade-offs

8. Do NOT:
   - Sound like documentation
   - Over-explain basics unless explicitly asked
   - Use excessive bullet points outside the required sections

9. If the question is unclear:
   - Ask for brief clarification like a real interview conversation.

Answer length:
- Short to medium
- Spoken-answer style
- No unnecessary fluff`;

  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem('chatMessages');
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [useAssistantAPI, setUseAssistantAPI] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const assistantPreviousResponseIdRef = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(messages));
  }, [messages]);

  const clearChat = useCallback(() => {
    setMessages([]);
    localStorage.removeItem('chatMessages');
    assistantPreviousResponseIdRef.current = null;
  }, []);

  const stopGeneration = useCallback(() => {
    console.log('🛑 Stopping generation...');
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  }, []);

  const handleSendImage = useCallback(async (imageDataUrl: string) => {
    setLoading(true);

    const userMessage: Message = { role: 'user', content: '', image: imageDataUrl };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const openai = new OpenAI({
        apiKey: import.meta.env.VITE_API_KEY,
        dangerouslyAllowBrowser: true
      });
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const stream = await openai.responses.create(
        {
          model: 'gpt-4.1-mini',
          max_output_tokens: 1000,
          temperature: 0,
          stream: true,
          instructions: systemPrompt,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: 'This is question of coding or maybe a problem statement, please provide the solution or shortest explanation possible related to javascript, react.'
                },
                { type: 'input_image', image_url: imageDataUrl, detail: 'auto' }
              ]
            }
          ]
        },
        { signal: controller.signal }
      );

      let assistantMessage = '';
      for await (const chunk of stream) {
        const content = chunk.type === 'response.output_text.delta' ? chunk.delta : '';
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
    }
  }, []);

  // Responses API logic (latest recommended OpenAI text flow)
  const handleSendWithResponses = async (text: string) => {
    try {
      setLoading(true);
      const openai = new OpenAI({ apiKey: import.meta.env.VITE_API_KEY, dangerouslyAllowBrowser: true });

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const stream = await openai.responses.create(
        {
          model: 'gpt-4.1-mini',
          stream: true,
          max_output_tokens: 1000,
          temperature: 0,
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
      for await (const chunk of stream) {
        const content = chunk.type === 'response.output_text.delta' ? chunk.delta : '';
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
      const openai = new OpenAI({ apiKey: import.meta.env.VITE_API_KEY, dangerouslyAllowBrowser: true });

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const stream = await openai.responses.create(
        {
          model: 'gpt-4.1-mini',
          stream: true,
          max_output_tokens: 1000,
          temperature: 0,
          instructions: systemPrompt,
          previous_response_id: assistantPreviousResponseIdRef.current || undefined,
          input: text
        },
        { signal: controller.signal }
      );

      let assistantMessage = '';
      for await (const chunk of stream) {
        if (chunk.type === 'response.created') {
          assistantPreviousResponseIdRef.current = chunk.response.id;
        }

        const content = chunk.type === 'response.output_text.delta' ? chunk.delta : '';
        if (content) {
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

  const handleSend = useCallback(
    async (text?: string) => {
      const messageText = text || input;
      if (!messageText.trim()) return;

      setMessages((prev) => [...prev, { role: 'user', content: messageText }]);
      setInput('');
      if (useAssistantAPI) {
        await handleSendWithConversationAPI(messageText);
      } else {
        await handleSendWithResponses(messageText);
      }
    },
    [input, useAssistantAPI, messages]
  ); // Added messages to dependency is debatable, but needed for ChatCompletions history

  return {
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
  };
};
