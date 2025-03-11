/* eslint-disable jsx-a11y/media-has-caption */
/* eslint-disable react/no-array-index-key */
/* eslint-disable react/react-in-jsx-scope */
import React, { useState, useRef, useEffect } from 'react';
import { ReactMediaRecorder } from 'react-media-recorder';

import { AudioLines, Send } from 'lucide-react';
import axios from 'axios';
import TypingEffect from './TypingEffect';
import TypeLoading from './TypeLoading';
import { getResponse, runAssistant, sendMessage } from '../services';

export default function ChatUI() {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const transcribeAudio = async (audioFilePath: string) => {
    console.log('Transcribing audio:', audioFilePath);

    const file = new File([audioFilePath], 'audio.mp3', { type: 'wav' });
    console.log(file.type, 'type');

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        { file, model: 'whisper-1' },
        {
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_API_KEY}`,
            'Content-Type': 'multipart/form-data' // Change based on your audio file type (wav, mp3, etc.)
          }
        }
      );

      // Output transcribed text
      console.log(response.data.text); // This will be the transcribed text from the audio
    } catch (error) {
      console.error('Error in transcribing:', error);
    }
  };

  // const getOpenAIResponse = async (message: string) => {
  //   try {
  //     const response = await axios.post(
  //       'https://api.openai.com/v1/threads//messages',
  //       {
  //         // model: 'gpt-4o-mini', // Change to "gpt-4" if needed
  //         role: 'user',
  //         // messages: [{ role: 'assistant', content: message }]
  //         content: message
  //         // store: true
  //       },
  //       {
  //         headers: {
  //           Authorization:  Authorization: `Bearer ${import.meta.env.VITE_API_KEY}`,
  //           'Content-Type': 'application/json',
  //           'OpenAI-Beta': 'assistants=v2'
  //         }
  //       }
  //     );
  //     console.log('OpenAI response:', response);
  //     setMessages((pre) => [...pre, { role: 'ai', content: response.data.choices[0].message.content }]);
  //     setLoading(false);
  //     return response;
  //   } catch (error) {
  //     setLoading(false);
  //     console.error('Error fetching OpenAI response:', error);
  //     return 'Error: Unable to fetch response.';
  //   }
  // };

  // thread_WGguAgIVKOQMD67wDi1oGSaM thread id

  function getResponseMessage() {
    getResponse().then((response) => {
      const msg = response?.[0]?.content?.[0]?.text?.value;
      console.log(msg);

      if (msg === input || msg === undefined) {
        setTimeout(() => {
          getResponseMessage();
        }, 100);
      } else {
        setLoading(false);

        const resMessages = { role: 'assistant', content: msg };
        setMessages((prev) => [...prev, resMessages]);
      }
    });
  }

  const handleSend = async () => {
    if (!input.trim()) return;

    const newMessages = [...messages, { role: 'user', content: input }];
    setMessages(newMessages);

    setTimeout(() => {
      setLoading(true);
    }, 200);

    const msg = await sendMessage(input);
    console.log(msg);

    const runId = await runAssistant();
    console.log(runId);

    if (!runId) return;
    setInput('');
    getResponseMessage();
  };
  console.log(messages);

  return (
    <div className="flex flex-col h-screen w-full bg-gray-900 text-white">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`p-3 w-fit min-w-60 overflow-hidden max-w-xl lg:max-w-[50rem] rounded-2xl ${
              msg.role === 'user' ? 'bg-blue-500 ml-auto' : 'bg-gray-900'
            }`}
          >
            <TypingEffect speed={msg.role === 'user' ? 0 : 2} text={msg.content} />
          </div>
        ))}
        {loading && messages.length > 0 && (
          <div className="p-3  max-w-xs rounded-2xl bg-gray-700">
            <TypeLoading />
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="p-4 border-t border-gray-700 flex items-center bg-gray-800">
        <input
          type="text"
          className="flex-1 bg-transparent border-none outline-none p-2 cursor-default"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <div className="flex gap-4">
          <button onClick={handleSend} className="p-3  hover:opacity-80 bg-gray-900 rounded-lg cursor-default">
            <Send size={20} />
          </button>
          <ReactMediaRecorder
            mediaRecorderOptions={{ mimeType: 'audio/wav' }}
            audio
            render={({ status, startRecording, stopRecording, mediaBlobUrl }) => (
              <>
                {/* Recording Status */}

                <button
                  onClick={status === 'recording' ? stopRecording : startRecording}
                  className={`${
                    status === 'recording' ? 'animate-spin' : ''
                  }  p-3  hover:opacity-80 bg-white rounded-lg `}
                >
                  <AudioLines color="#111111" />
                </button>

                {/* Audio Playback */}
                {mediaBlobUrl && (
                  <>
                    <button
                      onClick={() => {
                        transcribeAudio(mediaBlobUrl);
                      }}
                    >
                      Send
                    </button>
                    <audio src={mediaBlobUrl} controls autoPlay loop className="mt-4" />
                    <a href={mediaBlobUrl} download="recorded-audio.mp3">
                      <button>Download</button>
                    </a>
                  </>
                )}
              </>
            )}
          />
        </div>
      </div>
    </div>
  );
}
