import React, { useState, useEffect } from 'react';
import { GripHorizontal, Minimize2, Maximize2, Minus, X } from 'lucide-react';

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

    // Programmatic cursor drag handler for smooth window movement anywhere on screen (including over top menu bar)
    const handleDragStart = (e: React.MouseEvent) => {
        // Only trigger on primary (left) mouse button and ignore interactive elements
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('.undraggable, button, input, textarea')) return;

        let prevX = Number.isFinite(e.screenX) ? e.screenX : e.clientX;
        let prevY = Number.isFinite(e.screenY) ? e.screenY : e.clientY;
        if (!Number.isFinite(prevX) || !Number.isFinite(prevY)) return;

        document.body.classList.add('dragging-window');
        document.body.style.cursor = 'default';
        document.documentElement.style.cursor = 'default';

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const currentX = Number.isFinite(moveEvent.screenX) ? moveEvent.screenX : moveEvent.clientX;
            const currentY = Number.isFinite(moveEvent.screenY) ? moveEvent.screenY : moveEvent.clientY;
            if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) return;

            const deltaX = currentX - prevX;
            const deltaY = currentY - prevY;
            prevX = currentX;
            prevY = currentY;

            if (Number.isFinite(deltaX) && Number.isFinite(deltaY) && (deltaX !== 0 || deltaY !== 0)) {
                window?.Main?.dragWindow?.(deltaX, deltaY);
            }
        };

        const handleMouseUp = () => {
            document.body.classList.remove('dragging-window');
            document.body.style.cursor = 'default';
            document.documentElement.style.cursor = 'default';
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    return (
        <div
            onMouseDown={handleDragStart}
            className="w-full px-3 py-2 border-b border-gray-700/50 bg-gray-800/80 flex justify-between items-center backdrop-blur-md sticky top-0 z-20 select-none cursor-default"
            style={{ WebkitAppRegion: 'no-drag', cursor: 'default' } as React.CSSProperties}
        >
            {/* Left section: Mode toggle & Clear button */}
            <div className="flex items-center gap-2 shrink-0">
                <button
                    onClick={() => setUseAssistantAPI(!useAssistantAPI)}
                    className={`undraggable px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-sm cursor-default !cursor-default ${useAssistantAPI
                        ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-900/20'
                        : 'bg-green-600 hover:bg-green-700 text-white shadow-green-900/20'
                        }`}
                    style={{ WebkitAppRegion: 'no-drag', cursor: 'default' } as React.CSSProperties}
                    title="Toggle Assistant / Fast API mode"
                >
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
                    <span>{useAssistantAPI ? 'Assistant' : 'Fast'}</span>
                </button>

                {messageCount > 0 && (
                    <button
                        onClick={clearChat}
                        className="undraggable px-2 py-1 text-xs bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-600/50 rounded-lg transition-all duration-200 font-medium cursor-default !cursor-default"
                        style={{ WebkitAppRegion: 'no-drag', cursor: 'default' } as React.CSSProperties}
                        title="Clear conversation"
                    >
                        Clear
                    </button>
                )}
            </div>

            {/* Center section: Visual Drag Handle & flexible draggable spacer */}
            <div
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-700/40 hover:bg-gray-700/70 text-gray-300 hover:text-white transition-colors text-xs font-medium tracking-wide mx-2 cursor-default !cursor-default select-none pointer-events-none"
                style={{ WebkitAppRegion: 'no-drag', cursor: 'default' } as React.CSSProperties}
                title="Click and drag with cursor to move screen"
            >
                <GripHorizontal className="w-4 h-4 text-gray-300 pointer-events-none" />
                <span className="text-[11px] opacity-75 hidden sm:inline pointer-events-none">Drag Screen</span>
            </div>

            {/* Right section: Window Controls (Reduce Size, Minimize, Close) */}
            <div className="flex items-center gap-1 shrink-0">
                {/* Reduce / Compact size toggle */}
                <button
                    onClick={handleToggleSize}
                    className="undraggable p-1.5 text-gray-400 hover:text-white hover:bg-gray-700/60 rounded-md transition-colors cursor-default !cursor-default"
                    style={{ WebkitAppRegion: 'no-drag', cursor: 'default' } as React.CSSProperties}
                    title={isCompact ? 'Restore standard size (700x700)' : 'Reduce window size (Compact mode)'}
                >
                    {isCompact ? <Maximize2 className="w-3.5 h-3.5 pointer-events-none" /> : <Minimize2 className="w-3.5 h-3.5 pointer-events-none" />}
                </button>

                {/* Minimize window */}
                <button
                    onClick={handleMinimize}
                    className="undraggable p-1.5 text-gray-400 hover:text-white hover:bg-gray-700/60 rounded-md transition-colors cursor-default !cursor-default"
                    style={{ WebkitAppRegion: 'no-drag', cursor: 'default' } as React.CSSProperties}
                    title="Minimize window"
                >
                    <Minus className="w-3.5 h-3.5 pointer-events-none" />
                </button>

                {/* Close window */}
                <button
                    onClick={handleClose}
                    className="undraggable p-1.5 text-gray-400 hover:text-white hover:bg-red-600/80 rounded-md transition-colors cursor-default !cursor-default"
                    style={{ WebkitAppRegion: 'no-drag', cursor: 'default' } as React.CSSProperties}
                    title="Close window"
                >
                    <X className="w-3.5 h-3.5 pointer-events-none" />
                </button>
            </div>
        </div>
    );
};
