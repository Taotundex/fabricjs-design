"use client";

import React, { useState, useRef } from "react";
import { createWorker } from "tesseract.js";
import { fabric } from "fabric";

export default function OcrCanvasEditor() {
    const [ocrText, setOcrText] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<fabric.Canvas | null>(null);

    const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target?.result as string;
            loadImageToCanvas(dataUrl);
            await runOCR(dataUrl);
        };
        reader.readAsDataURL(file);
    };

    const loadImageToCanvas = (dataUrl: string) => {
        if (!canvasRef.current) return;

        if (!fabricRef.current) {
            const fabricCanvas = new fabric.Canvas(canvasRef.current, {
                backgroundColor: "#f9f9f9",
                width: 800,
                height: 500,
            });
            fabricRef.current = fabricCanvas;
        }

        fabric.Image.fromURL(dataUrl, (img) => {
            const canvas = fabricRef.current;
            if (!canvas) return;

            canvas.clear();
            img.scaleToWidth(700);
            img.set({ left: 50, top: 30 });
            canvas.add(img);
            canvas.renderAll();
        });
    };

    const runOCR = async (dataUrl: string) => {
        setIsProcessing(true);
        try {
            const worker = await createWorker("eng"); // ✅ Browser-compatible
            const ret = await worker.recognize(dataUrl);
            setOcrText(ret.data.text);
            await worker.terminate();
        } catch (err) {
            console.error("OCR Error:", err);
            alert("OCR failed, try again with a clearer image.");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="p-6 space-y-6">
            <h1 className="text-2xl font-bold">🧠 OCR + Editable Canvas</h1>

            <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="border p-2 rounded"
            />

            {isProcessing && <p className="text-blue-600">Processing image...</p>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border rounded p-2">
                    <canvas ref={canvasRef} />
                </div>

                <div className="border rounded p-2">
                    <h2 className="font-semibold mb-2">Extracted Text (Editable)</h2>
                    <textarea
                        value={ocrText}
                        onChange={(e) => setOcrText(e.target.value)}
                        className="w-full h-64 border rounded p-2"
                    />
                </div>
            </div>
        </div>
    );
}
