import React, { memo } from 'react';
import MarkdownPreview from '@uiw/react-markdown-preview';
import TypeLoading from '../TypeLoading';

interface Message {
    role: string;
    content: string;
    image?: string;
}

interface MessageListProps {
    messages: Message[];
    loading: boolean;
    latestQuestionRef?: React.RefObject<HTMLDivElement>;
}

// Memoized message item: prevents re-rendering and re-parsing markdown
// for existing messages when streaming the latest message
const MessageItem = memo(({ msg }: { msg: Message }) => {
    return (
        <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            {msg.image && (
                <div className="mb-2 max-w-[85%]">
                    <img
                        src={msg.image}
                        alt="User upload"
                        className="rounded-lg max-h-60 border border-gray-700 shadow-lg"
                    />
                </div>
            )}
            {(!msg.image || (msg.content && msg.content.trim().length > 0)) && (
                <div
                    className={`max-w-[85%] rounded-2xl px-5 py-3.5 shadow-md backdrop-blur-sm ${
                        msg.role === 'user'
                            ? 'bg-blue-600/70 text-white rounded-br-none'
                            : 'bg-gray-800/70 text-gray-100 border border-gray-700/50 rounded-bl-none'
                    }`}
                >
                    {msg.role === 'user' ? (
                        <div className="text-[15px] leading-relaxed whitespace-pre-wrap font-medium !cursor-default" style={{ cursor: 'default' }}>
                            {msg.content}
                        </div>
                    ) : (
                        <div className="markdown-container !cursor-default" style={{ cursor: 'default' }}>
                            <MarkdownPreview
                                source={msg.content}
                                style={{
                                    backgroundColor: 'transparent',
                                    color: 'inherit',
                                    fontSize: '15px',
                                    lineHeight: '1.6',
                                    cursor: 'default'
                                }}
                                wrapperElement={{
                                    "data-color-mode": "dark"
                                }}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});

MessageItem.displayName = 'MessageItem';

export const MessageList: React.FC<MessageListProps> = memo(({ messages, loading, latestQuestionRef }) => {
    // Locate the latest user question so the viewport can anchor to it
    let latestUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
            latestUserIndex = i;
            break;
        }
    }

    return (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6 custom-scrollbar">
            {messages.map((msg, idx) => (
                <div
                    key={idx}
                    ref={idx === latestUserIndex ? latestQuestionRef : undefined}
                    className="scroll-mt-4"
                >
                    <MessageItem msg={msg} />
                </div>
            ))}

            {loading && (
                <div className="flex justify-start animate-fade-in">
                    <div className="bg-gray-800/70 rounded-2xl rounded-bl-none px-4 py-3 border border-gray-700/50 shadow-sm backdrop-blur-sm">
                        <TypeLoading />
                    </div>
                </div>
            )}
            <div className="h-2" />
        </div>
    );
});

MessageList.displayName = 'MessageList';

