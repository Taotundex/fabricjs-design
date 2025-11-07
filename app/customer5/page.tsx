"use client";

import { useEffect, useRef, useState } from "react";
import type * as fabricType from "fabric";
import { Button } from "@/components/ui/button";
import NextImage from "next/image";

interface Project {
    name: string;
    thumbnail: string;
    json: string;
    updatedAt: number;
}

interface EditableItem {
    id: string;
    type: "text" | "image" | "shape" | "balloon" | "balloon-text";
    label: string;
    originalValue?: string;
    color?: string;
    textColor?: string;
    letter?: string;
}

export default function CustomerPage() {
    const canvasRef = useRef<fabricType.Canvas | null>(null);
    const fabricRef = useRef<any | null>(null);
    const canvasEl = useRef<HTMLCanvasElement | null>(null);
    const isInitializedRef = useRef(false);

    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [editableItems, setEditableItems] = useState<EditableItem[]>([]);
    const [formValues, setFormValues] = useState<Record<string, string>>({});
    const [colorValues, setColorValues] = useState<Record<string, string>>({});
    const [textColorValues, setTextColorValues] = useState<Record<string, string>>({});
    const [balloonName, setBalloonName] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isCanvasReady, setIsCanvasReady] = useState(false);

    // ===================== SAFE CANVAS DISPOSAL =====================
    const safeDisposeCanvas = () => {
        if (canvasRef.current) {
            try {
                // Remove all event listeners first
                canvasRef.current.off();
                // Clear all objects
                canvasRef.current.clear();
                // Dispose canvas safely
                canvasRef.current.dispose();
            } catch (error) {
                console.warn("Safe dispose warning:", error);
            } finally {
                canvasRef.current = null;
            }
        }
    };

    // ===================== INIT FABRIC =====================
    useEffect(() => {
        let disposed = false;

        const initFabric = async () => {
            if (!canvasEl.current || disposed || isInitializedRef.current) return;

            try {
                console.log("Customer: Initializing Fabric.js...");
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
                            "letter",
                            "balloonColor",
                            "textColor",
                        ]);
                    };
                })(fabric.Object.prototype.toObject);

                console.log("Customer: Creating canvas...");
                const c = new fabric.Canvas(canvasEl.current!, {
                    width: 1000,
                    height: 600,
                    backgroundColor: "#fff",
                    selection: false,
                });
                canvasRef.current = c;

                // Disable all interactive behaviors
                c.selection = false;
                c.stopContextMenu = true;
                c.allowTouchScrolling = false;

                isInitializedRef.current = true;
                setIsCanvasReady(true);
                loadProjects();
                console.log("Customer: Fabric.js initialized successfully");

            } catch (error) {
                console.error("Customer: Failed to initialize Fabric.js:", error);
            }
        };

        initFabric();

        return () => {
            disposed = true;
            safeDisposeCanvas();
            fabricRef.current = null;
            isInitializedRef.current = false;
        };
    }, []);

    const loadProjects = () => {
        try {
            const list = localStorage.getItem("projects");
            if (!list) return setProjects([]);

            const parsedProjects: Project[] = JSON.parse(list);
            setProjects(parsedProjects);
            console.log(`Customer: Loaded ${parsedProjects.length} projects`);
        } catch (error) {
            console.error("Customer: Failed to load projects:", error);
            setProjects([]);
        }
    };

    // ===================== SAFE CANVAS OPERATIONS =====================
    const safeCanvasOperation = (operation: () => void) => {
        if (!canvasRef.current) {
            console.warn("Canvas not ready for operation");
            return;
        }
        try {
            operation();
        } catch (error) {
            console.error("Canvas operation failed:", error);
        }
    };

    // ===================== LOAD PROJECT (SAFE VERSION) =====================
    const loadProject = async (project: Project) => {
        if (!canvasRef.current) {
            console.error("Customer: Canvas not ready");
            return;
        }

        console.log("🔄 Loading project:", project.name);
        setIsLoading(true);
        setSelectedProject(project);
        setBalloonName("");

        try {
            // Safe clear canvas
            safeCanvasOperation(() => {
                canvasRef.current!.clear();
                canvasRef.current!.renderAll();
            });

            await new Promise<void>((resolve) => {
                safeCanvasOperation(() => {
                    canvasRef.current!.loadFromJSON(project.json, () => {
                        console.log("✅ JSON loaded, objects count:", canvasRef.current!.getObjects().length);

                        const editable: EditableItem[] = [];
                        const values: Record<string, string> = {};
                        const colors: Record<string, string> = {};
                        const textColors: Record<string, string> = {};
                        let foundBalloonLetters = "";

                        // Process all objects safely
                        canvasRef.current!.getObjects().forEach((obj: any) => {
                            try {
                                // Make every object completely non-interactive
                                obj.set({
                                    selectable: false,
                                    evented: false,
                                    lockMovementX: true,
                                    lockMovementY: true,
                                    lockRotation: true,
                                    lockScalingX: true,
                                    lockScalingY: true,
                                    lockScalingFlip: true,
                                    hasControls: false,
                                    hasBorders: false,
                                    hoverCursor: 'default',
                                    moveCursor: 'default',
                                    padding: 0,
                                    opacity: obj.isLocked ? 0.6 : 1,
                                });

                                // Only allow editing of unlocked objects with editableId through the form
                                if (!obj.isLocked && obj.editableId) {
                                    if (obj.type === "i-text") {
                                        editable.push({
                                            id: obj.editableId,
                                            type: "text",
                                            label: `Text ${editable.filter(e => e.type === "text").length + 1}`,
                                            originalValue: obj.text
                                        });
                                        values[obj.editableId] = obj.text || "";
                                    } else if (obj.type === "image") {
                                        editable.push({
                                            id: obj.editableId,
                                            type: "image",
                                            label: `Image ${editable.filter(e => e.type === "image").length + 1}`
                                        });
                                        values[obj.editableId] = "";
                                    } else if (["rect", "circle", "triangle"].includes(obj.type)) {
                                        editable.push({
                                            id: obj.editableId,
                                            type: "shape",
                                            label: `Shape ${editable.filter(e => e.type === "shape").length + 1}`,
                                            color: obj.fill
                                        });
                                        colors[obj.editableId] = obj.fill || "#000000";
                                    } else if (obj.type === "group" && obj.editableId?.includes("balloon")) {
                                        if (obj.letter) {
                                            foundBalloonLetters += obj.letter;
                                            editable.push({
                                                id: obj.editableId,
                                                type: "balloon-text",
                                                label: `Balloon Letter: ${obj.letter}`,
                                                letter: obj.letter,
                                                color: obj.balloonColor || obj.fill,
                                                textColor: obj.textColor
                                            });
                                            colors[obj.editableId] = obj.balloonColor || obj.fill || "#000000";
                                            textColors[obj.editableId] = obj.textColor || "#000000";
                                        } else {
                                            editable.push({
                                                id: obj.editableId,
                                                type: "balloon",
                                                label: `Balloon ${editable.filter(e => e.type === "balloon").length + 1}`,
                                                color: obj.balloonColor || obj.fill
                                            });
                                            colors[obj.editableId] = obj.balloonColor || obj.fill || "#000000";
                                        }
                                    }
                                }
                            } catch (objError) {
                                console.warn("Error processing object:", objError);
                            }
                        });

                        // Set balloon name if we found balloon letters
                        if (foundBalloonLetters) {
                            setBalloonName(foundBalloonLetters);
                        }

                        console.log("🎯 Editable items found:", editable.length);
                        console.log("🔤 Balloon letters found:", foundBalloonLetters);

                        setEditableItems(editable);
                        setFormValues(values);
                        setColorValues(colors);
                        setTextColorValues(textColors);

                        // Safe render
                        setTimeout(() => {
                            safeCanvasOperation(() => {
                                canvasRef.current!.renderAll();
                            });
                            resolve();
                        }, 100);
                    });
                });
            });

            setIsLoading(false);

        } catch (error) {
            console.error("Customer: Failed to load project JSON:", error);
            setIsLoading(false);
        }
    };

    // ===================== REAL-TIME BALLOON NAME UPDATES =====================
    useEffect(() => {
        if (!balloonName.trim() || !canvasRef.current || !fabricRef.current) {
            return;
        }

        updateBalloonName(balloonName);
    }, [balloonName]);

    const updateBalloonName = (name: string) => {
        safeCanvasOperation(() => {
            const fabric = fabricRef.current;
            const c = canvasRef.current;
            if (!fabric || !c) return;

            const nameToUse = name.trim().toUpperCase();
            const letters = nameToUse.split('');

            // Remove existing balloon text items safely
            const existingBalloonTexts = c.getObjects().filter((obj: any) =>
                obj.type === "group" && obj.editableId?.includes("balloon") && obj.letter
            );

            existingBalloonTexts.forEach(obj => {
                try {
                    c.remove(obj);
                } catch (error) {
                    console.warn("Error removing balloon:", error);
                }
            });

            if (letters.length === 0) {
                c.renderAll();
                updateEditableItemsAfterBalloonChange();
                return;
            }

            // Calculate centered positions
            const canvasWidth = c.width || 1000;
            const canvasHeight = c.height || 600;
            const balloonRadius = 35;
            const spacing = 80;
            const totalWidth = (letters.length - 1) * spacing;
            const startX = (canvasWidth - totalWidth) / 2;
            const y = canvasHeight / 3;

            // Create new balloons
            letters.forEach((letter, index) => {
                try {
                    const x = startX + (index * spacing);

                    // Create balloon circle
                    const balloonCircle = new fabric.Circle({
                        radius: balloonRadius,
                        fill: "#e879f9",
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
                        top: balloonRadius,
                        originX: 'center',
                        originY: 'top',
                        angle: 180
                    });

                    // Create text for the balloon
                    const balloonText = new fabric.Text(letter, {
                        fontSize: 20,
                        fill: "#000000",
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
                        editableId: `customer_balloon_${Date.now()}_${index}`,
                        isLocked: false,
                        letter: letter,
                        balloonColor: "#e879f9",
                        textColor: "#000000",
                        selectable: false,
                        evented: false,
                    });

                    c.add(balloonGroup);
                } catch (error) {
                    console.error("Error creating balloon:", error);
                }
            });

            c.renderAll();
            updateEditableItemsAfterBalloonChange();
        });
    };

    const updateEditableItemsAfterBalloonChange = () => {
        safeCanvasOperation(() => {
            const c = canvasRef.current;
            if (!c) return;

            // Update editable items to reflect current balloons
            const balloonObjects = c.getObjects().filter((obj: any) =>
                obj.type === "group" && obj.editableId?.includes("balloon") && obj.letter
            );

            const newBalloonItems: EditableItem[] = balloonObjects.map((obj: any, index) => ({
                id: obj.editableId,
                type: "balloon-text" as const,
                label: `Balloon Letter: ${obj.letter}`,
                letter: obj.letter,
                color: obj.balloonColor || "#e879f9",
                textColor: obj.textColor || "#000000"
            }));

            // Keep existing non-balloon items
            const existingNonBalloonItems = editableItems.filter(item =>
                item.type !== "balloon-text" &&
                !item.id.includes("customer_balloon")
            );

            setEditableItems([...existingNonBalloonItems, ...newBalloonItems]);

            // Update color values
            const newColorValues: Record<string, string> = {};
            const newTextColorValues: Record<string, string> = {};

            newBalloonItems.forEach(item => {
                newColorValues[item.id] = item.color!;
                newTextColorValues[item.id] = item.textColor!;
            });

            setColorValues(prev => ({ ...prev, ...newColorValues }));
            setTextColorValues(prev => ({ ...prev, ...newTextColorValues }));
        });
    };

    // ===================== SAFE UPDATE FUNCTIONS =====================
    const handleTextChange = (id: string, value: string) => {
        setFormValues((prev) => ({ ...prev, [id]: value }));
        safeCanvasOperation(() => {
            const c = canvasRef.current;
            if (!c) return;

            const obj = c.getObjects().find((o: any) => o.editableId === id);
            if (obj && obj.type === "i-text") {
                obj.set('text', value);
                obj.setCoords();
                c.renderAll();
            }
        });
    };

    const handleColorChange = (id: string, color: string) => {
        setColorValues((prev) => ({ ...prev, [id]: color }));
        safeCanvasOperation(() => {
            const c = canvasRef.current;
            if (!c) return;

            const obj = c.getObjects().find((o: any) => o.editableId === id);
            if (obj) {
                if (obj.type === "group" && obj.editableId?.includes("balloon")) {
                    const circle = obj.getObjects().find((o: any) => o.type === "circle");
                    if (circle) {
                        circle.set('fill', color);
                    }
                    obj.set('balloonColor', color);
                } else {
                    obj.set('fill', color);
                }
                c.renderAll();
            }
        });
    };

    const handleTextColorChange = (id: string, color: string) => {
        setTextColorValues((prev) => ({ ...prev, [id]: color }));
        safeCanvasOperation(() => {
            const c = canvasRef.current;
            if (!c) return;

            const obj = c.getObjects().find((o: any) => o.editableId === id);
            if (obj && obj.type === "group") {
                const textObj = obj.getObjects().find((o: any) => o.type === "text");
                if (textObj) {
                    textObj.set('fill', color);
                }
                obj.set('textColor', color);
                c.renderAll();
            }
        });
    };

    const handleLetterChange = (id: string, letter: string) => {
        const newLetter = letter.charAt(0).toUpperCase();
        safeCanvasOperation(() => {
            const c = canvasRef.current;
            if (!c) return;

            const obj = c.getObjects().find((o: any) => o.editableId === id);
            if (obj && obj.type === "group" && obj.letter) {
                const textObj = obj.getObjects().find((o: any) => o.type === "text");
                if (textObj) {
                    textObj.set('text', newLetter);
                    obj.set('letter', newLetter);
                    c.renderAll();

                    // Update the balloon name string
                    const balloonObjects = c.getObjects().filter((o: any) =>
                        o.type === "group" && o.editableId?.includes("balloon") && o.letter
                    ).sort((a: any, b: any) => a.left - b.left);

                    const currentName = balloonObjects.map((o: any) => o.letter).join('');
                    setBalloonName(currentName);
                }
            }
        });
    };

    const handleImageChange = (id: string, file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            const imgEl = new window.Image();
            imgEl.onload = () => {
                safeCanvasOperation(() => {
                    const c = canvasRef.current;
                    if (!c) return;
                    const obj = c.getObjects().find((o: any) => o.editableId === id);
                    if (obj && obj.type === "image") {
                        const fabric = fabricRef.current;
                        const newImg = new fabric.Image(imgEl, {
                            left: obj.left,
                            top: obj.top,
                            scaleX: obj.scaleX,
                            scaleY: obj.scaleY,
                            angle: obj.angle,
                            opacity: obj.opacity,
                            editableId: obj.editableId,
                            isLocked: obj.isLocked,
                            selectable: false,
                            evented: false,
                            lockMovementX: true,
                            lockMovementY: true,
                            lockRotation: true,
                            lockScalingX: true,
                            lockScalingY: true,
                            hasControls: false,
                            hasBorders: false,
                        });

                        c.remove(obj);
                        c.add(newImg);
                        c.renderAll();
                    }
                });
            };
            imgEl.src = result;
        };
        reader.readAsDataURL(file);
    };

    // Force canvas re-render when project changes
    useEffect(() => {
        if (selectedProject && canvasRef.current) {
            setTimeout(() => {
                safeCanvasOperation(() => {
                    canvasRef.current!.renderAll();
                });
            }, 200);
        }
    }, [selectedProject]);

    return (
        <div className="flex h-screen bg-gray-100">
            {/* === LEFT SIDEBAR === */}
            <aside className="w-72 bg-white border-r shadow-md flex flex-col">
                <div className="p-3 border-b flex justify-between items-center">
                    <h2 className="font-semibold text-lg">Designs</h2>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {projects.length === 0 && (
                        <div className="p-4 text-sm text-gray-500">No saved designs.</div>
                    )}
                    {projects.map((p) => (
                        <div
                            key={p.name}
                            onClick={() => loadProject(p)}
                            className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-100 transition-colors ${selectedProject?.name === p.name
                                ? "bg-blue-50 border-l-4 border-blue-400"
                                : ""
                                }`}
                        >
                            <NextImage
                                src={p.thumbnail}
                                alt={p.name}
                                width={48}
                                height={48}
                                className="rounded border object-cover w-12 h-12"
                            />
                            <div className="flex-1">
                                <div className="font-medium">{p.name}</div>
                                <div className="text-xs text-gray-400">
                                    {new Date(p.updatedAt).toLocaleString()}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </aside>

            {/* === MAIN CANVAS === */}
            <div className="flex-1 flex flex-col">
                <div className="p-4 bg-white border-b">
                    <h1 className="text-xl font-bold text-center">
                        {selectedProject?.name || "Select a Design"}
                    </h1>
                    {selectedProject && (
                        <p className="text-sm text-gray-600 text-center mt-1">
                            All changes appear instantly in real-time
                        </p>
                    )}
                </div>
                <div className="flex-1 flex items-center justify-center overflow-auto p-4">
                    {!isCanvasReady && (
                        <div className="flex items-center justify-center w-full h-full">
                            <div className="text-lg">Initializing canvas...</div>
                        </div>
                    )}

                    <div className={`relative ${selectedProject ? 'block' : 'hidden'}`}>
                        <canvas
                            ref={canvasEl}
                            className="border shadow-lg rounded-lg bg-white"
                            style={{
                                cursor: 'default',
                                display: isCanvasReady ? 'block' : 'none'
                            }}
                        />
                        {isLoading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-80 rounded-lg">
                                <div className="text-lg">Loading design...</div>
                            </div>
                        )}
                    </div>

                    {!selectedProject && isCanvasReady && (
                        <div className="flex items-center justify-center w-full h-full">
                            <div className="text-center text-gray-500">
                                <div className="text-lg mb-2">No Design Selected</div>
                                <div className="text-sm">Choose a design from the left panel to begin</div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* === RIGHT PANEL === */}
            <aside className="w-80 bg-white border-l shadow-md flex flex-col">
                <div className="p-4 border-b">
                    <h2 className="text-lg font-semibold">Customize Design</h2>
                    <p className="text-sm text-gray-600 mt-1">
                        All changes appear instantly in real-time
                    </p>
                </div>

                {selectedProject && (
                    <div className="p-4 border-b space-y-3">
                        <div className="space-y-2">
                            <h3 className="font-medium text-sm">Balloon Name</h3>
                            <input
                                type="text"
                                value={balloonName}
                                onChange={(e) => setBalloonName(e.target.value.toUpperCase())}
                                placeholder="Enter name (max 8 letters)"
                                className="w-full border border-gray-300 rounded p-2 text-sm font-medium text-center"
                                maxLength={8}
                            />
                            <div className="flex justify-between text-xs text-gray-500">
                                <span>{balloonName.length}/8 characters</span>
                                <span>{8 - balloonName.length} remaining</span>
                            </div>
                            <p className="text-xs text-gray-500 text-center">
                                Type to add/remove balloons automatically
                            </p>
                        </div>
                    </div>
                )}

                <div className="flex-1 p-4 overflow-y-auto space-y-6">
                    {!selectedProject && (
                        <div className="text-center text-gray-500 py-8">
                            Please select a design from the left panel to begin customization.
                        </div>
                    )}
                    {isLoading && <div className="text-center py-8">Loading design...</div>}
                    {selectedProject && !isLoading && editableItems.length === 0 && (
                        <div className="text-center text-gray-500 py-8">
                            No editable elements found in this design.
                            <br />
                            <span className="text-xs">
                                The designer needs to unlock elements in the editor to make them editable here.
                            </span>
                        </div>
                    )}

                    {editableItems.map((item) => (
                        <div key={item.id} className="space-y-3 p-3 border rounded-lg bg-gray-50">
                            <label className="text-sm font-medium block text-gray-700">
                                {item.label}
                            </label>

                            {item.type === "text" && (
                                <>
                                    <input
                                        type="text"
                                        value={formValues[item.id] || ""}
                                        onChange={(e) => handleTextChange(item.id, e.target.value)}
                                        className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        placeholder="Enter text..."
                                    />
                                    {item.originalValue && (
                                        <p className="text-xs text-gray-500">
                                            Original: "{item.originalValue}"
                                        </p>
                                    )}
                                </>
                            )}

                            {item.type === "image" && (
                                <>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => e.target.files?.[0] && handleImageChange(item.id, e.target.files[0])}
                                        className="block w-full text-sm border border-gray-300 rounded p-2"
                                    />
                                    <p className="text-xs text-gray-500">
                                        Upload a new image to replace this one
                                    </p>
                                </>
                            )}

                            {(item.type === "shape" || item.type === "balloon") && (
                                <>
                                    <label className="text-xs text-gray-600">Color</label>
                                    <input
                                        type="color"
                                        value={colorValues[item.id] || "#000000"}
                                        onChange={(e) => handleColorChange(item.id, e.target.value)}
                                        className="w-full h-10 border border-gray-300 rounded cursor-pointer"
                                    />
                                    {item.color && (
                                        <p className="text-xs text-gray-500">
                                            Original: <span
                                                className="inline-block w-3 h-3 rounded-full mr-1 align-middle"
                                                style={{ backgroundColor: item.color }}
                                            ></span>
                                            {item.color}
                                        </p>
                                    )}
                                </>
                            )}

                            {item.type === "balloon-text" && (
                                <>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-xs text-gray-600">Balloon Color</label>
                                            <input
                                                type="color"
                                                value={colorValues[item.id] || "#000000"}
                                                onChange={(e) => handleColorChange(item.id, e.target.value)}
                                                className="w-full h-10 border border-gray-300 rounded cursor-pointer"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-600">Text Color</label>
                                            <input
                                                type="color"
                                                value={textColorValues[item.id] || "#000000"}
                                                onChange={(e) => handleTextColorChange(item.id, e.target.value)}
                                                className="w-full h-10 border border-gray-300 rounded cursor-pointer"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-600">Letter</label>
                                        <input
                                            type="text"
                                            value={item.letter || ""}
                                            onChange={(e) => handleLetterChange(item.id, e.target.value)}
                                            className="w-full border border-gray-300 rounded p-2 text-sm text-center font-bold"
                                            maxLength={1}
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    ))}
                </div>

                {selectedProject && editableItems.length > 0 && (
                    <div className="p-4 border-t space-y-2">
                        <Button
                            onClick={() => {
                                safeCanvasOperation(() => {
                                    const data = canvasRef.current?.toDataURL({
                                        format: "png",
                                        multiplier: 2
                                    });
                                    if (!data) return;
                                    const link = document.createElement("a");
                                    link.href = data;
                                    link.download = `${selectedProject.name}-customized.png`;
                                    link.click();
                                });
                            }}
                            className="w-full bg-green-600 hover:bg-green-700 text-white"
                        >
                            Download Customized Design
                        </Button>
                        <Button
                            onClick={() => {
                                setFormValues({});
                                setColorValues({});
                                setTextColorValues({});
                                setBalloonName("");
                                if (selectedProject) {
                                    loadProject(selectedProject);
                                }
                            }}
                            variant="outline"
                            className="w-full"
                        >
                            Reset All Changes
                        </Button>
                    </div>
                )}
            </aside>
        </div>
    );
}