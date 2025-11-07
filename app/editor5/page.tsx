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

type ActiveType = "text" | "shape" | "image" | "balloon" | "balloon-text" | null;

export default function EditorPage() {
    const canvasRef = useRef<fabricType.Canvas | null>(null);
    const fabricRef = useRef<any | null>(null);
    const canvasEl = useRef<HTMLCanvasElement | null>(null);

    const undoStack = useRef<string[]>([]);
    const redoStack = useRef<string[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [activeType, setActiveType] = useState<ActiveType>(null);
    const [activeAttrs, setActiveAttrs] = useState<any>({});
    const [autoFitEnabled, setAutoFitEnabled] = useState(true);
    const [balloonName, setBalloonName] = useState("");
    const [balloonColor, setBalloonColor] = useState("#e879f9");
    const [textColor, setTextColor] = useState("#000000");
    const isApplyingRef = useRef(false);

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

    // ===================== APPLY JSON (Enhanced) =====================
    const applyJSON = (jsonString: string, autoFit = false) => {
        const canvas = canvasRef.current;
        const fabric = fabricRef.current;
        if (!canvas || !fabric) return;

        try {
            isApplyingRef.current = true;
            canvas.clear();

            canvas.loadFromJSON(jsonString, () => {
                canvas.renderAll();

                // ✅ Auto-fit and center
                if (autoFit) {
                    const objects = canvas.getObjects();
                    if (objects.length > 0) {
                        const boundingRect = getBoundingRect(objects);
                        if (boundingRect) {
                            const scaleX = (canvas.width ?? 1) / boundingRect.width;
                            const scaleY = (canvas.height ?? 1) / boundingRect.height;
                            const scale = Math.min(scaleX, scaleY) * 0.9;

                            const group = new fabric.Group(objects);
                            group.scale(scale);
                            group.left = ((canvas.width ?? 0) - boundingRect.width * scale) / 2;
                            group.top = ((canvas.height ?? 0) - boundingRect.height * scale) / 2;

                            canvas.clear();
                            canvas.add(...group._objects);
                            group._restoreObjectsState();
                            canvas.remove(group);
                            canvas.renderAll();
                        }
                    }
                }

                setTimeout(() => canvas.renderAll(), 50);
                undoStack.current.push(jsonString);
                redoStack.current = [];
                isApplyingRef.current = false;
            });
        } catch (err) {
            console.error("❌ applyJSON failed:", err);
            alert("Error loading JSON file. Make sure it's a valid saved project file.");
            isApplyingRef.current = false;
        }
    };

    // Helper for bounding box
    function getBoundingRect(objects: any[]) {
        if (!objects.length) return null;
        const minX = Math.min(...objects.map((o) => o.left ?? 0));
        const minY = Math.min(...objects.map((o) => o.top ?? 0));
        const maxX = Math.max(
            ...objects.map((o) => (o.left ?? 0) + (o.width ?? 0) * (o.scaleX ?? 1))
        );
        const maxY = Math.max(
            ...objects.map((o) => (o.top ?? 0) + (o.height ?? 0) * (o.scaleY ?? 1))
        );
        return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
    }

    // ===================== LOAD JSON (Enhanced) =====================
    const loadJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const jsonString = reader.result as string;
            if (!confirm("Replace current design with this file? Unsaved changes will be lost.")) {
                (e.target as HTMLInputElement).value = "";
                return;
            }
            applyJSON(jsonString, autoFitEnabled);
            (e.target as HTMLInputElement).value = "";
        };
        reader.readAsText(file);
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
                        "opacity",
                        "letter", // Add letter property for balloon text
                    ]);
                };
            })(fabric.Object.prototype.toObject);

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

            c.on("selection:created", updateActiveObject);
            c.on("selection:updated", updateActiveObject);
            c.on("selection:cleared", () => {
                setActiveType(null);
                setActiveAttrs({});
            });

            const saved = localStorage.getItem("canvas_state");
            if (saved) applyJSON(saved);
            else undoStack.current.push(JSON.stringify(c.toJSON()));

            loadProjects();
        };

        initFabric();
        return () => {
            disposed = true;
            canvasRef.current?.dispose();
            canvasRef.current = null;
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
        const project: Project = { name, thumbnail, json, updatedAt: Date.now() };

        const updated = [...projects.filter((p) => p.name !== name), project];
        localStorage.setItem("projects", JSON.stringify(updated));
        setProjects(updated);
        console.log(`💾 Saved project: ${name}`);
    };

    const loadProject = (project: Project) => applyJSON(project.json, autoFitEnabled);
    const deleteProject = (name: string) => {
        const updated = projects.filter((p) => p.name !== name);
        localStorage.setItem("projects", JSON.stringify(updated));
        setProjects(updated);
    };

    // ===================== BALLOON WITH TEXT FUNCTIONS =====================
    const createBalloonWithText = (letter: string, index: number, total: number) => {
        const fabric = fabricRef.current;
        if (!fabric || !canvasRef.current) return;

        // Calculate position to spread balloons evenly
        const startX = 200;
        const spacing = 80;
        const x = startX + (index * spacing);
        const y = 200 + (Math.sin(index * 0.5) * 30); // Slight wave pattern

        // Create balloon circle
        const balloonCircle = new fabric.Circle({
            radius: 35,
            fill: balloonColor,
            left: 0,
            top: 0,
            originX: 'center',
            originY: 'center',
            stroke: '#ffffff',
            strokeWidth: 2,
        });

        // Create balloon string
        const balloonString = new fabric.Triangle({
            width: 4,
            height: 30,
            fill: "#6b7280",
            left: 0,
            top: 35,
            originX: 'center',
            originY: 'top',
            angle: 180
        });

        // Create text for the balloon
        const balloonText = new fabric.Text(letter, {
            fontSize: 20,
            fill: textColor,
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
            left: 0,
            top: 0,
            originX: 'center',
            originY: 'center',
            selectable: false,
            evented: false,
        });

        // Create group with all elements
        const balloonGroup = new fabric.Group([balloonCircle, balloonString, balloonText], {
            left: x,
            top: y,
            editableId: `balloon_${Date.now()}_${index}`,
            isLocked: false,
            letter: letter, // Store the letter for customer editing
            balloonColor: balloonColor, // Store color for customer editing
            textColor: textColor, // Store text color for customer editing
        });

        canvasRef.current.add(balloonGroup);
    };

    const addBalloonName = () => {
        if (!balloonName.trim()) {
            alert("Please enter a name for the balloons");
            return;
        }

        const name = balloonName.trim();
        const letters = name.split('');

        letters.forEach((letter, index) => {
            createBalloonWithText(letter, index, letters.length);
        });

        // Clear the input after creating balloons
        setBalloonName("");
    };

    const addSingleBalloon = () => {
        if (!fabricRef.current || !canvasRef.current) return;
        const fabric = fabricRef.current;

        const balloonCircle = new fabric.Circle({
            radius: 40,
            fill: "#e879f9",
            left: 0,
            top: 0,
            originX: 'center',
            originY: 'center',
            stroke: '#ffffff',
            strokeWidth: 2,
        });

        const balloonString = new fabric.Triangle({
            width: 5,
            height: 40,
            fill: "#6b7280",
            left: 0,
            top: 40,
            originX: 'center',
            originY: 'top',
            angle: 180
        });

        const balloonGroup = new fabric.Group([balloonCircle, balloonString], {
            left: 250,
            top: 150,
            editableId: `balloon_${Date.now()}`,
            isLocked: false,
            balloonColor: "#e879f9",
        });

        canvasRef.current.add(balloonGroup);
    };

    // ===================== BASIC TOOLS (Add / Delete / Undo / Redo) =====================
    const addShape = (type: "rect" | "circle" | "triangle") => {
        if (!fabricRef.current || !canvasRef.current) return;
        const fabric = fabricRef.current;
        let shape: any;

        if (type === "rect")
            shape = new fabric.Rect({
                left: 100,
                top: 100,
                width: 120,
                height: 80,
                fill: "#38bdf8",
                editableId: `shape_${Date.now()}`,
                isLocked: false
            });
        else if (type === "circle")
            shape = new fabric.Circle({
                left: 150,
                top: 150,
                radius: 50,
                fill: "#a3e635",
                editableId: `shape_${Date.now()}`,
                isLocked: false
            });
        else if (type === "triangle")
            shape = new fabric.Triangle({
                left: 200,
                top: 200,
                width: 100,
                height: 100,
                fill: "#f87171",
                editableId: `shape_${Date.now()}`,
                isLocked: false
            });

        canvasRef.current.add(shape);
    };

    const addText = () => {
        const fabric = fabricRef.current;
        if (!fabric || !canvasRef.current) return;
        const text = new fabric.IText("Edit me", {
            left: 300,
            top: 200,
            fontSize: 24,
            fill: "#000",
            editableId: `text_${Date.now()}`,
            isLocked: false
        });
        canvasRef.current.add(text);
    };

    const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const imgEl = new window.Image();
            imgEl.onload = () => {
                const img = new fabricRef.current.Image(imgEl, {
                    left: 100,
                    top: 100,
                    editableId: `image_${Date.now()}`,
                    isLocked: false
                });
                canvasRef.current?.add(img);
                canvasRef.current?.renderAll();
                saveCurrentState();
            };
            imgEl.src = reader.result as string;
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

    const toggleLock = () => {
        const obj = canvasRef.current?.getActiveObject();
        if (!obj) return;
        const newLockState = !obj.isLocked;
        obj.set({
            isLocked: newLockState,
            selectable: !newLockState,
            evented: !newLockState,
            opacity: newLockState ? 0.6 : 1
        });
        canvasRef.current?.renderAll();
        saveCurrentState();
        updateActiveObject();
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

    // ===================== UPDATE ATTRIBUTES =====================
    const updateActiveObject = () => {
        const obj = canvasRef.current?.getActiveObject();
        if (!obj) {
            setActiveType(null);
            setActiveAttrs({});
            return;
        }
        if (obj.type === "i-text")
            setActiveType("text");
        else if (["rect", "circle", "triangle"].includes(obj.type))
            setActiveType("shape");
        else if (obj.type === "image")
            setActiveType("image");
        else if (obj.type === "group" && obj.editableId?.includes("balloon")) {
            if (obj.letter) {
                setActiveType("balloon-text");
            } else {
                setActiveType("balloon");
            }
        }

        setActiveAttrs(obj);
    };

    const updateAttr = (attr: string, value: any) => {
        const obj = canvasRef.current?.getActiveObject();
        if (!obj) return;
        obj.set(attr, value);
        canvasRef.current?.renderAll();
        saveCurrentState();
    };

    // ===================== RENDER =====================
    return (
        <div className="flex h-screen bg-gray-100">
            {/* ===== LEFT TOOLS ===== */}
            <div className="flex flex-col w-[220px] gap-2 bg-white shadow p-3 border-b">
                <h3 className="font-semibold mb-2">Balloons</h3>

                {/* Balloon Name Input */}
                <div className="space-y-2 mb-2">
                    <input
                        type="text"
                        value={balloonName}
                        onChange={(e) => setBalloonName(e.target.value)}
                        placeholder="Enter name for balloons"
                        className="w-full border border-gray-300 rounded p-2 text-sm"
                        maxLength={20}
                    />
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <label className="text-xs block mb-1">Balloon Color</label>
                            <input
                                type="color"
                                value={balloonColor}
                                onChange={(e) => setBalloonColor(e.target.value)}
                                className="w-full h-8 border rounded"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs block mb-1">Text Color</label>
                            <input
                                type="color"
                                value={textColor}
                                onChange={(e) => setTextColor(e.target.value)}
                                className="w-full h-8 border rounded"
                            />
                        </div>
                    </div>
                    <Button
                        size='lg'
                        onClick={addBalloonName}
                        className="w-full bg-purple-600 hover:bg-purple-700"
                    >
                        Create Name Balloons
                    </Button>
                </div>

                <Button size='lg' onClick={addSingleBalloon}>Single Balloon</Button>

                <h3 className="font-semibold mt-4 mb-2">Shapes</h3>
                <Button size='lg' onClick={() => addShape("rect")}>Rectangle</Button>
                <Button size='lg' onClick={() => addShape("circle")}>Circle</Button>
                <Button size='lg' onClick={() => addShape("triangle")}>Triangle</Button>

                <h3 className="font-semibold mt-4 mb-2">Text & Media</h3>
                <Button size='lg' onClick={addText}>Text</Button>

                <label className="text-center py-2 cursor-pointer bg-blue-500 text-white px-3 rounded-md">
                    Upload Image
                    <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
                </label>

                <h3 className="font-semibold mt-4 mb-2">Tools</h3>
                <Button size='lg' variant="destructive" onClick={deleteSelected}>Delete</Button>
                <Button size='lg' onClick={undo}>Undo</Button>
                <Button size='lg' onClick={redo}>Redo</Button>
                <Button size='lg' variant="outline" onClick={toggleLock}>
                    {activeAttrs.isLocked ? "Unlock" : "Lock"}
                </Button>

                <h3 className="font-semibold mt-4 mb-2">Export</h3>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size='lg' variant="outline">Export</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        <DropdownMenuLabel>
                            <Button size='lg' variant="outline" onClick={() => {
                                const link = document.createElement("a");
                                link.href = canvasRef.current?.toDataURL({ format: "png" }) ?? "";
                                link.download = "canvas.png";
                                link.click();
                            }}>PNG</Button>
                        </DropdownMenuLabel>
                        <DropdownMenuLabel>
                            <Button size='lg' variant="outline" onClick={() => {
                                const pdf = new jsPDF("l", "pt", "a4");
                                const img = canvasRef.current?.toDataURL({ format: "png" });
                                if (img) {
                                    pdf.addImage(img, "PNG", 0, 0, 800, 600);
                                    pdf.save("canvas.pdf");
                                }
                            }}>PDF</Button>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>
                            <Button size='lg' variant="outline" onClick={() => {
                                const json = JSON.stringify(canvasRef.current?.toJSON());
                                const blob = new Blob([json], { type: "application/json" });
                                const link = document.createElement("a");
                                link.href = URL.createObjectURL(blob);
                                link.download = "project.json";
                                link.click();
                            }}>JSON</Button>
                        </DropdownMenuLabel>
                    </DropdownMenuContent>
                </DropdownMenu>

                <label className="cursor-pointer border rounded-md px-3 py-2 mt-2 text-center">
                    Load JSON
                    <input type="file" accept=".json" className="hidden" onChange={loadJSON} />
                </label>

                {/* ✅ Auto-Fit Toggle */}
                <label className="flex items-center gap-2 mt-4 text-sm">
                    <input
                        type="checkbox"
                        checked={autoFitEnabled}
                        onChange={(e) => setAutoFitEnabled(e.target.checked)}
                    />
                    Auto-Fit on Load
                </label>
            </div>

            {/* ===== MAIN CANVAS ===== */}
            <div className="flex flex-col flex-1">
                <div className="flex justify-center items-center flex-1 overflow-auto">
                    <canvas ref={canvasEl} className="border shadow-lg rounded-lg" />
                </div>
            </div>

            {/* ===== RIGHT SIDEBAR ===== */}
            <aside className="w-80 bg-white border-r shadow-md flex flex-col">
                <div className="p-3 border-b flex justify-between items-center">
                    <h2 className="font-semibold text-lg">Projects</h2>
                    <Button size="sm" onClick={saveProject}>Save</Button>
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

                {/* Properties Panel */}
                {activeType && (
                    <div className="border-t p-4">
                        <h3 className="font-semibold mb-3">Properties</h3>
                        <div className="space-y-3">
                            {/* Color Picker */}
                            <div>
                                <label className="text-sm font-medium">Color</label>
                                <input
                                    type="color"
                                    value={activeAttrs.fill || activeAttrs.balloonColor || "#000000"}
                                    onChange={(e) => updateAttr("fill", e.target.value)}
                                    className="w-full h-10 border rounded"
                                />
                            </div>

                            {/* For balloon text, show letter editing */}
                            {activeType === "balloon-text" && (
                                <div>
                                    <label className="text-sm font-medium">Letter</label>
                                    <input
                                        type="text"
                                        value={activeAttrs.letter || ""}
                                        onChange={(e) => {
                                            const newLetter = e.target.value.charAt(0); // Only take first character
                                            updateAttr("letter", newLetter);
                                            // Also update the text object inside the group
                                            const obj = canvasRef.current?.getActiveObject();
                                            if (obj && obj.type === 'group') {
                                                const textObj = obj.getObjects().find((o: any) => o.type === 'text');
                                                if (textObj) {
                                                    textObj.set('text', newLetter);
                                                    canvasRef.current?.renderAll();
                                                }
                                            }
                                        }}
                                        className="w-full border border-gray-300 rounded p-2 text-sm"
                                        maxLength={1}
                                    />
                                </div>
                            )}

                            {/* Opacity Slider */}
                            <div>
                                <label className="text-sm font-medium">
                                    Opacity: {Math.round((activeAttrs.opacity || 1) * 100)}%
                                </label>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={activeAttrs.opacity || 1}
                                    onChange={(e) => updateAttr("opacity", parseFloat(e.target.value))}
                                    className="w-full"
                                />
                            </div>

                            {/* Lock Status */}
                            <div className="text-sm">
                                <span className="font-medium">Status: </span>
                                <span className={activeAttrs.isLocked ? "text-orange-500" : "text-green-500"}>
                                    {activeAttrs.isLocked ? "Locked" : "Editable"}
                                </span>
                            </div>

                            {/* Object Info */}
                            <div className="text-xs text-gray-500 border-t pt-2">
                                <div>Type: {activeType}</div>
                                {activeAttrs.editableId && (
                                    <div>ID: {activeAttrs.editableId}</div>
                                )}
                                {activeAttrs.letter && (
                                    <div>Letter: {activeAttrs.letter}</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </aside>
        </div>
    );
}