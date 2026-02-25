import React from 'react';

interface ScreenshotModalProps {
    screenshotDataUrl: string | null;
    onClose: () => void;
    onDownload: () => void;
}

export const ScreenshotModal: React.FC<ScreenshotModalProps> = ({
    screenshotDataUrl,
    onClose,
    onDownload
}) => {
    if (!screenshotDataUrl) return null;

    return (
        <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-gray-800 rounded-lg p-4 max-w-5xl max-h-[90vh] overflow-auto shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-white">Screenshot Preview</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-2xl leading-none"
                    >
                        ×
                    </button>
                </div>
                <img
                    src={screenshotDataUrl}
                    alt="Screenshot"
                    className="max-w-full h-auto rounded border border-gray-700"
                />
                <div className="flex gap-3 mt-4 justify-end">
                    <button
                        onClick={onDownload}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
                    >
                        Download
                    </button>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors font-medium"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};
