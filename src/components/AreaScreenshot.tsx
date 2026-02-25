import { log } from "console";
import React, { useEffect, useState } from "react";
import Selecto from "react-selecto";

type Rect = { x: number; y: number; width: number; height: number };

export function AreaScreenshot({
    onCapture,
    onCancel,
}: {
    onCapture: (blob: Blob) => void;
    onCancel: () => void;
}) {
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [rect, setRect] = useState<Rect | null>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [isClosedExternally, setIsClosedExternally] = useState(false);

    // 1️⃣ Ask Electron to capture screen
    useEffect(() => {
        let active = true;

        const capture = async () => {
            console.log("📸 [AreaScreenshot] Initializing capture...");

            const isElectron = navigator.userAgent.toLowerCase().includes('electron');
            if (!isElectron) {
                console.error("❌ [AreaScreenshot] This feature only works in Electron, not in a web browser.");
                alert("Area Screenshot requires the Electron app to run. It won't work in a standard browser.");
                onCancel();
                return;
            }

            // Wait for window.Main to be available (useful for dev reloads)
            if (!window.Main) {
                console.warn("⏳ [AreaScreenshot] window.Main not found, waiting...");
                for (let i = 0; i < 20; i++) {
                    await new Promise(r => setTimeout(r, 100));
                    if (window.Main) break;
                }
            }

            if (!window.Main) {
                console.error("❌ [AreaScreenshot] window.Main is still undefined after waiting. Available window keys:", Object.keys(window).filter(k => k.length < 20));
                if (active) onCancel();
                return;
            }

            try {
                // Tell main process we are entering capture mode (resizes window)
                window.Main.setCaptureMode(true);

                // Wait for window to settle/resize (reduced from 400ms to 100ms)
                await new Promise(r => setTimeout(r, 100));

                console.log("📸 [AreaScreenshot] Requesting screen sources...");
                const sources = await window.Main.getDesktopSources({
                    fetchThumbnail: true,
                    // Use 2K instead of 4K for slightly faster capture initialization while keeping high quality
                    thumbnailSize: { width: 2560, height: 1440 }
                });

                if (!active) return;
                console.log(`📸 [AreaScreenshot] Found ${sources.length} sources.`);

                // First try to find "Entire screen" or similar, prioritizing 'screen:' IDs
                const screenSource = sources.find((s: any) => {
                    const name = (s.name || "").toLowerCase();
                    const id = (s.id || "").toLowerCase();
                    return (name.includes('screen') || name.includes('entire')) && id.startsWith('screen:');
                }) || sources.find((s: any) => {
                    const name = (s.name || "").toLowerCase();
                    return name.includes('screen') || name.includes('entire');
                }) || sources[0];

                console.log(`🎯 [AreaScreenshot] Selected source: ${screenSource?.name} (${screenSource?.id})`);

                if (screenSource && screenSource.thumbnail) {
                    console.log("✅ [AreaScreenshot] Received thumbnail, loading image...");
                    const img = new Image();

                    img.onload = () => {
                        if (active) {
                            console.log("✅ [AreaScreenshot] Image loaded:", img.width, "x", img.height);
                            setImage(img);
                        }
                    };

                    img.onerror = (e) => {
                        console.error("❌ [AreaScreenshot] Image load error:", e);
                        if (active) {
                            alert("Failed to load screen preview. Please try again.");
                            onCancel();
                        }
                    };

                    img.src = screenSource.thumbnail;
                } else {
                    console.error("❌ [AreaScreenshot] No thumbnail found in sources");
                    if (active) onCancel();
                }
            } catch (err) {
                console.error("❌ [AreaScreenshot] Failed during capture process:", err);
                if (active) onCancel();
            }
        };

        capture();

        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setIsClosedExternally(true);
                onCancel();
            }
        };
        window.addEventListener("keydown", handleEsc);

        return () => {
            console.log("🧹 [AreaScreenshot] Component unmounting, cleaning up...");
            active = false;
            window.removeEventListener("keydown", handleEsc);
            if (window.Main) {
                window.Main.setCaptureMode(false);
            }
        };
    }, [onCancel]);

    // 2️⃣ Crop selected area
    const crop = () => {
        if (!image || !rect) {
            console.warn("⚠️ [AreaScreenshot] Cannot crop: image or rect is missing", { hasImage: !!image, rect });
            return;
        }

        console.log("✂️ [AreaScreenshot] Cropping at:", rect);

        const canvas = document.createElement("canvas");

        // Internal resolution of the image might differ from screen resolution
        // We need to map screen coordinates (rect) to image coordinates
        const scaleX = image.width / window.innerWidth;
        const scaleY = image.height / window.innerHeight;

        canvas.width = rect.width * scaleX;
        canvas.height = rect.height * scaleY;

        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(
            image,
            rect.x * scaleX,
            rect.y * scaleY,
            rect.width * scaleX,
            rect.height * scaleY,
            0,
            0,
            canvas.width,
            canvas.height
        );

        setIsCapturing(true);
        canvas.toBlob((blob) => {
            if (blob) {
                console.log("✅ [AreaScreenshot] Crop successful, size:", blob.size);
                setIsClosedExternally(true);
                onCapture(blob);
            } else {
                console.error("❌ [AreaScreenshot] Failed to create blob from canvas");
                setIsCapturing(false);
            }
        }, 'image/png');
    };



    useEffect(() => {
        if (rect) {
            crop();
        }
    }, [rect]);


    if (isClosedExternally) return null;

    if (!image) {
        return (
            <div className="fixed inset-0 z-[9999] bg-black/80 flex flex-col items-center justify-center text-white backdrop-blur-sm">
                <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-6 shadow-[0_0_15px_rgba(59,130,246,0.5)]"></div>
                <p className="text-xl font-semibold mb-8 tracking-wide animate-pulse">Initializing Screen Capture...</p>

                <button
                    onClick={() => {
                        setIsClosedExternally(true);
                        onCancel();
                    }}
                    className="px-8 py-3 bg-red-600/20 hover:bg-red-600 border border-red-500/50 rounded-2xl transition-all duration-300 flex items-center gap-3 group"
                >
                    <span className="text-xl group-hover:rotate-90 transition-transform duration-300">✕</span>
                    <span className="font-medium">Cancel Capture</span>
                </button>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[9999] bg-black cursor-crosshair overflow-hidden touch-none select-none">
            <img
                src={image.src}
                alt="Screen Capture"
                className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none"
            />

            {/* Overlay to dim the unselected area */}
            <div className="absolute inset-0 bg-black/40 pointer-events-none" />

            {!isCapturing && (
                <Selecto
                    dragContainer={".fixed"}
                    selectableTargets={[]}
                    dragCondition={(e) => e.inputEvent.button === 0}
                    selectByClick={false}
                    selectFromInside={true}
                    continueSelect={false}
                    onSelectStart={() => {
                        setIsSelecting(true);
                        setRect(null);
                    }}
                    onSelectEnd={(e) => {
                        console.log("sssssss")
                        setIsSelecting(false);
                        const { left, top, width, height } = e.rect;
                        if (width > 5 && height > 5) {
                            setRect({ x: left, y: top, width, height });
                        }
                    }}
                />
            )}



            {/* Instructions */}


            <div className="absolute top-4 left-4 bg-black/60 text-white px-4 py-2 rounded-xl text-sm font-medium backdrop-blur-md border border-white/10">
                Press <span className="text-yellow-400 font-bold">Esc</span> to cancel
            </div>

            <button
                onClick={() => {
                    setIsClosedExternally(true);
                    onCancel();
                }}
                className="absolute top-4 right-4 bg-red-600/20 text-white w-10 h-10 rounded-xl flex items-center justify-center hover:bg-red-600 transition-all backdrop-blur-md border border-red-500/30 group"
            >
                <span className="text-xl group-hover:scale-110 transition-transform">✕</span>
            </button>
        </div>
    );
}
