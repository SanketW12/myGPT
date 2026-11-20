import React, { useState, useEffect } from 'react';
import { Minimize2, Maximize2, Minus, X } from 'lucide-react';

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
    const [isCompact, setIsCompact] = useState(false);

    useEffect(() => {
        // Listen for window size changes from main process if available
        if (window?.Main?.on) {
            window.Main.on('window-size-changed', (data: { isCompact: boolean }) => {
                if (data && typeof data.isCompact === 'boolean') {
                    setIsCompact(data.isCompact);
                }
            });
        }
    }, []);

    const handleToggleSize = () => {
        if (window?.Main?.toggleWindowSize) {
            window.Main.toggleWindowSize();
            setIsCompact((prev) => !prev);
        }
    };

    const handleMinimize = () => {
        window?.Main?.Minimize?.();
    };

    const handleClose = () => {
        window?.Main?.Close?.();
    };

    // Programmatic cursor drag fallback handler for moving window with cursor
    const handleDragMouseDown = (e: React.MouseEvent) => {
        // Only trigger on primary (left) mouse button and ignore interactive elements
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('.undraggable')) return;

        let prevX = e.screenX;
        let prevY = e.screenY;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.screenX - prevX;
            const deltaY = moveEvent.screenY - prevY;
            prevX = moveEvent.screenX;
            prevY = moveEvent.screenY;
            if (deltaX !== 0 || deltaY !== 0) {
                window?.Main?.dragWindow?.(deltaX, deltaY);
            }
        };

        const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    return (
        <div
            onMouseDown={handleDragMouseDown}
            className="draggable w-full px-3 py-2 border-b border-gray-700/50 bg-gray-800/80 flex justify-between items-center backdrop-blur-md sticky top-0 z-20 select-none cursor-grab active:cursor-grabbing"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
            {/* Left section: Mode toggle & Clear button */}
            <div className="flex items-center gap-2 shrink-0">
                <button
                    onClick={() => setUseAssistantAPI(!useAssistantAPI)}
                    className={`undraggable px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-sm ${useAssistantAPI
                        ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-900/20'
                        : 'bg-green-600 hover:bg-green-700 text-white shadow-green-900/20'
                        }`}
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    title="Toggle Assistant / Fast API mode"
                >
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
                    <span>{useAssistantAPI ? 'Assistant' : 'Fast'}</span>
                </button>

                {messageCount > 0 && (
                    <button
                        onClick={clearChat}
                        className="undraggable px-2 py-1 text-xs bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-600/50 rounded-lg transition-all duration-200 font-medium"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                        title="Clear conversation"
                    >
                        Clear
                    </button>
                )}
            </div>

            {/* Center section: Clean flexible spacer (draggable) */}
            <div
                className="draggable flex-1 h-full mx-2 cursor-grab active:cursor-grabbing"
                style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            />

            {/* Right section: Window Controls (Reduce Size, Minimize, Close) */}
            <div className="flex items-center gap-1 shrink-0">
                {/* Reduce / Compact size toggle */}
                <button
                    onClick={handleToggleSize}
                    className="undraggable p-1.5 text-gray-400 hover:text-white hover:bg-gray-700/60 rounded-md transition-colors"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    title={isCompact ? 'Restore standard size (700x700)' : 'Reduce window size (Compact mode)'}
                >
                    {isCompact ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
                </button>

                {/* Minimize window */}
                <button
                    onClick={handleMinimize}
                    className="undraggable p-1.5 text-gray-400 hover:text-white hover:bg-gray-700/60 rounded-md transition-colors"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    title="Minimize window"
                >
                    <Minus className="w-3.5 h-3.5" />
                </button>

                {/* Close window */}
                <button
                    onClick={handleClose}
                    className="undraggable p-1.5 text-gray-400 hover:text-white hover:bg-red-600/80 rounded-md transition-colors"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    title="Close window"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
};
