import React from 'react';
import { Send, Square, Crop, Mic } from 'lucide-react';

interface InputAreaProps {
    input: string;
    setInput: (value: string) => void;
    handleSend: () => void;
    loading: boolean;
    stopGeneration: () => void;
    isRecording: boolean;
    startRecording: () => void;
    stopRecording: () => void;
    isRealtime: boolean;
    isListening?: boolean;
    realtimeStatus?: string;
    startRealtime: () => void;
    stopRealtime: () => void;
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
    isRealtime,
    isListening = false,
    realtimeStatus,
    startRealtime,
    stopRealtime,
    isProcessingScreenshot,
    isAreaCaptureMode,
    onEnterAreaCaptureMode
}) => {
    return (
        <div className="p-4 border-t border-gray-700/50 flex items-center bg-gray-800/50 backdrop-blur-sm relative">
            {(isRealtime || realtimeStatus) && (
                <div className="absolute -top-10 left-0 right-0 flex justify-center">
                    <div className={`${isRealtime && isListening ? 'bg-green-600 animate-pulse' : isRealtime ? 'bg-amber-600' : 'bg-amber-600'} text-white px-4 py-1 rounded-full text-sm font-medium flex items-center gap-2 max-w-[90%]`}>
                        <span className={`w-2 h-2 rounded-full shrink-0 ${isListening ? 'bg-white' : 'bg-white/50'}`}></span>
                        <span className="truncate">
                            {realtimeStatus || (isListening ? 'Listening ON' : 'Listening OFF')}
                        </span>
                        {isRealtime && (
                            <span className="text-[10px] uppercase tracking-wide opacity-80 shrink-0">
                                {isListening ? 'ON' : 'OFF'}
                            </span>
                        )}
                    </div>
                </div>
            )}
            {isRecording && !isRealtime && (
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

                {/* Legacy recording button hidden for now
                <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`p-3 hover:opacity-80 rounded-lg transition-colors ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-900'}`}
                    title={isRecording ? 'Stop Mic (P)' : 'Record Audio & Transcribe (K)'}
                >
                    <Headphones size={20} color="white" />
                </button>
                */}

                <button
                    onClick={isRealtime ? stopRealtime : startRealtime}
                    className={`p-3 hover:opacity-80 rounded-lg transition-colors ${isRealtime ? 'bg-green-500 animate-pulse' : 'bg-gray-900'}`}
                    title={isRealtime ? 'Stop Realtime (click only)' : 'Start Realtime (Space or click)'}
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
