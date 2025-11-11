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
    type: "text" | "image" | "shape" | "balloon" | "balloon-text" | "custom-element";
    label: string;
    originalValue?: string;
    color?: string;
    textColor?: string;
    letter?: string;
}

interface LayoutInfo {
    type: string;
    params: any;
    positions: Array<{ left: number; top: number; width: number; height: number }>;
    elementSize: number;
    elementColor: string;
    textColor: string;
    imageSrc: string;
    groupTimestamp: number;
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
    const [customElementName, setCustomElementName] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isCanvasReady, setIsCanvasReady] = useState(false);

    // Store layout information for custom elements
    const customElementLayouts = useRef<Map<string, LayoutInfo>>(new Map());

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
                        propertiesToInclude = propertiesToInclude.concat([
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
                            "elementColor",
                            "layoutType",
                            "layoutParams",
                            "elementSize",
                            "groupTimestamp",
                        ]);
                        return toObject.call(this, propertiesToInclude);
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

    // ===================== PROCESS EDITABLE OBJECTS =====================
    const processEditableObjects = () => {
        safeCanvasOperation(() => {
            const c = canvasRef.current;
            if (!c) return;

            const editable: EditableItem[] = [];
            const values: Record<string, string> = {};
            const colors: Record<string, string> = {};
            const textColors: Record<string, string> = {};
            let foundBalloonLetters = "";
            let foundCustomElementLetters = "";

            console.log("Processing objects:", c.getObjects().length);

            // Clear previous layouts
            customElementLayouts.current.clear();

            // Process all objects safely
            c.getObjects().forEach((obj: any) => {
                try {
                    console.log("Object:", {
                        type: obj.type,
                        editableId: obj.editableId,
                        letter: obj.letter,
                        layoutType: obj.layoutType,
                        groupTimestamp: obj.groupTimestamp
                    });

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
                    });

                    // FIXED: Check if object is NOT locked (isLocked should be false or undefined)
                    const isUnlocked = obj.isLocked === false || obj.isLocked === undefined;

                    if (isUnlocked && obj.editableId) {
                        if (obj.type === "i-text") {
                            editable.push({
                                id: obj.editableId,
                                type: "text",
                                label: `Text ${editable.filter(e => e.type === "text").length + 1}`,
                                originalValue: obj.text
                            });
                            values[obj.editableId] = obj.text || "";
                            textColors[obj.editableId] = obj.fill || "#000000";
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
                        } else if (obj.type === "group" && obj.editableId?.includes("custom_element")) {
                            // Store layout information for custom elements
                            if (obj.letter) {
                                foundCustomElementLetters += obj.letter;

                                // Extract image source and properties
                                const imageObj = obj.getObjects().find((o: any) => o.type === "image");
                                const textObj = obj.getObjects().find((o: any) => o.type === "text");

                                const imageSrc = imageObj?._element?.src || "";
                                const elementSize = obj.elementSize || obj.width || 100;
                                const elementColor = obj.elementColor || "#ffffff";
                                const textColor = obj.textColor || textObj?.fill || "#000000";
                                const groupTimestamp = obj.groupTimestamp || Date.now();

                                // Group by groupTimestamp to preserve layout
                                const layoutKey = `layout_${groupTimestamp}`;

                                if (!customElementLayouts.current.has(layoutKey)) {
                                    customElementLayouts.current.set(layoutKey, {
                                        type: obj.layoutType || "horizontal",
                                        params: obj.layoutParams || {},
                                        positions: [],
                                        elementSize: elementSize,
                                        elementColor: elementColor,
                                        textColor: textColor,
                                        imageSrc: imageSrc,
                                        groupTimestamp: groupTimestamp
                                    });
                                }

                                const layout = customElementLayouts.current.get(layoutKey)!;
                                layout.positions.push({
                                    left: obj.left,
                                    top: obj.top,
                                    width: elementSize,
                                    height: elementSize
                                });

                                editable.push({
                                    id: obj.editableId,
                                    type: "custom-element",
                                    label: `Custom Element: ${obj.letter}`,
                                    letter: obj.letter,
                                    color: elementColor,
                                    textColor: textColor
                                });
                                colors[obj.editableId] = elementColor;
                                textColors[obj.editableId] = textColor;

                                console.log("✅ Custom element layout saved:", {
                                    layout: layout.type,
                                    positions: layout.positions.length,
                                    elementSize: elementSize,
                                    textColor: textColor
                                });
                            } else {
                                editable.push({
                                    id: obj.editableId,
                                    type: "custom-element",
                                    label: `Custom Element ${editable.filter(e => e.type === "custom-element").length + 1}`,
                                    color: obj.elementColor
                                });
                                colors[obj.editableId] = obj.elementColor || "#ffffff";
                            }
                        }
                    }
                } catch (objError) {
                    console.warn("Error processing object:", objError);
                }
            });

            console.log("🎯 Final editable items found:", editable.length);
            console.log("🔤 Balloon letters found:", foundBalloonLetters);
            console.log("🔤 Custom Element letters found:", foundCustomElementLetters);
            console.log("📐 Custom Element Layouts:", Array.from(customElementLayouts.current.entries()));

            setEditableItems(editable);
            setFormValues(values);
            setColorValues(colors);
            setTextColorValues(textColors);
            setBalloonName(foundBalloonLetters);
            setCustomElementName(foundCustomElementLetters);

            // Safe render
            setTimeout(() => {
                safeCanvasOperation(() => {
                    c.renderAll();
                });
            }, 100);
        });
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
        setCustomElementName("");

        try {
            // Safe clear canvas
            safeCanvasOperation(() => {
                canvasRef.current!.clear();
                canvasRef.current!.renderAll();
            });

            // Use Promise to ensure loadFromJSON completes
            await new Promise<void>((resolve) => {
                safeCanvasOperation(() => {
                    canvasRef.current!.loadFromJSON(project.json, () => {
                        console.log("✅ JSON loaded, objects count:", canvasRef.current!.getObjects().length);

                        // Add a small delay to ensure all objects are properly initialized
                        setTimeout(() => {
                            processEditableObjects();
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

    // ===================== REAL-TIME CUSTOM ELEMENT NAME UPDATES =====================
    useEffect(() => {
        if (!customElementName.trim() || !canvasRef.current || !fabricRef.current) {
            return;
        }

        updateCustomElementName(customElementName);
    }, [customElementName]);

    const updateCustomElementName = (name: string) => {
        safeCanvasOperation(() => {
            const fabric = fabricRef.current;
            const c = canvasRef.current;
            if (!fabric || !c) return;

            const nameToUse = name.trim().toUpperCase();
            const letters = nameToUse.split('');

            // Remove existing custom element text items safely
            const existingCustomElementTexts = c.getObjects().filter((obj: any) =>
                obj.type === "group" && obj.editableId?.includes("custom_element") && obj.letter
            );

            existingCustomElementTexts.forEach(obj => {
                try {
                    c.remove(obj);
                } catch (error) {
                    console.warn("Error removing custom element:", error);
                }
            });

            if (letters.length === 0) {
                c.renderAll();
                updateEditableItemsAfterCustomElementChange();
                return;
            }

            // Get layout information
            const layoutEntries = Array.from(customElementLayouts.current.entries());
            if (layoutEntries.length === 0) {
                console.log("No layout information found for custom elements");
                return;
            }

            // Use the first layout found
            const [layoutKey, layout] = layoutEntries[0];
            console.log("Using layout for recreation:", layout);

            // Create new custom elements using the stored layout
            letters.forEach((letter, index) => {
                try {
                    let x, y;

                    // Use exact original positions if available
                    if (layout.positions[index]) {
                        x = layout.positions[index].left;
                        y = layout.positions[index].top;
                        console.log(`Using original position for ${letter}:`, { x, y });
                    } else {
                        // Calculate new position based on layout type
                        const canvasWidth = c.width || 1000;
                        const canvasHeight = c.height || 600;
                        const elementSize = layout.elementSize || 100;

                        switch (layout.type) {
                            case "horizontal":
                                const horizontalSpacing = elementSize + 20;
                                const totalHorizontalWidth = (letters.length - 1) * horizontalSpacing;
                                x = (canvasWidth - totalHorizontalWidth) / 2 + (index * horizontalSpacing);
                                y = canvasHeight / 2;
                                break;

                            case "vertical":
                                const verticalSpacing = elementSize + 20;
                                const totalVerticalHeight = (letters.length - 1) * verticalSpacing;
                                x = canvasWidth / 2;
                                y = (canvasHeight - totalVerticalHeight) / 2 + (index * verticalSpacing);
                                break;

                            case "wave":
                                const waveSpacing = elementSize + 15;
                                const totalWaveWidth = (letters.length - 1) * waveSpacing;
                                x = (canvasWidth - totalWaveWidth) / 2 + (index * waveSpacing);
                                y = canvasHeight / 2 + Math.sin(index * 0.8) * (layout.params?.waveAmplitude || 50);
                                break;

                            case "spiral":
                                const spiralRadius = 10 + (index * (layout.params?.spiralTightness || 15));
                                const spiralAngle = index * 0.8;
                                x = canvasWidth / 2 + Math.cos(spiralAngle) * spiralRadius;
                                y = canvasHeight / 2 + Math.sin(spiralAngle) * spiralRadius;
                                break;

                            case "circle":
                                const circleRadius = Math.min(layout.params?.circleRadius || 150, letters.length * 20);
                                const angle = (index / letters.length) * Math.PI * 2;
                                x = canvasWidth / 2 + Math.cos(angle) * circleRadius;
                                y = canvasHeight / 2 + Math.sin(angle) * circleRadius;
                                break;

                            case "arc":
                                const arcRadius = Math.min(layout.params?.arcRadius || 200, letters.length * 25);
                                const arcAngle = Math.PI / 2 + (index / (letters.length - 1 || 1)) * Math.PI;
                                x = canvasWidth / 2 + Math.cos(arcAngle) * arcRadius;
                                y = canvasHeight / 2 + Math.sin(arcAngle) * arcRadius;
                                break;

                            default:
                                // Default horizontal
                                const defaultSpacing = elementSize + 20;
                                const totalDefaultWidth = (letters.length - 1) * defaultSpacing;
                                x = (canvasWidth - totalDefaultWidth) / 2 + (index * defaultSpacing);
                                y = canvasHeight / 2;
                        }
                        console.log(`Calculated position for ${letter}:`, { x, y, layout: layout.type });
                    }

                    // Create new image element
                    const imgEl = new Image();
                    imgEl.onload = () => {
                        const elementSize = layout.elementSize || 100;

                        // Calculate scale to maintain the same dimensions
                        const scaleX = elementSize / imgEl.width;
                        const scaleY = elementSize / imgEl.height;
                        const scale = Math.min(scaleX, scaleY);

                        const elementImg = new fabric.Image(imgEl, {
                            left: 0,
                            top: 0,
                            originX: 'center',
                            originY: 'center',
                            scaleX: scale,
                            scaleY: scale,
                            selectable: false,
                            evented: false,
                        });

                        // Create background rectangle
                        const backgroundRect = new fabric.Rect({
                            width: elementSize,
                            height: elementSize,
                            left: 0,
                            top: 0,
                            originX: 'center',
                            originY: 'center',
                            fill: layout.elementColor || "#ffffff",
                            stroke: 'transparent',
                            selectable: false,
                            evented: false,
                        });

                        // Create text for the element
                        const fontSize = Math.max(16, elementSize * 0.3);
                        const elementText = new fabric.Text(letter, {
                            fontSize: fontSize,
                            fill: layout.textColor || "#000000",
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
                        const customElementGroup = new fabric.Group([backgroundRect, elementImg, elementText], {
                            left: x,
                            top: y,
                            editableId: `customer_custom_element_${Date.now()}_${index}`,
                            isLocked: false,
                            letter: letter,
                            elementColor: layout.elementColor || "#ffffff",
                            textColor: layout.textColor || "#000000",
                            selectable: false,
                            evented: false,
                            width: elementSize,
                            height: elementSize,
                            layoutType: layout.type,
                            layoutParams: layout.params,
                            elementSize: elementSize,
                        });

                        c.add(customElementGroup);
                        c.renderAll();
                    };

                    // Set image source after defining onload
                    imgEl.src = layout.imageSrc;

                } catch (error) {
                    console.error("Error creating custom element:", error);
                }
            });

            c.renderAll();
            updateEditableItemsAfterCustomElementChange();
        });
    };

    const updateEditableItemsAfterCustomElementChange = () => {
        safeCanvasOperation(() => {
            const c = canvasRef.current;
            if (!c) return;

            // Update editable items to reflect current custom elements
            const customElementObjects = c.getObjects().filter((obj: any) =>
                obj.type === "group" && obj.editableId?.includes("custom_element") && obj.letter
            );

            const newCustomElementItems: EditableItem[] = customElementObjects.map((obj: any, index) => ({
                id: obj.editableId,
                type: "custom-element" as const,
                label: `Custom Element: ${obj.letter}`,
                letter: obj.letter,
                color: obj.elementColor || "#ffffff",
                textColor: obj.textColor || "#000000"
            }));

            // Keep existing non-custom-element items
            const existingNonCustomElementItems = editableItems.filter(item =>
                item.type !== "custom-element" &&
                !item.id.includes("customer_custom_element")
            );

            setEditableItems([...existingNonCustomElementItems, ...newCustomElementItems]);

            // Update color values
            const newColorValues: Record<string, string> = {};
            const newTextColorValues: Record<string, string> = {};

            newCustomElementItems.forEach(item => {
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

    const handleTextColorChange = (id: string, color: string) => {
        setTextColorValues((prev) => ({ ...prev, [id]: color }));
        safeCanvasOperation(() => {
            const c = canvasRef.current;
            if (!c) return;

            const obj = c.getObjects().find((o: any) => o.editableId === id);
            if (obj) {
                if (obj.type === "i-text") {
                    // For regular text elements
                    obj.set('fill', color);
                } else if (obj.type === "group") {
                    // For balloon text and custom element text
                    const textObj = obj.getObjects().find((o: any) => o.type === "text");
                    if (textObj) {
                        textObj.set('fill', color);
                        console.log("Updated text color for custom element:", color);
                    }
                    obj.set('textColor', color);
                }
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
                } else if (obj.type === "group" && obj.editableId?.includes("custom_element")) {
                    // For custom elements, change the background color
                    const rect = obj.getObjects().find((o: any) => o.type === "rect");
                    if (rect) {
                        rect.set('fill', color);
                        console.log("Updated background color for custom element:", color);
                    }
                    obj.set('elementColor', color);
                } else {
                    obj.set('fill', color);
                }
                c.renderAll();
            }
        });
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
                    <div className="p-4 space-y-6 border-b">
                        {/* Balloon Name Section */}
                        <div className="space-y-2">
                            <h3 className="font-medium text-sm">Balloon Name</h3>
                            <input
                                type="text"
                                value={balloonName}
                                onChange={(e) => setBalloonName(e.target.value.toUpperCase())}
                                placeholder="Enter balloon name"
                                className="w-full border border-gray-300 rounded p-2 text-sm font-medium text-center"
                                maxLength={20}
                            />
                            <div className="flex justify-between text-xs text-gray-500">
                                <span>{balloonName.length}/20 characters</span>
                                <span>{20 - balloonName.length} remaining</span>
                            </div>
                            <p className="text-xs text-gray-500 text-center">
                                Type to update all balloons automatically
                            </p>
                        </div>

                        {/* Custom Element Name Section */}
                        <div className="space-y-2">
                            <h3 className="font-medium text-sm">Custom Element Name</h3>
                            <input
                                type="text"
                                value={customElementName}
                                onChange={(e) => setCustomElementName(e.target.value.toUpperCase())}
                                placeholder="Enter custom element name"
                                className="w-full border border-gray-300 rounded p-2 text-sm font-medium text-center"
                                maxLength={20}
                            />
                            <div className="flex justify-between text-xs text-gray-500">
                                <span>{customElementName.length}/20 characters</span>
                                <span>{20 - customElementName.length} remaining</span>
                            </div>
                            <p className="text-xs text-gray-500 text-center">
                                Type to update all custom elements automatically (maintains original layout and size)
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
                                    <div>
                                        <label className="text-xs text-gray-600">Text Color</label>
                                        <input
                                            type="color"
                                            value={textColorValues[item.id] || "#000000"}
                                            onChange={(e) => handleTextColorChange(item.id, e.target.value)}
                                            className="w-full h-10 border border-gray-300 rounded cursor-pointer"
                                        />
                                    </div>
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

                            {(item.type === "balloon-text" || item.type === "custom-element") && (
                                <>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-xs text-gray-600">
                                                {item.type === "balloon-text" ? "Balloon Color" : "Element Color"}
                                            </label>
                                            <input
                                                type="color"
                                                value={colorValues[item.id] || (item.type === "balloon-text" ? "#e879f9" : "#ffffff")}
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
                                    {item.letter && (
                                        <p className="text-xs text-gray-500 text-center">
                                            Letter: {item.letter}
                                        </p>
                                    )}
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
                                setCustomElementName("");
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