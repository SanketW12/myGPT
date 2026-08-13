import React from 'react';

interface ChatHeaderProps {
    messageCount: number;
    useAssistantAPI: boolean;
    setUseAssistantAPI: (use: boolean) => void;
    clearChat: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
    messageCount,
    useAssistantAPI,
    setUseAssistantAPI,
    clearChat
}) => {
    return (
        <div className="p-3 border-b border-gray-700/50 bg-gray-800/40 flex justify-between items-center backdrop-blur-md sticky top-0 z-10">
            <div className="flex items-center gap-3">
                <button
                    onClick={() => setUseAssistantAPI(!useAssistantAPI)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-2 shadow-sm ${useAssistantAPI
                        ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-900/20'
                        : 'bg-green-600 hover:bg-green-700 text-white shadow-green-900/20'
                        }`}
                >
                    <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                    {useAssistantAPI ? '🔧 Assistant API (Active)' : '⚡ Fast API (Active)'}
                </button>
            </div>

            {messageCount > 0 && (
                <button
                    onClick={clearChat}
                    className="px-3 py-1 text-sm bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-600/50 rounded-lg transition-all duration-200 font-medium"
                >
                    Clear Chat
                </button>
            )}
        </div>
    );
};
