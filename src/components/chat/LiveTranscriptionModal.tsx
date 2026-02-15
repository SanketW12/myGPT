import React from 'react';
import { X } from 'lucide-react';

interface LiveTranscriptionModalProps {
    isVisible: boolean;
    transcript: string;
    onClose: () => void;
}

export const LiveTranscriptionModal: React.FC<LiveTranscriptionModalProps> = ({
    isVisible,
    transcript,
    onClose
}) => {
    if (!isVisible) return null;

    return (
        <div className="absolute top-12 w-full z-50 flex items-center justify-center pointer-events-none">
            <div className="relative w-full max-w-2xl mx-4 pointer-events-auto">
                {/* Modal Container */}
                <div className="bg-gray-800/95 backdrop-blur-lg border border-green-500/30 rounded-2xl shadow-2xl overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 bg-green-600/20 border-b border-green-500/30">
                        <div className="flex items-center gap-2">
                            <span className="relative flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                            </span>
                            <h3 className="text-sm font-semibold text-green-400">Live Transcription</h3>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-gray-700/50 rounded-lg transition-colors"
                            title="Close"
                        >
                            <X size={18} className="text-gray-400 hover:text-white" />
                        </button>
                    </div>

                    {/* Transcript Display - 2 lines with scroll */}
                    <div className="px-4 py-3 h-16 overflow-y-auto scrollbar-thin scrollbar-thumb-green-600 scrollbar-track-gray-700">
                        <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">
                            {transcript || 'Listening...'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
