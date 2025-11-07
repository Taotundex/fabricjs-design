"use client";

import { useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuPortal,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type * as fabricType from "fabric";
import NextImage from "next/image";

interface Project {
    name: string;
    thumbnail: string;
    json: string;
    updatedAt: number;
}

interface OCRResult {
    text: string;
    confidence: number;
    bbox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

export default function EditorPage() {
    const canvasRef = useRef<fabricType.Canvas | null>(null);
    const fabricRef = useRef<any | null>(null);
    const canvasEl = useRef<HTMLCanvasElement | null>(null);
    const [isFabricReady, setIsFabricReady] = useState(false);


    const undoStack = useRef<string[]>([]);
    const redoStack = useRef<string[]>([]);
    const [isReady, setIsReady] = useState(false);
    const [projects, setProjects] = useState<Project[]>([]);
    const [isProcessingOCR, setIsProcessingOCR] = useState(false);
    const [showOCRLoader, setShowOCRLoader] = useState(false);
    const isApplyingRef = useRef(false);

    const handlersRef = useRef({
        undo: () => { },
        redo: () => { },
        deleteSelected: () => { },
        saveProject: () => { },
        loadLatest: () => { },
    });

    // ===================== STATE SAVE / LOAD =====================
    const saveCurrentState = () => {
        if (isApplyingRef.current) return;
        const c = canvasRef.current;
        if (!c) return;
        try {
            const json = JSON.stringify(c.toJSON());
            undoStack.current.push(json);
            redoStack.current = [];
            localStorage.setItem("canvas_state", json);
            localStorage.setItem("canvas_state_ts", String(Date.now()));
        } catch (err) {
            console.error("Error saving state:", err);
        }
    };

    const applyJSON = async (jsonString: string) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        try {
            isApplyingRef.current = true;
            canvas.clear();

            await canvas.loadFromJSON(jsonString, () => {
                canvas.renderAll();
                setTimeout(() => canvas.renderAll(), 100);
                undoStack.current.push(jsonString);
                redoStack.current = [];
                isApplyingRef.current = false;
            });
        } catch (err) {
            console.error("applyJSON failed:", err);
            isApplyingRef.current = false;
        }
    };
    // ===================== INIT FABRIC =====================
    useEffect(() => {
        let disposed = false;
        const initFabric = async () => {
            if (!canvasEl.current) {
                setTimeout(initFabric, 100);
                return;
            }
            if (canvasRef.current || disposed) return;

            const fabricModule = await import("fabric");
            const fabric = (fabricModule as any).fabric || fabricModule.default || fabricModule;
            fabricRef.current = fabric;

            // ✅ Enhanced toObject to include all necessary properties
            fabric.Object.prototype.toObject = (function (toObject) {
                return function (this: any, propertiesToInclude: string[] = []) {
                    return toObject.call(this, [
                        ...propertiesToInclude,
                        "selectable",
                        "evented",
                        "lockMovementX",
                        "lockMovementY",
                        "lockRotation",
                        "lockScalingX",
                        "lockScalingY",
                        "hasControls",
                        "opacity",
                        "name", // Include name property for images
                    ]);
                };
            })(fabric.Object.prototype.toObject);

            fabric.Image.prototype.toObject = (function (toObject) {
                return function (this: any) {
                    return fabric.util.object.extend(toObject.call(this), {
                        crossOrigin: 'anonymous'
                    });
                };
            })(fabric.Image.prototype.toObject);

            const c = new fabric.Canvas(canvasEl.current, {
                width: 1000,
                height: 600,
                backgroundColor: "#fff",
                selection: true,
            });
            canvasRef.current = c;

            c.on("object:added", () => {
                if (!isApplyingRef.current) saveCurrentState();
            });
            c.on("object:modified", () => {
                if (!isApplyingRef.current) saveCurrentState();
            });
            c.on("object:removed", () => {
                if (!isApplyingRef.current) saveCurrentState();
            });

            // Load previous canvas
            const saved = localStorage.getItem("canvas_state");
            if (saved) applyJSON(saved);
            else undoStack.current.push(JSON.stringify(c.toJSON()));

            setIsReady(true);
            setIsFabricReady(true);
            loadProjects();
        };

        initFabric();

        return () => {
            disposed = true;
            if (canvasRef.current) {
                try {
                    canvasRef.current.dispose();
                } catch { }
                canvasRef.current = null;
            }
            fabricRef.current = null;
        };
    }, []);

    // ===================== PROJECTS =====================
    const loadProjects = () => {
        const list = localStorage.getItem("projects");
        if (!list) {
            setProjects([]);
            return;
        }
        try {
            const parsed: Project[] = JSON.parse(list);
            setProjects(parsed);
        } catch {
            setProjects([]);
        }
    };

    const saveProject = () => {
        const c = canvasRef.current;
        if (!c) return;
        const json = JSON.stringify(c.toJSON());
        const name = prompt("Enter project name:")?.trim();
        if (!name) return;

        const thumbnail = c.toDataURL({ format: "png", quality: 0.6, multiplier: 1 });
        const project: Project = {
            name,
            thumbnail,
            json,
            updatedAt: Date.now(),
        };

        const updated = [...projects.filter((p) => p.name !== name), project];
        localStorage.setItem("projects", JSON.stringify(updated));
        setProjects(updated);
        console.log(`💾 Saved project: ${name}`);
    };

    const loadProject = (project: Project) => {
        applyJSON(project.json);
        console.log(`📂 Loaded project: ${project.name}`);
    };

    const deleteProject = (name: string) => {
        const updated = projects.filter((p) => p.name !== name);
        localStorage.setItem("projects", JSON.stringify(updated));
        setProjects(updated);
    };

    const loadLatestProject = () => {
        if (!projects.length) return;
        const latest = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (latest) loadProject(latest);
    };

    // ===================== TOOLS =====================
    const addShape = (type: "rect" | "circle" | "triangle") => {
        if (!fabricRef.current || !canvasRef.current) {
            alert("Editor is not ready yet. Please wait a moment and try again.");
            return;
        }
        const fabric = fabricRef.current;
        let shape: any;

        switch (type) {
            case "rect":
                shape = new fabric.Rect({
                    left: 100,
                    top: 100,
                    width: 120,
                    height: 80,
                    fill: "#38bdf8",
                });
                break;
            case "circle":
                shape = new fabric.Circle({
                    left: 150,
                    top: 150,
                    radius: 50,
                    fill: "#a3e635",
                });
                break;
            case "triangle":
                shape = new fabric.Triangle({
                    left: 200,
                    top: 200,
                    width: 100,
                    height: 100,
                    fill: "#f87171",
                });
                break;
        }

        canvasRef.current.add(shape);
    };

    const addText = () => {
        if (!fabricRef.current || !canvasRef.current) {
            alert("Editor is not ready yet. Please wait a moment and try again.");
            return;
        }
        const fabric = fabricRef.current;
        const text = new fabric.IText("Edit me", {
            left: 300,
            top: 200,
            fontSize: 24,
            fill: "#000",
        });
        canvasRef.current.add(text);
    };

    // ===================== PURE CLIENT-SIDE OCR =====================
    const performOCR = async (imageData: string): Promise<OCRResult[]> => {
        try {
            // Try browser's built-in OCR first (Chrome 94+)
            if (typeof window !== 'undefined' && 'OCR' in window) {
                const results = await performBrowserOCR(imageData);
                if (results.length > 0) return results;
            }

            // Fallback to external OCR API
            const apiResults = await performExternalOCR(imageData);
            if (apiResults.length > 0) return apiResults;

            // Final fallback: manual input
            return await manualTextInput();

        } catch (error) {
            console.error('OCR Error:', error);
            return await manualTextInput();
        }
    };

    const performBrowserOCR = async (imageData: string): Promise<OCRResult[]> => {
        try {
            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = imageData;
            });

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d')!;
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            // @ts-ignore - Chrome OCR API
            if (typeof OCR === 'undefined') return [];

            // @ts-ignore
            const detector = new OCR();
            // @ts-ignore
            const texts = await detector.detect(canvas);

            return texts.map((text: any) => ({
                text: text.rawValue,
                confidence: 90,
                bbox: {
                    x: text.boundingBox.x,
                    y: text.boundingBox.y,
                    width: text.boundingBox.width,
                    height: text.boundingBox.height
                }
            }));
        } catch (error) {
            console.log('Browser OCR not available');
            return [];
        }
    };

    const performExternalOCR = async (imageData: string): Promise<OCRResult[]> => {
        try {
            // Convert base64 to blob
            const response = await fetch(imageData);
            const blob = await response.blob();

            const formData = new FormData();
            formData.append('file', blob, 'image.png');

            // Using free OCR API - you can replace this with any OCR service
            const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
                method: 'POST',
                headers: {
                    'apikey': 'K87899142388957', // Free API key
                },
                body: formData
            });

            const result = await ocrResponse.json();

            if (result.IsErroredOnProcessing) {
                throw new Error(result.ErrorMessage);
            }

            if (!result.ParsedResults?.[0]?.TextOverlay?.Lines) {
                return [];
            }

            return result.ParsedResults[0].TextOverlay.Lines.map((line: any) => ({
                text: line.LineText,
                confidence: line.MaxConfidence,
                bbox: {
                    x: line.Words[0]?.Left || 100,
                    y: line.Words[0]?.Top || 100,
                    width: line.Words[0]?.Width || 200,
                    height: line.Words[0]?.Height || 30
                }
            }));
        } catch (error) {
            console.error('External OCR failed:', error);
            return [];
        }
    };

    const manualTextInput = async (): Promise<OCRResult[]> => {
        const text = prompt(
            'OCR not available or no text detected.\n\n' +
            'Enter the text you want to add manually (you can add multiple lines separated by commas):'
        );

        if (!text) return [];

        // Split by commas for multiple text entries
        const textLines = text.split(',').map(t => t.trim()).filter(t => t.length > 0);

        return textLines.map((line, index) => ({
            text: line,
            confidence: 100,
            bbox: {
                x: 100,
                y: 100 + (index * 40),
                width: line.length * 10,
                height: 30
            }
        }));
    };

    const createEditableTextFromOCR = (ocrResult: OCRResult) => {
        if (!fabricRef.current || !canvasRef.current) return;
        const fabric = fabricRef.current;

        const text = new fabric.IText(ocrResult.text, {
            left: ocrResult.bbox.x,
            top: ocrResult.bbox.y,
            fontSize: Math.max(16, ocrResult.bbox.height * 0.6),
            fill: "#000000",
            fontFamily: "Arial, sans-serif",
            backgroundColor: "rgba(255, 255, 255, 0.9)",
            padding: 5,
            stroke: "#333333",
            strokeWidth: 0.2,
            cornerStyle: 'circle',
            transparentCorners: false,
            cornerColor: '#22c55e',
        });

        canvasRef.current.add(text);
        canvasRef.current.setActiveObject(text);
        return text;
    };



    const handleUploadWithOCR = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Reset file input
        (e.target as HTMLInputElement).value = '';

        // Check if fabric is loaded
        if (!fabricRef.current || !canvasRef.current) {
            alert("Editor is not ready yet. Please wait a moment and try again.");
            return;
        }

        setIsProcessingOCR(true);

        const reader = new FileReader();
        reader.onload = async () => {
            const result = reader.result as string;

            // Add the original image to canvas
            const imgEl = new window.Image();
            imgEl.onload = async () => {
                // Double check fabric is still available
                if (!fabricRef.current || !canvasRef.current) {
                    alert("Editor became unavailable. Please refresh the page.");
                    setIsProcessingOCR(false);
                    return;
                }

                const imgInstance = new fabricRef.current.Image(imgEl, {
                    left: 50,
                    top: 50,
                    selectable: true,
                    evented: true,
                    opacity: 0.8,
                    name: 'uploaded-image',
                });

                canvasRef.current.add(imgInstance);
                canvasRef.current.renderAll();

                // Perform OCR to extract text
                try {
                    const ocrResults = await performOCR(result);

                    // Create editable text objects from OCR results
                    let createdCount = 0;
                    ocrResults.forEach((ocrResult) => {
                        if (ocrResult.confidence > 50 && ocrResult.text.trim().length > 0) {
                            createEditableTextFromOCR(ocrResult);
                            createdCount++;
                        }
                    });

                    canvasRef.current.renderAll();
                    saveCurrentState();

                    console.log(`✅ Extracted ${createdCount} editable text elements`);

                    if (createdCount === 0) {
                        alert('No text detected or OCR failed. You can add text manually using the Text tool.');
                    }
                } catch (error) {
                    console.error('OCR processing failed:', error);
                    alert('OCR processing failed. You can add text manually using the Text tool.');
                } finally {
                    setIsProcessingOCR(false);
                }
            };
            imgEl.src = result;
        };
        reader.readAsDataURL(file);
    };

    // Original upload function (without OCR)
    const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Check if fabric is loaded
        if (!fabricRef.current || !canvasRef.current) {
            alert("Editor is not ready yet. Please wait a moment and try again.");
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            const imgEl = new window.Image();
            imgEl.onload = () => {
                // Double check fabric is still available
                if (!fabricRef.current || !canvasRef.current) {
                    alert("Editor became unavailable. Please refresh the page.");
                    return;
                }

                const imgInstance = new fabricRef.current.Image(imgEl, {
                    left: 100,
                    top: 100,
                    selectable: true,
                    evented: true,
                });
                canvasRef.current.add(imgInstance);
                canvasRef.current.renderAll();
                saveCurrentState();
            };
            imgEl.src = result;
        };
        reader.readAsDataURL(file);
    };

    // Convert entire canvas to editable JSON
    const convertCanvasToEditableJSON = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const jsonData = canvas.toJSON();
        const jsonString = JSON.stringify(jsonData, null, 2);

        // Download as JSON file
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `editable-canvas-${Date.now()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        console.log('✅ Canvas exported as editable JSON');
    };

    const deleteSelected = () => {
        const objs = canvasRef.current?.getActiveObjects();
        if (!objs?.length) return;
        objs.forEach((o) => canvasRef.current?.remove(o));
        canvasRef.current?.discardActiveObject();
        canvasRef.current?.renderAll();
        saveCurrentState();
    };

    const undo = () => {
        if (undoStack.current.length > 1) {
            const current = undoStack.current.pop()!;
            redoStack.current.push(current);
            const prev = undoStack.current[undoStack.current.length - 1];
            if (prev) applyJSON(prev);
        }
    };

    const redo = () => {
        if (redoStack.current.length > 0) {
            const next = redoStack.current.pop()!;
            undoStack.current.push(next);
            applyJSON(next);
        }
    };

    // ===================== LOCK / UNLOCK =====================
    const toggleLock = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const obj = canvas.getActiveObject();
        if (!obj) {
            alert("Select an object to lock or unlock.");
            return;
        }

        const isLocked = !obj.selectable;

        obj.set({
            lockMovementX: isLocked ? false : true,
            lockMovementY: isLocked ? false : true,
            lockRotation: isLocked ? false : true,
            lockScalingX: isLocked ? false : true,
            lockScalingY: isLocked ? false : true,
            selectable: isLocked ? true : false,
            evented: isLocked ? true : false,
            hasControls: isLocked ? true : false,
            opacity: isLocked ? 1 : 0.6,
        });

        canvas.discardActiveObject();
        canvas.requestRenderAll();
        saveCurrentState();
    };

    const unlockAll = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.getObjects().forEach((obj) => {
            obj.set({
                lockMovementX: false,
                lockMovementY: false,
                lockRotation: false,
                lockScalingX: false,
                lockScalingY: false,
                selectable: true,
                evented: true,
                hasControls: true,
                opacity: 1,
            });
        });
        canvas.requestRenderAll();
        saveCurrentState();
    };

    // keep handlers updated
    handlersRef.current = { undo, redo, deleteSelected, saveProject, loadLatest: loadLatestProject };

    // ===================== Keyboard Shortcuts =====================
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const active = document.activeElement as HTMLElement | null;
            const isEditable =
                !!active &&
                (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
            if (isEditable) return;

            const isMod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();

            if (isMod && key === "z") {
                e.preventDefault();
                if (e.shiftKey) handlersRef.current.redo();
                else handlersRef.current.undo();
            } else if (isMod && key === "y") {
                e.preventDefault();
                handlersRef.current.redo();
            } else if (key === "delete" || key === "backspace") {
                e.preventDefault();
                handlersRef.current.deleteSelected();
            } else if (isMod && key === "s") {
                e.preventDefault();
                handlersRef.current.saveProject();
            } else if (isMod && key === "o") {
                e.preventDefault();
                handlersRef.current.loadLatest();
            }
        };

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // ===================== EXPORT =====================
    const exportImage = (type: "png" | "jpg") => {
        const format = type === "jpg" ? "jpeg" : type;
        const data = canvasRef.current?.toDataURL({ format });
        const link = document.createElement("a");
        link.href = data!;
        link.download = `canvas.${type}`;
        link.click();
    };

    const exportPDF = () => {
        const data = canvasRef.current?.toDataURL({ format: "png" });
        const pdf = new jsPDF("l", "pt", "a4");
        pdf.addImage(data!, "PNG", 0, 0, 800, 600);
        pdf.save("canvas.pdf");
    };

    const saveJSON = () => {
        const json = JSON.stringify(canvasRef.current?.toJSON());
        const blob = new Blob([json], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "project.json";
        link.click();
    };

    const loadJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const jsonString = reader.result as string;
            loadCanvasFromJSON(jsonString);
            (e.target as HTMLInputElement).value = "";
        };
        reader.readAsText(file);
    };

    const loadCanvasFromJSON = async (jsonString: string) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        try {
            isApplyingRef.current = true;
            canvas.clear();

            // Parse the JSON and handle image reconstruction
            const parsed = JSON.parse(jsonString);

            // Load the canvas from JSON
            await canvas.loadFromJSON(jsonString, () => {
                canvas.renderAll();

                // Additional render to ensure everything displays properly
                setTimeout(() => {
                    canvas.renderAll();
                    undoStack.current.push(jsonString);
                    redoStack.current = [];
                    isApplyingRef.current = false;
                }, 100);
            });

        } catch (err) {
            console.error("loadCanvasFromJSON failed:", err);
            isApplyingRef.current = false;
            alert("Failed to load the JSON file. It may be corrupted or incompatible.");
        }
    };

    // ===================== RENDER =====================
    // ===================== RENDER =====================
    return (
        <div className="flex h-screen bg-gray-100">
            {/* MAIN EDITOR */}
            <div className="flex gap-10 w-full">
                <div className="flex flex-col w-[200px] gap-2 bg-white shadow p-3 border-b">
                    <Button size='lg' onClick={() => addShape("rect")}>Rectangle</Button>
                    <Button size='lg' onClick={() => addShape("circle")}>Circle</Button>
                    <Button size='lg' onClick={() => addShape("triangle")}>Triangle</Button>
                    <Button size='lg' onClick={addText}>Text</Button>

                    {/* Regular image upload */}
                    <label className="text-center py-2 cursor-pointer bg-blue-500 text-white px-3 rounded-md">
                        Upload Image
                        <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
                    </label>

                    {/* OCR image upload */}
                    <label className="text-center py-2 cursor-pointer bg-green-600 text-white px-3 rounded-md">
                        {isProcessingOCR ? "Processing OCR..." : "Upload & Extract Text"}
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleUploadWithOCR}
                            disabled={isProcessingOCR}
                        />
                    </label>

                    {/* Export as editable JSON */}
                    <Button size='lg' variant="outline" onClick={convertCanvasToEditableJSON}>
                        Export Editable JSON
                    </Button>

                    <Button size='lg' variant="destructive" onClick={deleteSelected}>
                        Delete
                    </Button>
                    <Button size='lg' onClick={undo}>Undo</Button>
                    <Button size='lg' onClick={redo}>Redo</Button>

                    {/* 🔒 Lock / Unlock buttons */}
                    <Button size='lg' variant="secondary" onClick={toggleLock}>
                        Lock / Unlock
                    </Button>
                    <Button size='lg' variant="secondary" onClick={unlockAll}>
                        Unlock All
                    </Button>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button size='lg' variant="outline">Save as</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-20" align="start">
                            <DropdownMenuLabel>
                                <Button size='lg' variant="outline" onClick={() => exportImage("png")}>
                                    PNG
                                </Button>
                            </DropdownMenuLabel>
                            <DropdownMenuLabel>
                                <Button size='lg' variant="outline" onClick={() => exportImage("jpg")}>
                                    JPG
                                </Button>
                            </DropdownMenuLabel>
                            <DropdownMenuLabel>
                                <Button size='lg' variant="outline" onClick={exportPDF}>
                                    PDF
                                </Button>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>
                                <Button size='lg' variant="outline" onClick={saveJSON}>
                                    JSON
                                </Button>
                            </DropdownMenuLabel>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <label className="cursor-pointer border rounded-md px-3 py-1 text-center">
                        Load JSON
                        <input type="file" accept=".json" className="hidden" onChange={loadJSON} />
                    </label>
                </div>

                {/* CANVAS CONTAINER WITH LOADING STATE */}
                <div className="flex justify-center items-center overflow-auto w-full relative">
                    {!isFabricReady && (
                        <div className="absolute inset-0 bg-white bg-opacity-80 flex items-center justify-center z-10">
                            <div className="text-lg">Loading editor...</div>
                        </div>
                    )}
                    <canvas ref={canvasEl} className="border shadow-lg rounded-lg" />
                </div>
            </div>

            {/* LEFT SIDEBAR */}
            <aside className="w-64 bg-white border-r shadow-md flex flex-col">
                <div className="p-3 border-b flex justify-between items-center">
                    <h2 className="font-semibold text-lg">Projects</h2>
                    <Button size="sm" onClick={saveProject}>
                        Save
                    </Button>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {projects.length === 0 && (
                        <div className="text-gray-500 text-sm p-4">No projects yet</div>
                    )}
                    {projects.map((project) => (
                        <div
                            key={project.name}
                            className="flex items-center gap-3 p-3 hover:bg-gray-100 cursor-pointer group"
                            onClick={() => loadProject(project)}
                        >
                            <NextImage
                                src={project.thumbnail}
                                alt={project.name}
                                width={48}
                                height={48}
                                className="w-12 h-12 object-cover rounded border"
                            />
                            <div className="flex-1">
                                <div className="font-medium">{project.name}</div>
                                <div className="text-xs text-gray-400">
                                    {new Date(project.updatedAt).toLocaleString()}
                                </div>
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    deleteProject(project.name);
                                }}
                                className="text-red-500 text-xs opacity-0 group-hover:opacity-100 transition"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            </aside>

            {/* FIXED OVERLAY - MOVED OUTSIDE THE MAIN FLEX CONTAINER */}
            {isProcessingOCR && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white p-6 rounded-lg shadow-lg max-w-sm">
                        <div className="flex items-center space-x-3">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <div>
                                <p className="text-lg font-medium">Processing OCR</p>
                                <p className="text-sm text-gray-600">Extracting text from image...</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}