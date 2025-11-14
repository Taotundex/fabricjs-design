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

type ActiveType = "text" | "shape" | "image" | "balloon" | "balloon-text" | "custom-element" | null;
type LayoutType = "horizontal" | "vertical" | "wave" | "spiral" | "circle" | "arc";

export default function EditorPage() {
    const canvasRef = useRef<fabricType.Canvas | null>(null);
    const fabricRef = useRef<any | null>(null);
    const canvasEl = useRef<HTMLCanvasElement | null>(null);
    const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);


    const undoStack = useRef<string[]>([]);
    const redoStack = useRef<string[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [activeType, setActiveType] = useState<ActiveType>(null);
    const [activeAttrs, setActiveAttrs] = useState<any>({});
    const [autoFitEnabled, setAutoFitEnabled] = useState(true);

    // Custom element states
    const [customElement, setCustomElement] = useState<File | null>(null);
    const [elementPreview, setElementPreview] = useState<string>("");
    const [elementName, setElementName] = useState("");
    const [elementSize, setElementSize] = useState<number>(100);
    const [selectedLayout, setSelectedLayout] = useState<LayoutType>("horizontal");
    const [layoutParams, setLayoutParams] = useState({
        waveAmplitude: 50,
        spiralTightness: 15,
        circleRadius: 150,
        arcRadius: 200,
    });

    const isApplyingRef = useRef(false);

    // Track custom element groups for layout preservation
    const customElementGroups = useRef<Map<string, { type: LayoutType; params: any; timestamp: number }>>(new Map());

    // Font options
    const fontFamilies = [
        "Arial",
        "Helvetica",
        "Times New Roman",
        "Courier New",
        "Georgia",
        "Verdana",
        "Impact",
        "Comic Sans MS",
        "Trebuchet MS"
    ];

    const fontWeights = [
        "normal",
        "bold",
        "bolder",
        "lighter",
        "100",
        "200",
        "300",
        "400",
        "500",
        "600",
        "700",
        "800",
        "900"
    ];

    // Layout options configuration
    const layoutOptions = [
        { value: "horizontal", label: "Horizontal", icon: "→" },
        { value: "vertical", label: "Vertical", icon: "↓" },
        { value: "wave", label: "Wave", icon: "〰️" },
        { value: "spiral", label: "Spiral", icon: "🌀" },
        { value: "circle", label: "Circle", icon: "⭕" },
        { value: "arc", label: "Arc", icon: "⌒" },
    ];

    // ===================== KEYBOARD SHORTCUTS =====================
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't trigger shortcuts when user is typing in inputs
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
                return;
            }

            // Ctrl+Z / Cmd+Z for Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            }

            // Ctrl+Y / Cmd+Shift+Z for Redo
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                redo();
            }

            // Delete/Backspace for Delete
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                deleteSelected();
            }

            // Ctrl+S / Cmd+S for Save
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                saveProject();
            }

            // Layer management shortcuts
            if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                if (e.key === ']') {
                    e.preventDefault();
                    bringToFront();
                } else if (e.key === '[') {
                    e.preventDefault();
                    sendToBack();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    // ===================== STATE SAVE / LOAD =====================
    const saveCurrentState = () => {
        if (isApplyingRef.current) return;
        const c = canvasRef.current;
        if (!c) return;
        try {
            // Force a render to ensure all properties are updated
            c.renderAll();

            const json = JSON.stringify(c.toJSON());
            undoStack.current.push(json);
            redoStack.current = [];
            localStorage.setItem("canvas_state", json);
            localStorage.setItem("canvas_state_ts", String(Date.now()));

            // Broadcast currently selected object's identifier so other tabs can sync selection
            try {
                const active = c.getActiveObject();
                let activeId: string | null = null;
                if (active) {
                    if (active.editableId) activeId = String(active.editableId);
                    else if (active.groupTimestamp) activeId = String(active.groupTimestamp);
                }
                if (activeId) {
                    localStorage.setItem("canvas_activeId", activeId);
                    localStorage.setItem("canvas_activeId_ts", String(Date.now()));
                } else {
                    // Clear selection broadcast
                    localStorage.removeItem("canvas_activeId");
                    localStorage.setItem("canvas_activeId_ts", String(Date.now()));
                }
            } catch (err) {
                // non-fatal
            }
        } catch (err) {
            console.error("Error saving state:", err);
        }
    };

    // ===================== STORAGE EVENT SYNC (cross-tab) =====================
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            try {
                // Canvas content update (json)
                if (e.key === "canvas_state" && e.newValue) {
                    if (isApplyingRef.current) return;
                    const json = e.newValue;
                    isApplyingRef.current = true;
                    applyJSON(json, false);
                    // small delay to avoid racing
                    setTimeout(() => {
                        isApplyingRef.current = false;
                    }, 150);
                }

                // Selection update: attempt to find object by editableId or groupTimestamp
                if (e.key === "canvas_activeId") {
                    const activeId = e.newValue;
                    const c = canvasRef.current;
                    if (!c) return;
                    if (!activeId) {
                        c.discardActiveObject();
                        c.renderAll();
                        setActiveType(null);
                        setActiveAttrs({});
                        return;
                    }
                    const objs = c.getObjects();
                    const found = objs.find((o: any) => String(o.editableId || o.groupTimestamp || "") === String(activeId));
                    if (found) {
                        c.setActiveObject(found);
                        c.renderAll();
                        updateActiveObject();
                    }
                }
            } catch (err) {
                // ignore
            }
        };

        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);

    // Helper function to save project
    const saveProjectAs = (name: string) => {
        const c = canvasRef.current;
        if (!c) return;

        const json = JSON.stringify(c.toJSON());
        const thumbnail = c.toDataURL({ format: "png", quality: 0.6, multiplier: 1 });
        const project: Project = { name, thumbnail, json, updatedAt: Date.now() };

        const updated = [...projects.filter((p) => p.name !== name), project];
        localStorage.setItem("projects", JSON.stringify(updated));
        setProjects(updated);
        console.log(`💾 Saved project: ${name}`);
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

    const bringToFront = () => {
        const c = canvasRef.current;
        const fabric = fabricRef.current;
        if (!c) return;
        const selected = c.getActiveObjects();
        if (!selected || selected.length === 0) return;

        try {
            const objs = c.getObjects();
            // move each selected object to the top in the same order
            selected.forEach((o) => {
                const lastIndex = objs.length - 1;
                if (typeof (c as any).moveTo === 'function') {
                    (c as any).moveTo(o, lastIndex);
                } else if (typeof (c as any).bringToFront === 'function') {
                    (c as any).bringToFront(o);
                }
            });

            // restore selection
            if (fabric && selected.length > 1 && (fabric as any).ActiveSelection) {
                const ActiveSelection = (fabric as any).ActiveSelection;
                const sel = new ActiveSelection(selected, { canvas: c });
                c.setActiveObject(sel);
            } else if (selected.length === 1) {
                c.setActiveObject(selected[0]);
            }

            c.renderAll();
            saveCurrentState();
            updateActiveObject();
        } catch (err) {
            console.error('bringToFront failed', err);
        }
    };

    const sendToBack = () => {
        const c = canvasRef.current;
        const fabric = fabricRef.current;
        if (!c) return;
        const selected = c.getActiveObjects();
        if (!selected || selected.length === 0) return;

        try {
            const objs = c.getObjects();
            // send to back: do in reverse so relative order is preserved
            selected.slice().reverse().forEach((o) => {
                if (typeof (c as any).moveTo === 'function') {
                    (c as any).moveTo(o, 0);
                } else if (typeof (c as any).sendToBack === 'function') {
                    (c as any).sendToBack(o);
                }
            });

            if (fabric && selected.length > 1 && (fabric as any).ActiveSelection) {
                const ActiveSelection = (fabric as any).ActiveSelection;
                const sel = new ActiveSelection(selected, { canvas: c });
                c.setActiveObject(sel);
            } else if (selected.length === 1) {
                c.setActiveObject(selected[0]);
            }

            c.renderAll();
            saveCurrentState();
            updateActiveObject();
        } catch (err) {
            console.error('sendToBack failed', err);
        }
    };

    const bringForward = () => {
        const c = canvasRef.current;
        if (!c) return;
        const selected = c.getActiveObjects();
        if (!selected || selected.length === 0) return;

        try {
            const objs = c.getObjects();
            // iterate from highest index to lowest to avoid double-swapping
            const byIndex = selected
                .map((o) => ({ o, i: objs.indexOf(o) }))
                .sort((a, b) => b.i - a.i);
            byIndex.forEach(({ o, i }) => {
                const target = Math.min(objs.length - 1, i + 1);
                if (typeof (c as any).moveTo === 'function') (c as any).moveTo(o, target);
                else if (typeof (c as any).bringForward === 'function') (c as any).bringForward(o);
            });

            if (selected.length === 1) c.setActiveObject(selected[0]);
            else if (fabricRef.current && (fabricRef.current as any).ActiveSelection) {
                const ActiveSelection = (fabricRef.current as any).ActiveSelection;
                const sel = new ActiveSelection(selected, { canvas: c });
                c.setActiveObject(sel);
            }

            c.renderAll();
            saveCurrentState();
            updateActiveObject();
        } catch (err) {
            console.error('bringForward failed', err);
        }
    };

    const sendBackwards = () => {
        const c = canvasRef.current;
        if (!c) return;
        const selected = c.getActiveObjects();
        if (!selected || selected.length === 0) return;

        try {
            const objs = c.getObjects();
            // iterate from lowest index to highest so we move objects backward correctly
            const byIndex = selected
                .map((o) => ({ o, i: objs.indexOf(o) }))
                .sort((a, b) => a.i - b.i);
            byIndex.forEach(({ o, i }) => {
                const target = Math.max(0, i - 1);
                if (typeof (c as any).moveTo === 'function') (c as any).moveTo(o, target);
                else if (typeof (c as any).sendBackwards === 'function') (c as any).sendBackwards(o);
            });

            if (selected.length === 1) c.setActiveObject(selected[0]);
            else if (fabricRef.current && (fabricRef.current as any).ActiveSelection) {
                const ActiveSelection = (fabricRef.current as any).ActiveSelection;
                const sel = new ActiveSelection(selected, { canvas: c });
                c.setActiveObject(sel);
            }

            c.renderAll();
            saveCurrentState();
            updateActiveObject();
        } catch (err) {
            console.error('sendBackwards failed', err);
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

            // EXTEND FABRIC TO INCLUDE LAYOUT PROPERTIES
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
                        "opacity",
                        "letter",
                        "textColor",
                        "elementColor",
                        "layoutType",
                        "layoutParams",
                        "elementSize",
                        "groupTimestamp",
                        "stroke",
                        "strokeWidth",
                        "strokeDashArray",
                        "rx", // Keep only for rectangles
                        "ry", // Keep only for rectangles
                        "fontFamily",
                        "fontWeight",
                        "fontStyle",
                        "textAlign",
                        "underline",
                        "linethrough",
                        "overline",
                    ]);
                    return toObject.call(this, propertiesToInclude);
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
            c.on("selection:created", () => {
                updateActiveObject();
                // broadcast selection to other tabs
                try {
                    const active = c.getActiveObject();
                    let activeId: string | null = null;
                    if (active) {
                        if (active.editableId) activeId = String(active.editableId);
                        else if (active.groupTimestamp) activeId = String(active.groupTimestamp);
                    }
                    if (activeId) {
                        localStorage.setItem("canvas_activeId", activeId);
                        localStorage.setItem("canvas_activeId_ts", String(Date.now()));
                    } else {
                        localStorage.removeItem("canvas_activeId");
                        localStorage.setItem("canvas_activeId_ts", String(Date.now()));
                    }
                } catch (err) {
                    // ignore
                }
            });
            c.on("selection:updated", () => {
                updateActiveObject();
                try {
                    const active = c.getActiveObject();
                    let activeId: string | null = null;
                    if (active) {
                        if (active.editableId) activeId = String(active.editableId);
                        else if (active.groupTimestamp) activeId = String(active.groupTimestamp);
                    }
                    if (activeId) {
                        localStorage.setItem("canvas_activeId", activeId);
                        localStorage.setItem("canvas_activeId_ts", String(Date.now()));
                    } else {
                        localStorage.removeItem("canvas_activeId");
                        localStorage.setItem("canvas_activeId_ts", String(Date.now()));
                    }
                } catch (err) {
                    // ignore
                }
            });
            c.on("selection:cleared", () => {
                setActiveType(null);
                setActiveAttrs({});
            });

            // Update properties when objects are modified
            c.on("object:modified", updateActiveObject);

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
        const name = prompt("Enter project name:")?.trim();
        if (!name) return;
        saveProjectAs(name);
    };

    const loadProject = (project: Project) => applyJSON(project.json, autoFitEnabled);
    const deleteProject = (name: string) => {
        const updated = projects.filter((p) => p.name !== name);
        localStorage.setItem("projects", JSON.stringify(updated));
        setProjects(updated);
    };

    // ===================== CUSTOM ELEMENT FUNCTIONS =====================
    const handleElementUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setCustomElement(file);

        const reader = new FileReader();
        reader.onload = () => {
            setElementPreview(reader.result as string);
        };
        reader.readAsDataURL(file);
    };

    const createCustomElementWithText = (letter: string, index: number, total: number) => {
        const fabric = fabricRef.current;
        if (!fabric || !canvasRef.current || !elementPreview) return;

        const containerSize = elementSize;
        const canvasWidth = canvasRef.current.width || 1000;
        const canvasHeight = canvasRef.current.height || 600;

        // Calculate position based on selected layout
        let x = 0;
        let y = 0;

        switch (selectedLayout) {
            case "horizontal":
                // Horizontal line
                const horizontalSpacing = containerSize + 20;
                const totalHorizontalWidth = (total - 1) * horizontalSpacing;
                x = (canvasWidth - totalHorizontalWidth) / 2 + (index * horizontalSpacing);
                y = canvasHeight / 2;
                break;

            case "vertical":
                // Vertical line
                const verticalSpacing = containerSize + 20;
                const totalVerticalHeight = (total - 1) * verticalSpacing;
                x = canvasWidth / 2;
                y = (canvasHeight - totalVerticalHeight) / 2 + (index * verticalSpacing);
                break;

            case "wave":
                // Wave pattern
                const waveSpacing = containerSize + 15;
                const totalWaveWidth = (total - 1) * waveSpacing;
                x = (canvasWidth - totalWaveWidth) / 2 + (index * waveSpacing);
                y = canvasHeight / 2 + Math.sin(index * 0.8) * layoutParams.waveAmplitude;
                break;

            case "spiral":
                // Spiral pattern
                const spiralRadius = 10 + (index * layoutParams.spiralTightness);
                const spiralAngle = index * 0.8; // radians
                x = canvasWidth / 2 + Math.cos(spiralAngle) * spiralRadius;
                y = canvasHeight / 2 + Math.sin(spiralAngle) * spiralRadius;
                break;

            case "circle":
                // Circular pattern
                const circleRadius = Math.min(layoutParams.circleRadius, total * 20);
                const angle = (index / total) * Math.PI * 2;
                x = canvasWidth / 2 + Math.cos(angle) * circleRadius;
                y = canvasHeight / 2 + Math.sin(angle) * circleRadius;
                break;

            case "arc":
                // Arc pattern (semi-circle)
                const arcRadius = Math.min(layoutParams.arcRadius, total * 25);
                const arcAngle = Math.PI / 2 + (index / (total - 1 || 1)) * Math.PI;
                x = canvasWidth / 2 + Math.cos(arcAngle) * arcRadius;
                y = canvasHeight / 2 + Math.sin(arcAngle) * arcRadius;
                break;

            default:
                // Default to horizontal
                const defaultSpacing = containerSize + 20;
                const totalDefaultWidth = (total - 1) * defaultSpacing;
                x = (canvasWidth - totalDefaultWidth) / 2 + (index * defaultSpacing);
                y = canvasHeight / 2;
        }

        // Create image element
        const imgEl = new Image();
        imgEl.onload = () => {
            // Calculate scale to fit within the square container while maintaining aspect ratio
            const scaleX = containerSize / imgEl.width;
            const scaleY = containerSize / imgEl.height;
            const scale = Math.min(scaleX, scaleY);

            const scaledWidth = imgEl.width * scale;
            const scaledHeight = imgEl.height * scale;

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

            // Create a background rectangle to ensure consistent sizing
            const backgroundRect = new fabric.Rect({
                width: containerSize,
                height: containerSize,
                left: 0,
                top: 0,
                originX: 'center',
                originY: 'center',
                fill: 'transparent',
                stroke: 'transparent',
                selectable: false,
                evented: false,
            });

            // Adjust font size based on container size
            const fontSize = Math.max(16, containerSize * 0.3);

            // Create text for the element
            const elementText = new fabric.Text(letter, {
                fontSize: fontSize,
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

            // Create group with background, image, and text
            const groupTimestamp = Date.now();
            const elementGroup = new fabric.Group([backgroundRect, elementImg, elementText], {
                left: x,
                top: y,
                editableId: `custom_element_${groupTimestamp}_${index}`,
                isLocked: false,
                letter: letter,
                elementColor: "transparent", // Background is transparent
                textColor: "#000000",
                selectable: true,
                evented: true,
                width: containerSize,
                height: containerSize,
                // CRITICAL: SAVE LAYOUT INFORMATION
                layoutType: selectedLayout,
                layoutParams: layoutParams,
                elementSize: containerSize,
                groupTimestamp: groupTimestamp, // Same timestamp for all elements in this group
            });

            canvasRef.current.add(elementGroup);
            canvasRef.current.renderAll();

            // Track this group for layout preservation
            customElementGroups.current.set(`group_${groupTimestamp}`, {
                type: selectedLayout,
                params: layoutParams,
                timestamp: groupTimestamp
            });
        };
        imgEl.src = elementPreview;
    };

    const addElementName = () => {
        if (!elementName.trim()) {
            alert("Please enter a name for the elements");
            return;
        }

        if (!elementPreview) {
            alert("Please upload an element first");
            return;
        }

        const name = elementName.trim().toUpperCase();
        const letters = name.split('');

        letters.forEach((letter, index) => {
            createCustomElementWithText(letter, index, letters.length);
        });

        // Clear the input after creating elements
        setElementName("");
    };

    const addSingleElement = () => {
        if (!fabricRef.current || !canvasRef.current || !elementPreview) return;
        const fabric = fabricRef.current;

        const imgEl = new Image();
        imgEl.onload = () => {
            const containerSize = elementSize;

            // Calculate scale to fit within the square container while maintaining aspect ratio
            const scaleX = containerSize / imgEl.width;
            const scaleY = containerSize / imgEl.height;
            const scale = Math.min(scaleX, scaleY);

            const scaledWidth = imgEl.width * scale;
            const scaledHeight = imgEl.height * scale;

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

            // Create a background rectangle to ensure consistent sizing
            const backgroundRect = new fabric.Rect({
                width: containerSize,
                height: containerSize,
                left: 0,
                top: 0,
                originX: 'center',
                originY: 'center',
                fill: 'transparent',
                stroke: 'transparent',
                selectable: false,
                evented: false,
            });

            const groupTimestamp = Date.now();
            const elementGroup = new fabric.Group([backgroundRect, elementImg], {
                left: 250,
                top: 150,
                editableId: `custom_element_${groupTimestamp}`,
                isLocked: false,
                elementColor: "transparent",
                selectable: true,
                evented: true,
                width: containerSize,
                height: containerSize,
                elementSize: containerSize,
                groupTimestamp: groupTimestamp,
            });

            canvasRef.current.add(elementGroup);
            canvasRef.current.renderAll();
        };
        imgEl.src = elementPreview;
    };

    const clearElementUpload = () => {
        setCustomElement(null);
        setElementPreview("");
        setElementName("");
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
                stroke: "#000000",
                strokeWidth: 0,
                rx: 0, // Border radius X
                ry: 0, // Border radius Y
                editableId: `shape_${Date.now()}`,
                isLocked: false,
                selectable: true,
                evented: true,
            });
        else if (type === "circle")
            shape = new fabric.Circle({
                left: 150,
                top: 150,
                radius: 50,
                fill: "#a3e635",
                stroke: "#000000",
                strokeWidth: 0,
                editableId: `shape_${Date.now()}`,
                isLocked: false,
                selectable: true,
                evented: true,
            });
        else if (type === "triangle")
            shape = new fabric.Triangle({
                left: 200,
                top: 200,
                width: 100,
                height: 100,
                fill: "#f87171",
                stroke: "#000000",
                strokeWidth: 0,
                editableId: `shape_${Date.now()}`,
                isLocked: false,
                selectable: true,
                evented: true,
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
            fontFamily: "Arial",
            fontWeight: "normal",
            fontStyle: "normal",
            textAlign: "left",
            underline: false,
            linethrough: false,
            overline: false,
            editableId: `text_${Date.now()}`,
            isLocked: false,
            selectable: true,
            evented: true,
        });
        canvasRef.current.add(text);
    };

    // ===================== ALTERNATIVE IMAGE UPLOAD WITH BORDER RADIUS =====================
    const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const imgEl = new window.Image();
            imgEl.onload = () => {
                const fabric = fabricRef.current;
                if (!fabric || !canvasRef.current) return;

                // Create a rounded rect to be used as a clipPath for the image
                const roundedRect = new fabric.Rect({
                    left: 0,
                    top: 0,
                    originX: 'left',
                    originY: 'top',
                    width: imgEl.width,
                    height: imgEl.height,
                    rx: 0,
                    ry: 0,
                    fill: 'white',
                    selectable: false,
                    evented: false,
                });

                // Create the image
                const img = new fabric.Image(imgEl, {
                    left: 0,
                    top: 0,
                    originX: 'left',
                    originY: 'top',
                    selectable: true,
                    evented: true,
                });

                // Create a group that contains the image and uses roundedRect as its clipPath
                const group = new fabric.Group([img], {
                    left: 100,
                    top: 100,
                    editableId: `image_${Date.now()}`,
                    isLocked: false,
                    selectable: true,
                    evented: true,
                    rx: 0,
                    ry: 0,
                });

                roundedRect.absolutePositioned = false;
                (group as any).clipPath = roundedRect;

                canvasRef.current.add(group);
                canvasRef.current.renderAll();
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
        setActiveType(null);
        setActiveAttrs({});
    };

    const toggleLock = () => {
        const obj = canvasRef.current?.getActiveObject();
        if (!obj) return;
        const newLockState = !obj.isLocked;
        obj.set({
            isLocked: newLockState,
            selectable: !newLockState,
            evented: !newLockState,
            lockMovementX: newLockState,
            lockMovementY: newLockState,
            lockRotation: newLockState,
            lockScalingX: newLockState,
            lockScalingY: newLockState,
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

        let type: ActiveType = null;

        if (obj.type === "i-text" || obj.type === "text") {
            type = "text";
        } else if (["rect", "circle", "triangle"].includes(obj.type)) {
            type = "shape";
        } else if (obj.type === "image") {
            type = "image";
        } else if (obj.type === "group") {
            if (obj.editableId?.includes("custom_element")) {
                type = "custom-element";
            } else if (obj.editableId?.includes("image_")) {
                type = "image";
            }
        }

        setActiveType(type);

        // Create a clean copy of the object properties
        const attrs = {
            ...obj.toObject(),
            type: obj.type,
            isLocked: obj.isLocked,
            selectable: obj.selectable,
            evented: obj.evented,
            opacity: obj.opacity,
            fill: obj.fill,
            stroke: obj.stroke,
            strokeWidth: obj.strokeWidth,
            fontSize: obj.fontSize,
            fontFamily: obj.fontFamily,
            fontWeight: obj.fontWeight,
            fontStyle: obj.fontStyle,
            textAlign: obj.textAlign,
            underline: obj.underline,
            linethrough: obj.linethrough,
            rx: obj.rx,
            ry: obj.ry,
            letter: obj.letter,
            textColor: obj.textColor,
            elementColor: obj.elementColor,
            layoutType: obj.layoutType,
            editableId: obj.editableId,
        };

        // If this is an uploaded image group, prefer radius from clipPath (or fallback to internal rect)
        if (type === 'image' && obj.type === 'group' && obj.editableId?.includes('image_')) {
            const grp: any = obj;
            const clip = grp.clipPath ?? grp.getObjects().find((o: any) => o.type === 'rect');
            if (clip) {
                attrs.rx = clip.rx ?? attrs.rx;
                attrs.ry = clip.ry ?? attrs.ry;
            }
        }

        setActiveAttrs(attrs);
    };

    // For uploaded image groups, ensure rx/ry reflect the group's clipPath (if present)
    // (we keep this separate so attrs contains the correct radius values)
    // Note: this runs implicitly via updateActiveObject flow when selection changes

    const updateAttr = (attr: string, value: any) => {
        const obj = canvasRef.current?.getActiveObject();
        const fabric = fabricRef.current;
        if (!obj || !fabric) return;

        // Handle border radius for rectangles and image groups
        if (attr === "rx" || attr === "ry") {
            obj.set(attr, value);

            // For image groups (rounded images), update the rectangle inside
            if (obj.type === "group" && obj.editableId?.includes("image_")) {
                const rectObj = obj.getObjects().find((o: any) => o.type === 'rect');
                if (rectObj) {
                    rectObj.set({
                        rx: attr === "rx" ? value : obj.rx || 0,
                        ry: attr === "ry" ? value : obj.ry || 0
                    });
                }
            }

            // For rectangles, sync rx and ry
            if (obj.type === "rect" && attr === "rx") {
                obj.set("ry", value);
            }
        } else {
            // Existing property handling...
            // Special handling for group objects (custom elements)
            if (obj.type === 'group' && obj.editableId?.includes("custom_element")) {
                // Handle text properties for custom element groups
                if (['fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'textAlign', 'underline', 'linethrough'].includes(attr)) {
                    const textObj = obj.getObjects().find((o: any) => o.type === 'text' || o.type === 'i-text');
                    if (textObj) {
                        textObj.set(attr, value);
                    }
                }
                // Handle text color
                else if (attr === 'textColor') {
                    const textObj = obj.getObjects().find((o: any) => o.type === 'text' || o.type === 'i-text');
                    if (textObj) {
                        textObj.set('fill', value);
                    }
                    obj.set('textColor', value);
                }
                // Handle element color (background)
                else if (attr === 'elementColor') {
                    const rectObj = obj.getObjects().find((o: any) => o.type === 'rect');
                    if (rectObj) {
                        rectObj.set('fill', value);
                    }
                    obj.set('elementColor', value);
                }
                // Handle letter change
                else if (attr === 'letter') {
                    const textObj = obj.getObjects().find((o: any) => o.type === 'text' || o.type === 'i-text');
                    if (textObj) {
                        textObj.set('text', value);
                    }
                    obj.set('letter', value);
                }
                // Handle element size
                else if (attr === 'elementSize') {
                    // This would require more complex resizing logic
                    console.log("Element size change requires complex resizing - not implemented");
                }
                else {
                    obj.set(attr, value);
                }
            } else {
                obj.set(attr, value);
            }
        }

        canvasRef.current?.renderAll();
        saveCurrentState();

        // Update the active object properties immediately
        setTimeout(updateActiveObject, 0);
    };

    // ===================== RENDER =====================
    return (
        <div className="flex h-screen bg-gray-100">
            {/* ===== LEFT TOOLS ===== */}
            <div className="flex flex-col w-[220px] gap-2 bg-white shadow p-3 border-b overflow-y-scroll">
                <div className="text-xs text-gray-500 mb-2">
                    Shortcuts: Ctrl+Z (Undo), Ctrl+Y (Redo), Delete, Ctrl+S (Save)
                    <br />Layers: Ctrl+Shift+] (Front), Ctrl+Shift+[ (Back)
                </div>

                <h3 className="font-semibold mb-2">Custom Elements</h3>

                {/* Element Upload & Name Input */}
                <div className="space-y-2 mb-2">
                    {/* Element Upload */}
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-3 text-center">
                        {elementPreview ? (
                            <div className="space-y-2">
                                <div className="relative w-16 h-16 mx-auto">
                                    <img
                                        src={elementPreview}
                                        alt="Uploaded element"
                                        className="w-full h-full object-contain"
                                    />
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={clearElementUpload}
                                    className="w-full text-xs"
                                >
                                    Change Element
                                </Button>
                            </div>
                        ) : (
                            <label className="cursor-pointer">
                                <div className="text-gray-500 text-sm">
                                    <div>📁 Upload Element</div>
                                    <div className="text-xs mt-1">PNG, JPG, SVG</div>
                                </div>
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handleElementUpload}
                                />
                            </label>
                        )}
                    </div>

                    {/* Name Input */}
                    <input
                        type="text"
                        value={elementName}
                        onChange={(e) => setElementName(e.target.value)}
                        placeholder="Enter name for elements"
                        className="w-full border border-gray-300 rounded p-2 text-sm"
                        maxLength={20}
                    />

                    {/* Text Color */}
                    <div>
                        <label className="text-xs block mb-1">Text Color</label>
                        <input
                            type="color"
                            value="#000000"
                            onChange={(e) => {
                                // This will be applied when creating new elements
                                // For existing elements, use the properties panel
                            }}
                            className="w-full h-8 border rounded"
                        />
                    </div>

                    {/* Element Size */}
                    <div>
                        <label className="text-xs block mb-1">Element Size: {elementSize}px</label>
                        <input
                            type="range"
                            min="50"
                            max="200"
                            step="10"
                            value={elementSize}
                            onChange={(e) => setElementSize(parseInt(e.target.value))}
                            className="w-full"
                        />
                    </div>

                    {/* Layout Selection */}
                    <div className="mt-2">
                        <label className="text-xs block mb-2 font-medium">Layout</label>
                        <div className="grid grid-cols-3 gap-2">
                            {layoutOptions.map((layout) => (
                                <button
                                    key={layout.value}
                                    onClick={() => setSelectedLayout(layout.value as LayoutType)}
                                    className={`p-2 border rounded text-xs flex flex-col items-center justify-center transition-all ${selectedLayout === layout.value
                                        ? 'bg-purple-600 text-white border-purple-600'
                                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                        }`}
                                >
                                    <span className="text-lg mb-1">{layout.icon}</span>
                                    <span>{layout.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Layout Preview/Description */}
                    <div className="mt-1 text-xs text-gray-500 text-center">
                        {selectedLayout === "horizontal" && "Letters arranged in a straight horizontal line"}
                        {selectedLayout === "vertical" && "Letters arranged in a straight vertical line"}
                        {selectedLayout === "wave" && "Letters arranged in a wave pattern"}
                        {selectedLayout === "spiral" && "Letters arranged in a spiral from center"}
                        {selectedLayout === "circle" && "Letters arranged in a circular pattern"}
                        {selectedLayout === "arc" && "Letters arranged in an arc (semi-circle)"}
                    </div>

                    {/* Layout Parameters */}
                    {selectedLayout === "wave" && (
                        <div className="mt-2">
                            <label className="text-xs block mb-1">Wave Height: {layoutParams.waveAmplitude}px</label>
                            <input
                                type="range"
                                min="20"
                                max="100"
                                value={layoutParams.waveAmplitude}
                                onChange={(e) => setLayoutParams(prev => ({
                                    ...prev,
                                    waveAmplitude: parseInt(e.target.value)
                                }))}
                                className="w-full"
                            />
                        </div>
                    )}

                    {selectedLayout === "spiral" && (
                        <div className="mt-2">
                            <label className="text-xs block mb-1">Spiral Tightness: {layoutParams.spiralTightness}px</label>
                            <input
                                type="range"
                                min="5"
                                max="30"
                                value={layoutParams.spiralTightness}
                                onChange={(e) => setLayoutParams(prev => ({
                                    ...prev,
                                    spiralTightness: parseInt(e.target.value)
                                }))}
                                className="w-full"
                            />
                        </div>
                    )}

                    {selectedLayout === "circle" && (
                        <div className="mt-2">
                            <label className="text-xs block mb-1">Circle Radius: {layoutParams.circleRadius}px</label>
                            <input
                                type="range"
                                min="50"
                                max="300"
                                value={layoutParams.circleRadius}
                                onChange={(e) => setLayoutParams(prev => ({
                                    ...prev,
                                    circleRadius: parseInt(e.target.value)
                                }))}
                                className="w-full"
                            />
                        </div>
                    )}

                    {selectedLayout === "arc" && (
                        <div className="mt-2">
                            <label className="text-xs block mb-1">Arc Radius: {layoutParams.arcRadius}px</label>
                            <input
                                type="range"
                                min="50"
                                max="300"
                                value={layoutParams.arcRadius}
                                onChange={(e) => setLayoutParams(prev => ({
                                    ...prev,
                                    arcRadius: parseInt(e.target.value)
                                }))}
                                className="w-full"
                            />
                        </div>
                    )}

                    {/* Action Buttons */}
                    <Button
                        size='lg'
                        onClick={addElementName}
                        className="w-full bg-purple-600 hover:bg-purple-700"
                        disabled={!elementPreview}
                    >
                        Create Name Elements
                    </Button>

                    <Button
                        size='lg'
                        onClick={addSingleElement}
                        disabled={!elementPreview}
                        variant="outline"
                    >
                        Single Element
                    </Button>
                </div>

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

                <h3 className="font-semibold mt-4 mb-2">Layer Management</h3>
                <Button size='lg' onClick={bringToFront} variant="outline">Bring to Front</Button>
                <Button size='lg' onClick={sendToBack} variant="outline">Send to Back</Button>
                <Button size='lg' onClick={bringForward} variant="outline">Bring Forward</Button>
                <Button size='lg' onClick={sendBackwards} variant="outline">Send Backward</Button>

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
                            {/* Common Properties */}
                            <div>
                                <label className="text-sm font-medium">Opacity</label>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={activeAttrs.opacity || 1}
                                    onChange={(e) => updateAttr("opacity", parseFloat(e.target.value))}
                                    className="w-full"
                                />
                                <div className="text-xs text-gray-500 text-right">
                                    {Math.round((activeAttrs.opacity || 1) * 100)}%
                                </div>
                            </div>

                            {/* TEXT SPECIFIC PROPERTIES */}
                            {(activeType === "text" || activeType === "custom-element") && (
                                <>
                                    <div>
                                        <label className="text-sm font-medium">Font Family</label>
                                        <select
                                            value={activeAttrs.fontFamily || "Arial"}
                                            onChange={(e) => updateAttr("fontFamily", e.target.value)}
                                            className="w-full border border-gray-300 rounded p-2 text-sm"
                                        >
                                            {fontFamilies.map(font => (
                                                <option key={font} value={font}>{font}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-sm font-medium">Font Size</label>
                                        <input
                                            type="number"
                                            value={activeAttrs.fontSize || 24}
                                            onChange={(e) => updateAttr("fontSize", parseInt(e.target.value))}
                                            className="w-full border border-gray-300 rounded p-2 text-sm"
                                            min="8"
                                            max="200"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-sm font-medium">Font Weight</label>
                                        <select
                                            value={activeAttrs.fontWeight || "normal"}
                                            onChange={(e) => updateAttr("fontWeight", e.target.value)}
                                            className="w-full border border-gray-300 rounded p-2 text-sm"
                                        >
                                            {fontWeights.map(weight => (
                                                <option key={weight} value={weight}>{weight}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-sm font-medium">Font Style</label>
                                        <select
                                            value={activeAttrs.fontStyle || "normal"}
                                            onChange={(e) => updateAttr("fontStyle", e.target.value)}
                                            className="w-full border border-gray-300 rounded p-2 text-sm"
                                        >
                                            <option value="normal">Normal</option>
                                            <option value="italic">Italic</option>
                                            <option value="oblique">Oblique</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-sm font-medium">Text Align</label>
                                        <select
                                            value={activeAttrs.textAlign || "left"}
                                            onChange={(e) => updateAttr("textAlign", e.target.value)}
                                            className="w-full border border-gray-300 rounded p-2 text-sm"
                                        >
                                            <option value="left">Left</option>
                                            <option value="center">Center</option>
                                            <option value="right">Right</option>
                                            <option value="justify">Justify</option>
                                        </select>
                                    </div>

                                    <div className="flex gap-2">
                                        <label className="flex items-center gap-1 text-sm">
                                            <input
                                                type="checkbox"
                                                checked={activeAttrs.underline || false}
                                                onChange={(e) => updateAttr("underline", e.target.checked)}
                                            />
                                            Underline
                                        </label>
                                        <label className="flex items-center gap-1 text-sm">
                                            <input
                                                type="checkbox"
                                                checked={activeAttrs.linethrough || false}
                                                onChange={(e) => updateAttr("linethrough", e.target.checked)}
                                            />
                                            Strikethrough
                                        </label>
                                    </div>
                                </>
                            )}

                            {/* COLOR PROPERTIES */}
                            <div>
                                <label className="text-sm font-medium">
                                    {activeType === "text" ? "Text Color" :
                                        activeType === "custom-element" ? "Element Color" : "Fill Color"}
                                </label>
                                <input
                                    type="color"
                                    value={activeAttrs.fill || activeAttrs.elementColor || "#000000"}
                                    onChange={(e) => {
                                        if (activeType === "custom-element") {
                                            updateAttr("elementColor", e.target.value);
                                        } else {
                                            updateAttr("fill", e.target.value);
                                        }
                                    }}
                                    className="w-full h-10 border rounded"
                                />
                            </div>

                            {/* For custom elements, show letter editing and text color */}
                            {activeType === "custom-element" && (
                                <>
                                    <div>
                                        <label className="text-sm font-medium">Letter</label>
                                        <input
                                            type="text"
                                            value={activeAttrs.letter || ""}
                                            onChange={(e) => {
                                                const newLetter = e.target.value.charAt(0).toUpperCase(); // Only take first character
                                                updateAttr("letter", newLetter);
                                            }}
                                            className="w-full border border-gray-300 rounded p-2 text-sm"
                                            maxLength={1}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium">Text Color</label>
                                        <input
                                            type="color"
                                            value={activeAttrs.textColor || "#000000"}
                                            onChange={(e) => updateAttr("textColor", e.target.value)}
                                            className="w-full h-10 border rounded"
                                        />
                                    </div>
                                </>
                            )}

                            {/* BORDER PROPERTIES FOR SHAPES AND IMAGES */}
                            {(activeType === "shape" || activeType === "image") && (
                                <>
                                    <div>
                                        <label className="text-sm font-medium">Border Color</label>
                                        <input
                                            type="color"
                                            value={activeAttrs.stroke || "#000000"}
                                            onChange={(e) => updateAttr("stroke", e.target.value)}
                                            className="w-full h-10 border rounded"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-sm font-medium">Border Width</label>
                                        <input
                                            type="number"
                                            value={activeAttrs.strokeWidth || 0}
                                            onChange={(e) => updateAttr("strokeWidth", parseInt(e.target.value))}
                                            className="w-full border border-gray-300 rounded p-2 text-sm"
                                            min="0"
                                            max="20"
                                        />
                                    </div>

                                    {/* Border Radius for Rectangles and Image Groups */}
                                    {(activeType === "shape" && activeAttrs.type === "rect") || activeType === "image" ? (
                                        <div>
                                            <label className="text-sm font-medium">Border Radius</label>
                                            <input
                                                type="number"
                                                value={activeAttrs.rx || 0}
                                                onChange={(e) => {
                                                    const radius = parseInt(e.target.value);
                                                    updateAttr("rx", radius);
                                                    if (activeType === "shape" && activeAttrs.type === "rect") {
                                                        updateAttr("ry", radius); // Sync for rectangles
                                                    }
                                                }}
                                                className="w-full border border-gray-300 rounded p-2 text-sm"
                                                min="0"
                                                max="100"
                                            />
                                        </div>
                                    ) : null}
                                </>
                            )}

                            {/* Lock Status */}
                            <div className="text-sm pt-2 border-t">
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
                                {activeAttrs.layoutType && (
                                    <div>Layout: {activeAttrs.layoutType}</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </aside>
        </div>
    );
}