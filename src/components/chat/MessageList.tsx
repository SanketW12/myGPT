import React, { memo } from 'react';
import MarkdownPreview from '@uiw/react-markdown-preview';
import TypingEffect from '../TypingEffect';
import TypeLoading from '../TypeLoading';

interface Message {
    role: string;
    content: string;
    image?: string;
}

interface MessageListProps {
    messages: Message[];
    loading: boolean;
    messagesEndRef: React.RefObject<HTMLDivElement>;
}

export const MessageList: React.FC<MessageListProps> = memo(({ messages, loading, messagesEndRef }) => {
    return (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6 custom-scrollbar scroll-smooth">
            {messages.map((msg, idx) => (
                <div
                    key={idx}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                    {msg.image && (
                        <div className="mb-2 max-w-[85%]">
                            <img
                                src={msg.image}
                                alt="User upload"
                                className="rounded-lg max-h-60 border border-gray-700 shadow-lg"
                            />
                        </div>
                    )}
                    <div
                        className={`max-w-[85%] rounded-2xl px-5 py-3.5 shadow-md backdrop-blur-sm ${msg.role === 'user'
                            ? 'bg-blue-600 text-white rounded-br-none'
                            : 'bg-gray-800/80 text-gray-100 border border-gray-700/50 rounded-bl-none'
                            }`}
                    >
                        {msg.role === 'user' ? (
                            <div className="text-[15px] leading-relaxed whitespace-pre-wrap font-medium">
                                {msg.content}
                            </div>
                        ) : (
                            <div className="markdown-container">
                                {/* 
                   If it's the last message and we are NOT loading anymore, 
                   or if it's not the last message, just show Markdown. 
                   If it IS the last message and we are loading, we might want streaming effect?
                   Actually the original code just updated 'content' via streaming, relying on React re-render.
                   Line 11 uses TypingEffect only if... wait let's check original.
                */}
                                <MarkdownPreview
                                    source={msg.content}
                                    style={{
                                        backgroundColor: 'transparent',
                                        color: 'inherit',
                                        fontSize: '15px',
                                        lineHeight: '1.6'
                                    }}
                                    wrapperElement={{
                                        "data-color-mode": "dark"
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>
            ))}

            {loading && (
                <div className="flex justify-start animate-fade-in">
                    <div className="bg-gray-800/80 rounded-2xl rounded-bl-none px-4 py-3 border border-gray-700/50 shadow-sm">
                        <TypeLoading />
                    </div>
                </div>
            )}
            <div ref={messagesEndRef} className="h-4" />
        </div>
    );
});
