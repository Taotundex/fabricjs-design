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
    type: "text" | "image";
    label: string;
    originalValue?: string;
}

export default function CustomerPage() {
    const canvasRef = useRef<fabricType.Canvas | null>(null);
    const fabricRef = useRef<any | null>(null);
    const canvasEl = useRef<HTMLCanvasElement | null>(null);

    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [editableItems, setEditableItems] = useState<EditableItem[]>([]);
    const [formValues, setFormValues] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [isCanvasReady, setIsCanvasReady] = useState(false);

    // ===================== INIT FABRIC =====================
    useEffect(() => {
        let disposed = false;

        const initFabric = async () => {
            if (!canvasEl.current) {
                console.log("Customer: Canvas element not ready, retrying...");
                setTimeout(initFabric, 100);
                return;
            }
            if (canvasRef.current || disposed) return;

            try {
                console.log("Customer: Initializing Fabric.js...");
                const fabricModule = await import("fabric");
                const fabric = (fabricModule as any).fabric || fabricModule.default || fabricModule;
                fabricRef.current = fabric;

                // Extend fabric.Object to include custom properties (same as editor)
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

                console.log("Customer: Creating canvas...");
                const c = new fabric.Canvas(canvasEl.current!, {
                    width: 1000,
                    height: 600,
                    backgroundColor: "#fff",
                    selection: false, // Disable selection completely
                });
                canvasRef.current = c;

                // COMPLETELY DISABLE ALL CANVAS INTERACTIONS
                c.off(); // Remove all event listeners

                // Disable all interactive behaviors
                c.selection = false;
                c.stopContextMenu = true;
                c.allowTouchScrolling = false;

                // Set canvas to non-interactive mode
                c.forEachObject((obj) => {
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
                    });
                });

                setIsCanvasReady(true);
                loadProjects();
                console.log("Customer: Fabric.js initialized successfully");

            } catch (error) {
                console.error("Customer: Failed to initialize Fabric.js:", error);
            }
        };

        initFabric();

        return () => {
            console.log("Customer: Cleaning up Fabric.js...");
            disposed = true;
            if (canvasRef.current) {
                try {
                    canvasRef.current.dispose();
                } catch (error) {
                    console.error("Customer: Error disposing canvas:", error);
                }
                canvasRef.current = null;
            }
            fabricRef.current = null;
        };
    }, []);

    const loadProjects = () => {
        const list = localStorage.getItem("projects");
        if (!list) return setProjects([]);
        try {
            const parsedProjects: Project[] = JSON.parse(list);
            setProjects(parsedProjects);
            console.log(`Customer: Loaded ${parsedProjects.length} projects`);
        } catch (error) {
            console.error("Customer: Failed to load projects:", error);
            setProjects([]);
        }
    };

    const loadProject = (project: Project) => {
        const c = canvasRef.current;
        if (!c) {
            console.error("Customer: Canvas not ready");
            return;
        }

        console.log("🔄 Loading project:", project.name);
        setIsLoading(true);
        setSelectedProject(project);
        c.clear();

        try {
            c.loadFromJSON(project.json, () => {
                console.log("✅ JSON loaded, objects count:", c.getObjects().length);

                const editable: EditableItem[] = [];
                const values: Record<string, string> = {};

                // COMPLETELY DISABLE ALL OBJECT INTERACTIONS
                c.getObjects().forEach((obj: any) => {
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
                        // Preserve opacity for locked state visualization
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
                        }
                    }
                });

                console.log("🎯 Editable items found:", editable.length);

                setEditableItems(editable);
                setFormValues(values);

                // Disable canvas interactions again after loading
                c.selection = false;
                c.renderAll();

                setIsLoading(false);
            });
        } catch (error) {
            console.error("Customer: Failed to load project JSON:", error);
            setIsLoading(false);
        }
    };

    const handleTextChange = (id: string, value: string) => {
        setFormValues((prev) => ({ ...prev, [id]: value }));
        const c = canvasRef.current;
        if (!c) return;

        const obj = c.getObjects().find((o: any) => o.editableId === id);
        if (obj && obj.type === "i-text") {
            obj.set('text', value);
            // Recalculate text dimensions
            obj.setCoords();
            c.renderAll();
            console.log(`📝 Updated text for ${id}: ${value}`);
        }
    };

    const handleImageChange = (id: string, file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            const imgEl = new window.Image();
            imgEl.onload = () => {
                const c = canvasRef.current;
                if (!c) return;
                const obj = c.getObjects().find((o: any) => o.editableId === id);
                if (obj && obj.type === "image") {
                    // Create new fabric image while preserving position and properties
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
                        // Keep it non-interactive
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

                    // Replace the old image
                    c.remove(obj);
                    c.add(newImg);
                    c.renderAll();
                    console.log(`🖼️ Updated image for ${id}`);
                }
            };
            imgEl.src = result;
        };
        reader.readAsDataURL(file);
    };

    const refreshCanvas = () => {
        canvasRef.current?.renderAll();
        console.log("🔄 Canvas manually refreshed");
    };

    // Add CSS to disable any potential text selection on canvas
    useEffect(() => {
        const style = document.createElement('style');
        style.textContent = `
            .customer-canvas {
                user-select: none;
                -webkit-user-select: none;
                -moz-user-select: none;
                -ms-user-select: none;
                pointer-events: none;
            }
            .customer-canvas-container {
                cursor: default !important;
            }
        `;
        document.head.appendChild(style);

        return () => {
            document.head.removeChild(style);
        };
    }, []);

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
                            className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-100 ${selectedProject?.name === p.name
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
                            Use the form on the right to customize unlocked elements
                        </p>
                    )}
                </div>
                <div className="flex-1 flex items-center justify-center overflow-auto p-4 customer-canvas-container">
                    {!isCanvasReady && (
                        <div className="flex items-center justify-center w-full h-full">
                            <div className="text-lg">Loading canvas...</div>
                        </div>
                    )}
                    <canvas
                        ref={canvasEl}
                        className="border shadow-lg rounded-lg bg-white customer-canvas"
                        style={{
                            display: isCanvasReady ? 'block' : 'none',
                            cursor: 'default'
                        }}
                    />
                </div>
            </div>

            {/* === RIGHT PANEL === */}
            <aside className="w-80 bg-white border-l shadow-md flex flex-col">
                <div className="p-4 border-b">
                    <h2 className="text-lg font-semibold">Customize Design</h2>
                    <p className="text-sm text-gray-600 mt-1">
                        Edit the unlocked elements below. Direct canvas interaction is disabled.
                    </p>
                </div>

                {selectedProject && (
                    <div className="p-4 border-b">
                        <div className="space-y-2">
                            <Button
                                onClick={refreshCanvas}
                                variant="outline"
                                size="sm"
                                className="w-full"
                            >
                                Refresh Canvas
                            </Button>
                            <div className="text-xs text-gray-500 text-center">
                                Use this if changes don't appear immediately
                            </div>
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

                    {editableItems.map((item) =>
                        item.type === "text" ? (
                            <div key={item.id} className="space-y-2 p-3 border rounded-lg bg-gray-50">
                                <label className="text-sm font-medium block text-gray-700">
                                    {item.label}
                                </label>
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
                            </div>
                        ) : (
                            <div key={item.id} className="space-y-2 p-3 border rounded-lg bg-gray-50">
                                <label className="text-sm font-medium block text-gray-700">
                                    {item.label}
                                </label>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => e.target.files?.[0] && handleImageChange(item.id, e.target.files[0])}
                                    className="block w-full text-sm border border-gray-300 rounded p-2"
                                />
                                <p className="text-xs text-gray-500">
                                    Upload a new image to replace this one
                                </p>
                            </div>
                        )
                    )}
                </div>

                {selectedProject && editableItems.length > 0 && (
                    <div className="p-4 border-t space-y-2">
                        <Button
                            onClick={() => {
                                const data = canvasRef.current?.toDataURL({
                                    format: "png",
                                    multiplier: 2 // Higher quality
                                });
                                if (!data) return;
                                const link = document.createElement("a");
                                link.href = data;
                                link.download = `${selectedProject.name}-customized.png`;
                                link.click();
                            }}
                            className="w-full bg-green-600 hover:bg-green-700 text-white"
                        >
                            Download Customized Design
                        </Button>
                        <Button
                            onClick={() => {
                                setFormValues({});
                                loadProject(selectedProject);
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