import React from 'react';
import { Send, Square, Headphones, Crop, Mic } from 'lucide-react';

interface InputAreaProps {
    input: string;
    setInput: (value: string) => void;
    handleSend: () => void;
    loading: boolean;
    stopGeneration: () => void;
    isRecording: boolean;
    startRecording: () => void;
    stopRecording: () => void;
    isLive: boolean;
    startLive: () => void;
    stopLive: () => void;
    isProcessingScreenshot: boolean;
    isAreaCaptureMode: boolean;
    onEnterAreaCaptureMode: () => void;
}

export const InputArea: React.FC<InputAreaProps> = ({
    input,
    setInput,
    handleSend,
    loading,
    stopGeneration,
    isRecording,
    startRecording,
    stopRecording,
    isLive,
    startLive,
    stopLive,
    isProcessingScreenshot,
    isAreaCaptureMode,
    onEnterAreaCaptureMode
}) => {
    return (
        <div className="p-4 border-t border-gray-700 flex items-center bg-gray-800 relative">
            {isRecording && (
                <div className="absolute -top-10 left-0 right-0 flex justify-center">
                    <div className="bg-red-600 text-white px-4 py-1 rounded-full text-sm font-medium animate-pulse flex items-center gap-2">
                        <span className="w-2 h-2 bg-white rounded-full"></span>
                        Listening to Microphone (Old)...
                    </div>
                </div>
            )}
            {isProcessingScreenshot && (
                <div className="absolute -top-10 left-0 right-0 flex justify-center">
                    <div className="bg-blue-600 text-white px-4 py-1 rounded-full text-sm font-medium animate-pulse flex items-center gap-2">
                        <span className="w-2 h-2 bg-white rounded-full"></span>
                        Processing Screenshot...
                    </div>
                </div>
            )}

            <input
                type="text"
                className="flex-1 bg-transparent border-none outline-none p-2 cursor-text text-white placeholder-gray-400"
                placeholder="Type a message..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            />

            <div className="flex gap-4">
                <button
                    onClick={loading ? stopGeneration : () => handleSend()}
                    className={`p-3 hover:opacity-80 rounded-lg transition-colors ${loading ? 'bg-red-600' : 'bg-gray-900'}`}
                    title={loading ? "Stop Generating" : "Send Message"}
                >
                    {loading ? <Square size={20} fill="white" /> : <Send size={20} color="white" />}
                </button>

                {/* Legacy Recording Button - keeping as is per user instruction implies adding new one, not replacing */}
                <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`p-3 hover:opacity-80 rounded-lg transition-colors ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-900'}`}
                    title="Record Audio & Transcribe (L)"
                >
                    <Headphones size={20} color="white" />
                </button>

                {/* New Live Transcription Button */}
                <button
                    onClick={isLive ? stopLive : startLive}
                    className={`p-3 hover:opacity-80 rounded-lg transition-colors ${isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-900'}`}
                    title="Live Transcription"
                >
                    <Mic size={20} color="white" />
                </button>

                <button
                    onClick={onEnterAreaCaptureMode}
                    className={`p-3 hover:opacity-80 rounded-lg transition-colors ${isAreaCaptureMode ? 'bg-blue-500 animate-pulse' : 'bg-gray-900'}`}
                    title="Area Screenshot (S)"
                >
                    <Crop size={20} color="white" />
                </button>
            </div>
        </div>
    );
};
