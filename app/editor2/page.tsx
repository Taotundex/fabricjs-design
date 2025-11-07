"use client";

import { useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type * as fabricType from "fabric";
import NextImage from "next/image";

interface Project {
    name: string;
    thumbnail: string;
    json: string;
    updatedAt: number;
}

type ActiveType = "text" | "shape" | "image" | null;

export default function EditorPage() {
    const canvasRef = useRef<fabricType.Canvas | null>(null);
    const fabricRef = useRef<any | null>(null);
    const canvasEl = useRef<HTMLCanvasElement | null>(null);

    const undoStack = useRef<string[]>([]);
    const redoStack = useRef<string[]>([]);
    const [isReady, setIsReady] = useState(false);
    const [projects, setProjects] = useState<Project[]>([]);
    const [activeType, setActiveType] = useState<ActiveType>(null);
    const [activeAttrs, setActiveAttrs] = useState<any>({});
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

    const applyJSON = (jsonString: string) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        try {
            isApplyingRef.current = true;
            canvas.clear();
            canvas.loadFromJSON(jsonString, () => {
                canvas.renderAll();
                setTimeout(() => canvas.renderAll(), 50);
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
                console.log("Canvas element not ready, retrying...");
                setTimeout(initFabric, 100);
                return;
            }
            if (canvasRef.current || disposed) return;

            try {
                console.log("Initializing Fabric.js...");
                const fabricModule = await import("fabric");
                const fabric = (fabricModule as any).fabric || fabricModule.default || fabricModule;
                fabricRef.current = fabric;

                // Extend fabric.Object to include custom properties
                fabric.Object.prototype.toObject = (function (toObject) {
                    return function (this: any, propertiesToInclude: string[] = []) {
                        return toObject.call(this, [
                            ...propertiesToInclude,
                            "editableId",
                            "isLocked",
                            "selectable",
                            "evented",
                            "lockMovementX",
                            "lockMovementY",
                            "lockRotation",
                            "lockScalingX",
                            "lockScalingY",
                            "hasControls",
                        ]);
                    };
                })(fabric.Object.prototype.toObject);

                console.log("Creating canvas...");
                const c = new fabric.Canvas(canvasEl.current, {
                    width: 1000,
                    height: 600,
                    backgroundColor: "#fff",
                    selection: true,
                });
                canvasRef.current = c;

                // Set up event listeners
                c.on("object:added", () => {
                    if (!isApplyingRef.current) saveCurrentState();
                });
                c.on("object:modified", () => {
                    if (!isApplyingRef.current) saveCurrentState();
                });
                c.on("object:removed", () => {
                    if (!isApplyingRef.current) saveCurrentState();
                });

                c.on("selection:created", updateActiveObject);
                c.on("selection:updated", updateActiveObject);
                c.on("selection:cleared", () => {
                    setActiveType(null);
                    setActiveAttrs({});
                });

                // Load previous canvas state
                const saved = localStorage.getItem("canvas_state");
                if (saved) {
                    console.log("Loading saved state...");
                    applyJSON(saved);
                } else {
                    console.log("No saved state, starting fresh");
                    undoStack.current.push(JSON.stringify(c.toJSON()));
                }

                setIsReady(true);
                loadProjects();
                console.log("Fabric.js initialized successfully");

            } catch (error) {
                console.error("Failed to initialize Fabric.js:", error);
            }
        };

        initFabric();

        return () => {
            console.log("Cleaning up Fabric.js...");
            disposed = true;
            if (canvasRef.current) {
                try {
                    canvasRef.current.dispose();
                } catch (error) {
                    console.error("Error disposing canvas:", error);
                }
                canvasRef.current = null;
            }
            fabricRef.current = null;
        };
    }, []);

    const updateActiveObject = () => {
        const obj = canvasRef.current?.getActiveObject();
        if (!obj) {
            setActiveType(null);
            setActiveAttrs({});
            return;
        }

        if (obj.type === "i-text") {
            setActiveType("text");
            setActiveAttrs({
                fill: obj.fill,
                fontSize: obj.fontSize,
                fontWeight: obj.fontWeight,
                fontStyle: obj.fontStyle,
                underline: obj.underline,
            });
        } else if (["rect", "circle", "triangle"].includes(obj.type)) {
            setActiveType("shape");
            setActiveAttrs({
                fill: obj.fill,
                stroke: obj.stroke,
                strokeWidth: obj.strokeWidth,
            });
        } else if (obj.type === "image") {
            setActiveType("image");
            setActiveAttrs({ opacity: obj.opacity });
        }
    };

    const updateAttr = (attr: string, value: any) => {
        const obj = canvasRef.current?.getActiveObject();
        if (!obj) return;
        obj.set(attr, value);
        canvasRef.current?.renderAll();
        setActiveAttrs((prev: any) => ({ ...prev, [attr]: value }));
        saveCurrentState();
    };

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
    const addUniqueId = (obj: any) => {
        if (!obj.editableId) {
            obj.editableId = crypto.randomUUID();
        }
        return obj;
    };

    const addShape = (type: "rect" | "circle" | "triangle") => {
        if (!fabricRef.current || !canvasRef.current) return;
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
        addUniqueId(shape);
        canvasRef.current.add(shape);
    };

    const addText = () => {
        if (!fabricRef.current || !canvasRef.current) return;
        const fabric = fabricRef.current;
        const text = new fabric.IText("Edit me", {
            left: 300,
            top: 200,
            fontSize: 24,
            fill: "#000",
        });
        addUniqueId(text);
        canvasRef.current.add(text);
    };

    const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            const imgEl = new window.Image();
            imgEl.onload = () => {
                const imgInstance = new fabricRef.current.Image(imgEl, {
                    left: 100,
                    top: 100,
                });
                addUniqueId(imgInstance);
                canvasRef.current?.add(imgInstance);
                canvasRef.current?.renderAll();
                saveCurrentState();
            };
            imgEl.src = result;
        };
        reader.readAsDataURL(file);
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

        const isNowLocked = !obj.isLocked;

        obj.set({
            isLocked: isNowLocked,
            lockMovementX: isNowLocked,
            lockMovementY: isNowLocked,
            lockRotation: isNowLocked,
            lockScalingX: isNowLocked,
            lockScalingY: isNowLocked,
            selectable: !isNowLocked,
            evented: !isNowLocked,
            hasControls: !isNowLocked,
            opacity: isNowLocked ? 0.6 : 1,
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
                isLocked: false,
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
            applyJSON(jsonString);
            (e.target as HTMLInputElement).value = "";
        };
        reader.readAsText(file);
    };

    // ===================== RENDER =====================
    return (
        <div className="flex h-screen bg-gray-100">
            {/* ===== LEFT TOOLS ===== */}
            <div className="flex flex-col w-[200px] gap-2 bg-white shadow p-3 border-b">
                <Button size='lg' onClick={() => addShape("rect")}>Rectangle</Button>
                <Button size='lg' onClick={() => addShape("circle")}>Circle</Button>
                <Button size='lg' onClick={() => addShape("triangle")}>Triangle</Button>
                <Button size='lg' onClick={addText}>Text</Button>

                <label className="text-center py-2 cursor-pointer bg-blue-500 text-white px-3 rounded-md">
                    Upload Image
                    <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
                </label>

                <Button size='lg' variant="destructive" onClick={deleteSelected}>
                    Delete
                </Button>
                <Button size='lg' onClick={undo}>Undo</Button>
                <Button size='lg' onClick={redo}>Redo</Button>
                <Button size='lg' variant="secondary" onClick={toggleLock}>
                    Lock / Unlock
                </Button>
                <Button size='lg' variant="secondary" onClick={unlockAll}>
                    Unlock All
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size='lg' variant="outline">Export</Button>
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

                <label className="cursor-pointer border rounded-md px-3 py-2">
                    Load JSON
                    <input type="file" accept=".json" className="hidden" onChange={loadJSON} />
                </label>
            </div>

            {/* ===== MAIN CANVAS + ATTRIBUTES ===== */}
            <div className="flex flex-col flex-1">
                {/* Dynamic Top Bar */}
                {activeType && (
                    <div className="flex items-center gap-4 p-2 bg-white border-b shadow-sm">
                        {activeType === "text" && (
                            <>
                                <label>
                                    Color:
                                    <input
                                        type="color"
                                        value={activeAttrs.fill || "#000000"}
                                        onChange={(e) => updateAttr("fill", e.target.value)}
                                        className="ml-2"
                                    />
                                </label>
                                <label>
                                    Font Size:
                                    <input
                                        type="number"
                                        value={activeAttrs.fontSize || 24}
                                        onChange={(e) => updateAttr("fontSize", parseInt(e.target.value))}
                                        className="ml-2 w-20"
                                    />
                                </label>
                                <Button
                                    variant={activeAttrs.fontWeight === "bold" ? "default" : "outline"}
                                    onClick={() =>
                                        updateAttr("fontWeight", activeAttrs.fontWeight === "bold" ? "normal" : "bold")
                                    }
                                >
                                    B
                                </Button>
                                <Button
                                    variant={activeAttrs.fontStyle === "italic" ? "default" : "outline"}
                                    onClick={() =>
                                        updateAttr("fontStyle", activeAttrs.fontStyle === "italic" ? "normal" : "italic")
                                    }
                                >
                                    I
                                </Button>
                                <Button
                                    variant={activeAttrs.underline ? "default" : "outline"}
                                    onClick={() => updateAttr("underline", !activeAttrs.underline)}
                                >
                                    U
                                </Button>
                            </>
                        )}

                        {activeType === "shape" && (
                            <>
                                <label>
                                    Fill:
                                    <input
                                        type="color"
                                        value={activeAttrs.fill || "#000000"}
                                        onChange={(e) => updateAttr("fill", e.target.value)}
                                        className="ml-2"
                                    />
                                </label>
                                <label>
                                    Stroke:
                                    <input
                                        type="color"
                                        value={activeAttrs.stroke || "#000000"}
                                        onChange={(e) => updateAttr("stroke", e.target.value)}
                                        className="ml-2"
                                    />
                                </label>
                                <label>
                                    Stroke Width:
                                    <input
                                        type="number"
                                        value={activeAttrs.strokeWidth || 1}
                                        onChange={(e) => updateAttr("strokeWidth", parseFloat(e.target.value))}
                                        className="ml-2 w-20"
                                    />
                                </label>
                            </>
                        )}

                        {activeType === "image" && (
                            <>
                                <label>
                                    Opacity:
                                    <input
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        value={activeAttrs.opacity || 1}
                                        onChange={(e) => updateAttr("opacity", parseFloat(e.target.value))}
                                        className="ml-2 w-40"
                                    />
                                </label>
                            </>
                        )}
                    </div>
                )}

                <div className="flex justify-center items-center flex-1 overflow-auto">
                    {!isReady && (
                        <div className="flex items-center justify-center w-full h-full">
                            <div className="text-lg">Loading canvas...</div>
                        </div>
                    )}
                    <canvas 
                        ref={canvasEl} 
                        className="border shadow-lg rounded-lg bg-white"
                        style={{ display: isReady ? 'block' : 'none' }}
                    />
                </div>
            </div>

            {/* ===== RIGHT SIDEBAR ===== */}
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
        </div>
    );
}