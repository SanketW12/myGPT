import React, { useRef, useEffect } from 'react';
import { Send, Square, Crop, Mic, Radio, X, Trash2 } from 'lucide-react';

interface InputAreaProps {
    input: string;
    setInput: (value: string) => void;
    attachedImage?: string | null;
    onRemoveAttachment?: () => void;
    handleSend: () => void;
    loading: boolean;
    stopGeneration: () => void;
    isRecording: boolean;
    startRecording: () => void;
    stopRecording: () => void;
    isTranscribing?: boolean;
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
    attachedImage,
    onRemoveAttachment,
    handleSend,
    loading,
    stopGeneration,
    isRecording,
    startRecording,
    stopRecording,
    isTranscribing = false,
    isRealtime,
    isListening = false,
    realtimeStatus,
    startRealtime,
    stopRealtime,
    isProcessingScreenshot,
    isAreaCaptureMode,
    onEnterAreaCaptureMode
}) => {
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (attachedImage) {
            inputRef.current?.focus();
        }
    }, [attachedImage]);

    return (
        <div className="border-t border-gray-700/50 flex flex-col bg-gray-800/50 backdrop-blur-sm relative">
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
                    <div className="bg-red-600 text-white px-4 py-1 rounded-full text-sm font-medium animate-pulse flex items-center gap-2 shadow-lg">
                        <span className="w-2 h-2 bg-white rounded-full"></span>
                        Listening... (Press Shift to Send)
                    </div>
                </div>
            )}
            {isTranscribing && (
                <div className="absolute -top-10 left-0 right-0 flex justify-center">
                    <div className="bg-purple-600 text-white px-4 py-1 rounded-full text-sm font-medium animate-pulse flex items-center gap-2 shadow-lg">
                        <span className="w-2 h-2 bg-white rounded-full"></span>
                        Transcribing & Sending to chat...
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

            {/* Attached Screenshot Preview */}
            {attachedImage && (
                <div className="px-3 sm:px-4 pt-2.5 pb-2 border-b border-gray-700/40 bg-gray-900/60 flex items-center justify-between gap-3 animate-fade-in">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="relative group shrink-0">
                            <img
                                src={attachedImage}
                                alt="Attached Screenshot"
                                className="h-14 sm:h-16 w-auto max-w-[120px] sm:max-w-[140px] object-cover rounded-lg border-2 border-blue-500/80 shadow-md group-hover:brightness-95 transition-all"
                            />
                            {onRemoveAttachment && (
                                <button
                                    type="button"
                                    onClick={onRemoveAttachment}
                                    className="absolute -top-1.5 -right-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full p-0.5 shadow-md transition-transform hover:scale-110"
                                    title="Remove screenshot"
                                >
                                    <X size={12} strokeWidth={2.5} />
                                </button>
                            )}
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-xs font-semibold text-blue-400 flex items-center gap-1.5 truncate">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                                Screenshot attached
                            </span>
                            <span className="text-[11px] text-gray-400 truncate mt-0.5">
                                Add text context below and press Enter or Send
                            </span>
                        </div>
                    </div>
                    {onRemoveAttachment && (
                        <button
                            type="button"
                            onClick={onRemoveAttachment}
                            className="text-gray-400 hover:text-red-400 p-1.5 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-gray-800/80 transition-colors shrink-0"
                            title="Discard screenshot attachment"
                        >
                            <Trash2 size={13} />
                            <span className="hidden sm:inline">Remove</span>
                        </button>
                    )}
                </div>
            )}

            {/* Input & Action Controls Row */}
            <div className="p-3 sm:p-4 pr-6 sm:pr-7 flex items-center">
                <input
                    ref={inputRef}
                    type="text"
                    className="flex-1 min-w-0 bg-transparent border-none outline-none p-2 cursor-text text-white placeholder-gray-400 text-sm"
                    placeholder={
                        attachedImage
                            ? "Add text context for this screenshot (or press Enter to send)..."
                            : "Type a message (Press Shift to speak / send)..."
                    }
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                />

                <div className="flex gap-2 shrink-0">
                    <button
                        onClick={loading ? stopGeneration : () => handleSend()}
                        className={`p-2.5 sm:p-3 hover:opacity-80 rounded-lg transition-colors ${loading ? 'bg-red-600' : 'bg-gray-900'}`}
                        title={loading ? "Stop Generating" : attachedImage ? "Send Screenshot & Message" : "Send Message"}
                    >
                        {loading ? <Square size={18} fill="white" /> : <Send size={18} color="white" />}
                    </button>

                    {/* Microphone Toggle (Shift) Button */}
                    <button
                        onClick={isRecording ? stopRecording : startRecording}
                        className={`p-2.5 sm:p-3 hover:opacity-80 rounded-lg transition-all ${isRecording ? 'bg-red-600 animate-pulse ring-2 ring-red-400' : 'bg-gray-900'}`}
                        title={isRecording ? "Stop Listening & Submit (Shift)" : "Start Listening (Shift)"}
                    >
                        <Mic size={18} color="white" />
                    </button>

                    {/* Realtime Conversation (Space) Button */}
                    <button
                        onClick={isRealtime ? stopRealtime : startRealtime}
                        className={`p-2.5 sm:p-3 hover:opacity-80 rounded-lg transition-colors ${isRealtime ? 'bg-green-500 animate-pulse' : 'bg-gray-900'}`}
                        title={isRealtime ? 'Stop Realtime (Space or click)' : 'Start Realtime (Space)'}
                    >
                        <Radio size={18} color="white" />
                    </button>

                    <button
                        onClick={onEnterAreaCaptureMode}
                        className={`p-2.5 sm:p-3 hover:opacity-80 rounded-lg transition-colors ${isAreaCaptureMode ? 'bg-blue-500 animate-pulse' : 'bg-gray-900'}`}
                        title="Area Screenshot (S)"
                    >
                        <Crop size={18} color="white" />
                    </button>
                </div>
            </div>
        </div>
    );
};
