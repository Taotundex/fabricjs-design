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

type ActiveType =
    | "text"
    | "shape"
    | "image"
    | "balloon"
    | "balloon-text"
    | "custom-element"
    | null;

type LayoutType = "horizontal" | "vertical" | "wave" | "spiral" | "circle" | "arc";

export default function EditorPage() {
    const canvasRef = useRef<fabricType.Canvas | null>(null);
    const fabricRef = useRef<any | null>(null);
    const canvasEl = useRef<HTMLCanvasElement | null>(null);
    const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);

    // === FIXED: reliable undo/redo stacks ===
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

    // NEW: Global text color state for custom elements
    const [globalTextColor, setGlobalTextColor] = useState("#000000");

    const isApplyingRef = useRef(false);

    const customElementGroups = useRef<
        Map<string, { type: LayoutType; params: any; timestamp: number }>
    >(new Map());

    // Fonts
    const fontFamilies = [
        "Arial",
        "Helvetica",
        "Times New Roman",
        "Courier New",
        "Georgia",
        "Verdana",
        "Impact",
        "Comic Sans MS",
        "Trebuchet MS",
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
        "900",
    ];

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
            // Ignore when typing in input fields
            if (
                e.target instanceof HTMLInputElement ||
                e.target instanceof HTMLTextAreaElement ||
                e.target instanceof HTMLSelectElement
            ) {
                return;
            }

            // Undo — Ctrl+Z
            if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
                e.preventDefault();
                undo();
            }

            // Redo — Ctrl+Shift+Z / Ctrl+Y
            if (
                (e.ctrlKey || e.metaKey) &&
                (e.key === "y" || (e.key === "z" && e.shiftKey))
            ) {
                e.preventDefault();
                redo();
            }

            // Delete
            if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                deleteSelected();
            }

            // Save — Ctrl+S
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                saveProject();
            }

            // =========================
            // LAYER SHORTCUTS
            // =========================

            // Bring Forward — Ctrl + ]
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "]") {
                e.preventDefault();
                bringForward();
            }

            // Send Backward — Ctrl + [
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "[") {
                e.preventDefault();
                sendBackwards();
            }

            // Bring To Front — Ctrl + Shift + ]
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "]") {
                e.preventDefault();
                bringToFront();
            }

            // Send To Back — Ctrl + Shift + [
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "[") {
                e.preventDefault();
                sendToBack();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, []);

    // ===================== FIXED: saveCurrentState =====================
    const saveCurrentState = () => {
        if (isApplyingRef.current) return;

        const c = canvasRef.current;
        if (!c) return;

        c.renderAll();
        const json = JSON.stringify(c.toJSON());

        undoStack.current.push(json);
        redoStack.current = [];

        localStorage.setItem("canvas_state", json);
        localStorage.setItem("canvas_state_ts", String(Date.now()));

        // Broadcast selection to other tabs
        try {
            const active = c.getActiveObject();
            let activeId: string | null = null;
            if (active) {
                if ((active as any).editableId) activeId = String((active as any).editableId);
                else if ((active as any).groupTimestamp)
                    activeId = String((active as any).groupTimestamp);
            }
            if (activeId) {
                localStorage.setItem("canvas_activeId", activeId);
                localStorage.setItem("canvas_activeId_ts", String(Date.now()));
            } else {
                localStorage.removeItem("canvas_activeId");
                localStorage.setItem("canvas_activeId_ts", String(Date.now()));
            }
        } catch (err) { }
    };

    // ===================== FIXED: applyJSON =====================
    type ApplyJSONOptions = {
        autoFit?: boolean;
        addToHistory?: boolean;
    };

    const applyJSON = (
        jsonString: string,
        { autoFit = false, addToHistory = false }: ApplyJSONOptions = {}
    ) => {
        const canvas = canvasRef.current;
        const fabric = fabricRef.current;
        if (!canvas || !fabric) return;

        try {
            isApplyingRef.current = true;
            canvas.clear();

            canvas.loadFromJSON(jsonString, () => {
                canvas.renderAll();

                // === Auto-fit logic preserved ===
                if (autoFit) {
                    const objects = canvas.getObjects();
                    if (objects.length > 0) {
                        const boundingRect = getBoundingRect(objects);
                        if (boundingRect) {
                            const scaleX =
                                (canvas.width ?? 1) / boundingRect.width;
                            const scaleY =
                                (canvas.height ?? 1) / boundingRect.height;
                            const scale = Math.min(scaleX, scaleY) * 0.9;

                            const group = new fabric.Group(objects);
                            group.scale(scale);
                            group.left =
                                ((canvas.width ?? 0) -
                                    boundingRect.width * scale) /
                                2;
                            group.top =
                                ((canvas.height ?? 0) -
                                    boundingRect.height * scale) /
                                2;

                            canvas.clear();
                            canvas.add(...group._objects);
                            group._restoreObjectsState();
                            canvas.remove(group);
                            canvas.renderAll();
                        }
                    }
                }

                // Small delay helps prevent race conditions
                setTimeout(() => {
                    canvas.renderAll();

                    // Always sync latest state to localStorage
                    localStorage.setItem("canvas_state", jsonString);
                    localStorage.setItem("canvas_state_ts", String(Date.now()));

                    // === CRITICAL: Only add to undo stack IF requested ===
                    if (addToHistory) {
                        const normalizedJson = JSON.stringify(canvas.toJSON());
                        undoStack.current.push(normalizedJson);
                        redoStack.current = [];
                    }

                    isApplyingRef.current = false;
                }, 50);
            });
        } catch (err) {
            console.error("❌ applyJSON error:", err);
            alert("Error loading JSON file. Make sure it's valid.");
            isApplyingRef.current = false;
        }
    };

    // Bounding box helper
    function getBoundingRect(objects: any[]) {
        if (!objects.length) return null;
        const minX = Math.min(...objects.map((o) => o.left ?? 0));
        const minY = Math.min(...objects.map((o) => o.top ?? 0));
        const maxX = Math.max(
            ...objects.map(
                (o) => (o.left ?? 0) + (o.width ?? 0) * (o.scaleX ?? 1)
            )
        );
        const maxY = Math.max(
            ...objects.map(
                (o) => (o.top ?? 0) + (o.height ?? 0) * (o.scaleY ?? 1)
            )
        );
        return {
            left: minX,
            top: minY,
            width: maxX - minX,
            height: maxY - minY,
        };
    }

    // ===================== LOAD JSON (fixed) =====================
    const loadJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const jsonString = reader.result as string;
            if (
                !confirm(
                    "Replace current design with this file? Unsaved changes will be lost."
                )
            ) {
                e.target.value = "";
                return;
            }

            applyJSON(jsonString, {
                autoFit: autoFitEnabled,
                addToHistory: true,
            });

            e.target.value = "";
        };
        reader.readAsText(file);
    };

    // ===================== FIXED: LOAD PROJECT =====================
    const loadProject = (project: Project) =>
        applyJSON(project.json, {
            autoFit: autoFitEnabled,
            addToHistory: true,
        });

    const deleteProject = (name: string) => {
        const updated = projects.filter((p) => p.name !== name);
        localStorage.setItem("projects", JSON.stringify(updated));
        setProjects(updated);
    };

    // ===================== STORAGE SYNC FIX =====================
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            try {
                // Update canvas from other tab
                if (e.key === "canvas_state" && e.newValue) {
                    if (isApplyingRef.current) return;
                    applyJSON(e.newValue, {
                        autoFit: false,
                        addToHistory: false,
                    });
                }

                // Update selection
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
                    const found = objs.find(
                        (o: any) =>
                            String(o.editableId || o.groupTimestamp || "") ===
                            String(activeId)
                    );

                    if (found) {
                        c.setActiveObject(found);
                        c.renderAll();
                        updateActiveObject();
                    }
                }
            } catch { }
        };

        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);

    // ===================== FIXED LAYER MANAGEMENT =====================
    const bringToFront = () => {
        const c = canvasRef.current;
        if (!c) return;
        const selected = c.getActiveObjects();
        if (!selected.length) return;

        const maxIndex = c.getObjects().length - 1;
        selected.forEach(o => {
            if (typeof (c as any).moveTo === 'function') (c as any).moveTo(o, maxIndex);
            else if (typeof (o as any).moveTo === 'function') (o as any).moveTo(maxIndex);
            else if (typeof (c as any).bringToFront === 'function') (c as any).bringToFront(o);
        });

        c.renderAll();
        saveCurrentState();
        updateActiveObject();
    };

    const sendToBack = () => {
        const c = canvasRef.current;
        if (!c) return;
        const selected = c.getActiveObjects();
        if (!selected.length) return;

        selected.slice().reverse().forEach(o => {
            if (typeof (c as any).moveTo === 'function') (c as any).moveTo(o, 0);
            else if (typeof (o as any).moveTo === 'function') (o as any).moveTo(0);
            else if (typeof (c as any).sendToBack === 'function') (c as any).sendToBack(o);
        });

        c.renderAll();
        saveCurrentState();
        updateActiveObject();
    };

    const bringForward = () => {
        const c = canvasRef.current;
        if (!c) return;
        const selected = c.getActiveObjects();
        if (!selected.length) return;

        const objs = c.getObjects();
        const ordered = selected
            .map(o => ({ o, i: objs.indexOf(o) }))
            .sort((a, b) => b.i - a.i);

        ordered.forEach(({ o, i }) => {
            const target = Math.min(objs.length - 1, i + 1);
            if (typeof (c as any).moveTo === 'function') (c as any).moveTo(o, target);
            else if (typeof (o as any).moveTo === 'function') (o as any).moveTo(target);
            else if (typeof (c as any).bringForward === 'function') (c as any).bringForward(o);
        });

        c.renderAll();
        saveCurrentState();
        updateActiveObject();
    };

    const sendBackwards = () => {
        const c = canvasRef.current;
        if (!c) return;
        const selected = c.getActiveObjects();
        if (!selected.length) return;

        const objs = c.getObjects();
        const ordered = selected
            .map(o => ({ o, i: objs.indexOf(o) }))
            .sort((a, b) => a.i - b.i);

        ordered.forEach(({ o, i }) => {
            const target = Math.max(0, i - 1);
            if (typeof (c as any).moveTo === 'function') (c as any).moveTo(o, target);
            else if (typeof (o as any).moveTo === 'function') (o as any).moveTo(target);
            else if (typeof (c as any).sendBackwards === 'function') (c as any).sendBackwards(o);
        });

        c.renderAll();
        saveCurrentState();
        updateActiveObject();
    };

    // ===================== INIT FABRIC (fixed history init) =====================
    useEffect(() => {
        let disposed = false;

        const initFabric = async () => {
            if (!canvasEl.current) {
                setTimeout(initFabric, 50);
                return;
            }
            if (canvasRef.current || disposed) return;

            const fabricModule = await import("fabric");
            const fabric =
                (fabricModule as any).fabric ||
                fabricModule.default ||
                fabricModule;
            fabricRef.current = fabric;

            // Extend Fabric object serialization
            fabric.Object.prototype.toObject = (function (toObject) {
                return function (propertiesToInclude: string[] = []) {
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
                        "rx",
                        "ry",
                        "fontFamily",
                        "fontWeight",
                        "fontStyle",
                        "textAlign",
                        "underline",
                        "linethrough",
                        "overline",
                        "clipPath",
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

            // === Hook into object changes for undo stack ===
            c.on("object:added", () => {
                if (!isApplyingRef.current) saveCurrentState();
            });
            c.on("object:modified", () => {
                if (!isApplyingRef.current) saveCurrentState();
            });
            c.on("object:removed", () => {
                if (!isApplyingRef.current) saveCurrentState();
            });

            // Selection events
            c.on("selection:created", () => {
                updateActiveObject();
                broadcastSelection();
            });
            c.on("selection:updated", () => {
                updateActiveObject();
                broadcastSelection();
            });
            c.on("selection:cleared", () => {
                setActiveType(null);
                setActiveAttrs({});
            });

            c.on("object:modified", updateActiveObject);

            // === Load initial state ===
            const saved = localStorage.getItem("canvas_state");

            if (saved) {
                applyJSON(saved, { autoFit: false, addToHistory: true });
            } else {
                const json = JSON.stringify(c.toJSON());
                undoStack.current.push(json);
                localStorage.setItem("canvas_state", json);
                localStorage.setItem("canvas_state_ts", String(Date.now()));
            }

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
            setProjects(JSON.parse(list));
        } catch {
            setProjects([]);
        }
    };

    const saveProject = () => {
        const name = prompt("Enter project name:")?.trim();
        if (!name) return;

        const c = canvasRef.current;
        if (!c) return;

        const json = JSON.stringify(c.toJSON());
        const thumbnail = c.toDataURL({
            format: "png",
            quality: 0.6,
            multiplier: 1,
        });

        const project: Project = {
            name,
            thumbnail,
            json,
            updatedAt: Date.now(),
        };

        const updated = [
            ...projects.filter((p) => p.name !== name),
            project,
        ];

        localStorage.setItem("projects", JSON.stringify(updated));
        setProjects(updated);
        console.log("💾 Saved project:", name);
    };

    // ===================== CUSTOM ELEMENT CREATION =====================
    const handleElementUpload = (
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setCustomElement(file);

        const reader = new FileReader();
        reader.onload = () => {
            setElementPreview(reader.result as string);
        };
        reader.readAsDataURL(file);
    };

    const createCustomElementWithText = (
        letter: string,
        index: number,
        total: number
    ) => {
        const fabric = fabricRef.current;
        if (!fabric || !canvasRef.current || !elementPreview) return;

        const containerSize = elementSize;
        const canvasWidth = canvasRef.current.width || 1000;
        const canvasHeight = canvasRef.current.height || 600;

        let x = 0;
        let y = 0;

        // Keep your original layout logic unchanged
        switch (selectedLayout) {
            case "horizontal":
                const hSpace = containerSize + 20;
                const hTotal = (total - 1) * hSpace;
                x = (canvasWidth - hTotal) / 2 + index * hSpace;
                y = canvasHeight / 2;
                break;

            case "vertical":
                const vSpace = containerSize + 20;
                const vTotal = (total - 1) * vSpace;
                x = canvasWidth / 2;
                y = (canvasHeight - vTotal) / 2 + index * vSpace;
                break;

            case "wave":
                const waveSpace = containerSize + 15;
                const waveTotal = (total - 1) * waveSpace;
                x = (canvasWidth - waveTotal) / 2 + index * waveSpace;
                y =
                    canvasHeight / 2 +
                    Math.sin(index * 0.8) * layoutParams.waveAmplitude;
                break;

            case "spiral":
                const sprRadius =
                    10 + index * layoutParams.spiralTightness;
                const sprAngle = index * 0.8;
                x =
                    canvasWidth / 2 +
                    Math.cos(sprAngle) * sprRadius;
                y =
                    canvasHeight / 2 +
                    Math.sin(sprAngle) * sprRadius;
                break;

            case "circle":
                const circleRadius = Math.min(
                    layoutParams.circleRadius,
                    total * 20
                );
                const angle = (index / total) * Math.PI * 2;
                x =
                    canvasWidth / 2 + Math.cos(angle) * circleRadius;
                y =
                    canvasHeight / 2 + Math.sin(angle) * circleRadius;
                break;

            case "arc":
                const arcRadius = Math.min(
                    layoutParams.arcRadius,
                    total * 25
                );
                const arcAngle =
                    Math.PI / 2 + (index / (total - 1 || 1)) * Math.PI;
                x =
                    canvasWidth / 2 + Math.cos(arcAngle) * arcRadius;
                y =
                    canvasHeight / 2 + Math.sin(arcAngle) * arcRadius;
                break;

            default:
                const dSpace = containerSize + 20;
                const dTotal = (total - 1) * dSpace;
                x = (canvasWidth - dTotal) / 2 + index * dSpace;
                y = canvasHeight / 2;
        }

        const imgEl = new Image();
        imgEl.onload = () => {
            const fabric = fabricRef.current;
            const c = canvasRef.current;
            if (!fabric || !c) return;

            const scaleX = containerSize / imgEl.width;
            const scaleY = containerSize / imgEl.height;
            const scale = Math.min(scaleX, scaleY);

            const elementImg = new fabric.Image(imgEl, {
                left: 0,
                top: 0,
                originX: "center",
                originY: "center",
                scaleX: scale,
                scaleY: scale,
                selectable: false,
                evented: false,
            });

            const backgroundRect = new fabric.Rect({
                width: containerSize,
                height: containerSize,
                left: 0,
                top: 0,
                originX: "center",
                originY: "center",
                fill: "transparent",
                stroke: "transparent",
                selectable: false,
                evented: false,
            });

            const fontSize = Math.max(16, containerSize * 0.3);

            // FIXED: Use globalTextColor instead of hardcoded color
            const elementText = new fabric.Text(letter, {
                fontSize,
                fill: globalTextColor, // Use global text color
                fontFamily: "Arial",
                fontWeight: "bold",
                left: 0,
                top: 0,
                originX: "center",
                originY: "center",
                selectable: false,
                evented: false,
            });

            const groupTimestamp = Date.now();

            const elementGroup = new fabric.Group(
                [backgroundRect, elementImg, elementText],
                {
                    left: x,
                    top: y,
                    editableId: `custom_element_${groupTimestamp}_${index}`,
                    isLocked: false,
                    letter,
                    elementColor: "transparent",
                    textColor: globalTextColor, // Store the text color
                    selectable: true,
                    evented: true,
                    width: containerSize,
                    height: containerSize,
                    layoutType: selectedLayout,
                    layoutParams: layoutParams,
                    elementSize: containerSize,
                    groupTimestamp,
                }
            );

            c.add(elementGroup);
            c.renderAll();

            customElementGroups.current.set(
                `group_${groupTimestamp}`,
                {
                    type: selectedLayout,
                    params: layoutParams,
                    timestamp: groupTimestamp,
                }
            );
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
        const letters = name.split("");

        letters.forEach((letter, index) => {
            createCustomElementWithText(letter, index, letters.length);
        });

        setElementName("");
    };

    const addSingleElement = () => {
        if (!fabricRef.current || !canvasRef.current || !elementPreview) return;
        const fabric = fabricRef.current;

        const imgEl = new Image();
        imgEl.onload = () => {
            const c = canvasRef.current;
            if (!c) return;

            const containerSize = elementSize;
            const scaleX = containerSize / imgEl.width;
            const scaleY = containerSize / imgEl.height;
            const scale = Math.min(scaleX, scaleY);

            const elementImg = new fabric.Image(imgEl, {
                left: 0,
                top: 0,
                originX: "center",
                originY: "center",
                scaleX: scale,
                scaleY: scale,
                selectable: false,
                evented: false,
            });

            const backgroundRect = new fabric.Rect({
                width: containerSize,
                height: containerSize,
                left: 0,
                top: 0,
                originX: "center",
                originY: "center",
                fill: "transparent",
                stroke: "transparent",
                selectable: false,
                evented: false,
            });

            const groupTimestamp = Date.now();

            const elementGroup = new fabric.Group(
                [backgroundRect, elementImg],
                {
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
                    groupTimestamp,
                }
            );

            c.add(elementGroup);
            c.renderAll();
        };

        imgEl.src = elementPreview;
    };

    const clearElementUpload = () => {
        setCustomElement(null);
        setElementPreview("");
        setElementName("");
    };

    // ===================== NEW: UPDATE ALL CUSTOM ELEMENTS TEXT COLOR =====================
    const updateAllCustomElementsTextColor = (color: string) => {
        const c = canvasRef.current;
        if (!c) return;

        const objects = c.getObjects();
        let updated = false;

        objects.forEach((obj: any) => {
            if (obj.type === "group" && obj.editableId?.includes("custom_element")) {
                const children = obj.getObjects();
                const textObj = children.find((o: any) => o.type === "text" || o.type === "i-text");

                if (textObj) {
                    textObj.set("fill", color);
                    obj.textColor = color; // Update group's textColor property
                    updated = true;
                }
            }
        });

        if (updated) {
            c.renderAll();
            saveCurrentState();
            // Update active object if it's a custom element
            if (activeType === "custom-element") {
                updateActiveObject();
            }
        }
    };

    // ===================== BASIC TOOLS =====================
    const addShape = (type: "rect" | "circle" | "triangle") => {
        if (!fabricRef.current || !canvasRef.current) return;
        const fabric = fabricRef.current;

        let shape: any;

        if (type === "rect") {
            shape = new fabric.Rect({
                left: 100,
                top: 100,
                width: 120,
                height: 80,
                fill: "#38bdf8",
                stroke: "#000000",
                strokeWidth: 0,
                rx: 0,
                ry: 0,
                editableId: `shape_${Date.now()}`,
                isLocked: false,
            });
        } else if (type === "circle") {
            shape = new fabric.Circle({
                left: 150,
                top: 150,
                radius: 50,
                fill: "#a3e635",
                stroke: "#000000",
                strokeWidth: 0,
                editableId: `shape_${Date.now()}`,
                isLocked: false,
            });
        } else {
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
            });
        }

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
            editableId: `text_${Date.now()}`,
            isLocked: false,
        });

        canvasRef.current.add(text);
    };

    // ===================== IMAGE UPLOAD WITH RADIUS =====================
    const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const imgEl = new Image();
            imgEl.onload = () => {
                const fabric = fabricRef.current;
                const c = canvasRef.current;
                if (!fabric || !c) return;

                // Create the image
                const img = new fabric.Image(imgEl, {
                    left: 0,
                    top: 0,
                    originX: "left",
                    originY: "top",
                    selectable: true,
                    evented: true,
                });

                // Create a rounded rectangle for clipping
                const clipRect = new fabric.Rect({
                    left: 0,
                    top: 0,
                    width: imgEl.width,
                    height: imgEl.height,
                    rx: 0, // Initial border radius
                    ry: 0, // Initial border radius
                    fill: 'transparent',
                    selectable: false,
                    evented: false,
                });

                // Create the group with proper clipPath
                const group = new fabric.Group([img], {
                    left: 100,
                    top: 100,
                    editableId: `image_${Date.now()}`,
                    isLocked: false,
                    // Store border radius directly on the group for easy access
                    rx: 0,
                    ry: 0,
                    clipPath: clipRect,
                });

                c.add(group);
                c.renderAll();
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

        const newLock = !(obj as any).isLocked;

        obj.set({
            isLocked: newLock,
            selectable: !newLock,
            evented: !newLock,
            lockMovementX: newLock,
            lockMovementY: newLock,
            lockRotation: newLock,
            lockScalingX: newLock,
            lockScalingY: newLock,
            opacity: newLock ? 0.6 : 1,
        });

        canvasRef.current?.renderAll();
        saveCurrentState();
        updateActiveObject();
    };

    // ===================== FIXED UNDO/REDO =====================
    const undo = () => {
        if (undoStack.current.length <= 1) return;

        const current = undoStack.current.pop()!;
        redoStack.current.push(current);

        const prev = undoStack.current[undoStack.current.length - 1];
        if (prev) {
            applyJSON(prev, {
                autoFit: false,
                addToHistory: false,
            });
        }
    };

    const redo = () => {
        if (redoStack.current.length === 0) return;

        const next = redoStack.current.pop()!;
        undoStack.current.push(next);

        applyJSON(next, {
            autoFit: false,
            addToHistory: false,
        });
    };

    // ===================== FIXED updateActiveObject =====================
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
            if ((obj as any).editableId?.includes("custom_element")) {
                type = "custom-element";
            } else if ((obj as any).editableId?.includes("image_")) {
                type = "image";
            }
        }

        setActiveType(type);

        const attrs: any = {
            ...obj.toObject(),
            type: obj.type,
            isLocked: (obj as any).isLocked,
            selectable: obj.selectable,
            evented: obj.evented,
            opacity: obj.opacity,
            fill: (obj as any).fill,
            stroke: (obj as any).stroke,
            strokeWidth: (obj as any).strokeWidth,
            fontSize: (obj as any).fontSize,
            fontFamily: (obj as any).fontFamily,
            fontWeight: (obj as any).fontWeight,
            fontStyle: (obj as any).fontStyle,
            textAlign: (obj as any).textAlign,
            underline: (obj as any).underline,
            linethrough: (obj as any).linethrough,
            rx: (obj as any).rx,
            ry: (obj as any).ry,
            letter: (obj as any).letter,
            textColor: (obj as any).textColor,
            elementColor: (obj as any).elementColor,
            layoutType: (obj as any).layoutType,
            editableId: (obj as any).editableId,
        };

        // === FIXED: get correct values from group children ===
        if (type === "custom-element" && obj.type === "group") {
            const group = obj as any;
            const children = group.getObjects();

            const rectObj = children.find((o: any) => o.type === "rect");
            const textObj = children.find(
                (o: any) => o.type === "text" || o.type === "i-text"
            );

            if (rectObj) {
                attrs.elementColor =
                    group.elementColor ?? rectObj.fill ?? "transparent";
            }

            if (textObj) {
                attrs.textColor =
                    group.textColor ?? textObj.fill ?? "#000000";
                attrs.letter = group.letter ?? textObj.text ?? "";
                attrs.fontFamily =
                    textObj.fontFamily ?? attrs.fontFamily;
                attrs.fontSize = textObj.fontSize ?? attrs.fontSize;
                attrs.fontWeight =
                    textObj.fontWeight ?? attrs.fontWeight;
                attrs.fontStyle = textObj.fontStyle ?? attrs.fontStyle;
                attrs.textAlign =
                    textObj.textAlign ?? attrs.textAlign;
                attrs.underline =
                    textObj.underline ?? attrs.underline;
                attrs.linethrough =
                    textObj.linethrough ?? attrs.linethrough;
            }
        }

        // For uploaded image groups, read rx/ry from the group itself or its clipPath
        if (type === "image" && obj.type === "group" && (obj as any).editableId?.includes("image_")) {
            const group = obj as any;

            // Priority 1: Group properties
            attrs.rx = group.rx ?? 0;
            attrs.ry = group.ry ?? 0;

            // Priority 2: ClipPath properties (if group properties are 0)
            if ((attrs.rx === 0 || attrs.ry === 0) && group.clipPath) {
                attrs.rx = group.clipPath.rx ?? attrs.rx;
                attrs.ry = group.clipPath.ry ?? attrs.ry;

                // Also update group properties to match clipPath for consistency
                if (attrs.rx > 0 || attrs.ry > 0) {
                    group.set({
                        rx: attrs.rx,
                        ry: attrs.ry
                    });
                }
            }
        }

        setActiveAttrs(attrs);
    };

    // ===================== FIXED updateAttr =====================
    const updateAttr = (attr: string, value: any) => {
        const obj = canvasRef.current?.getActiveObject();
        const fabric = fabricRef.current;
        if (!obj || !fabric) return;

        // ===== Border radius handling (rect + image-group) =====
        if (attr === "rx" || attr === "ry") {
            // Image group with clipPath
            if (obj.type === "group" && (obj as any).editableId?.includes("image_")) {
                const grp = obj as any;

                // Update both the group properties AND the clipPath
                grp.set(attr, value);

                if (grp.clipPath) {
                    grp.clipPath.set({
                        rx: attr === "rx" ? value : (grp.rx || 0),
                        ry: attr === "ry" ? value : (grp.ry || 0),
                    });
                    if (typeof grp.clipPath.setCoords === "function") grp.clipPath.setCoords();
                }

                // Force re-render
                forceClipPathUpdate(grp);
            }

            // Rectangles sync rx and ry
            else if (obj.type === "rect" && attr === "rx") {
                obj.set("rx", value);
                obj.set("ry", value);
            }

            // Regular objects
            else {
                obj.set(attr, value);
            }

            canvasRef.current?.renderAll();
            saveCurrentState();
            setTimeout(updateActiveObject, 0);
            return; // Important: return early to prevent double execution
        }

        // ===== Custom elements (text + image + rect group) =====
        else if (obj.type === "group" && (obj as any).editableId?.includes("custom_element")) {
            const group = obj as any;
            const children = group.getObjects();
            const rectObj = children.find((o: any) => o.type === "rect");
            const textObj = children.find((o: any) => o.type === "text" || o.type === "i-text");

            if (["fontSize", "fontFamily", "fontWeight", "fontStyle", "textAlign", "underline", "linethrough"].includes(attr)) {
                if (textObj) textObj.set(attr, value);
            } else if (attr === "textColor") {
                if (textObj) textObj.set("fill", value);
                group.textColor = value;

                // Also update global text color for consistency
                setGlobalTextColor(value);
            } else if (attr === "elementColor") {
                if (rectObj) rectObj.set("fill", value);
                group.elementColor = value;
            } else if (attr === "letter") {
                if (textObj) textObj.set("text", value);
                group.letter = value;
            } else {
                group.set(attr, value);
            }
        }

        // ===== Normal objects =====
        else {
            obj.set(attr, value);
        }

        canvasRef.current?.renderAll();
        saveCurrentState();
        setTimeout(updateActiveObject, 0);
    };

    // ===================== Helpers =====================
    const broadcastSelection = () => {
        const c = canvasRef.current;
        if (!c) return;

        try {
            const active = c.getActiveObject();
            let activeId: string | null = null;

            if (active) {
                if ((active as any).editableId)
                    activeId = String((active as any).editableId);
                else if ((active as any).groupTimestamp)
                    activeId = String((active as any).groupTimestamp);
            }

            if (activeId) {
                localStorage.setItem("canvas_activeId", activeId);
                localStorage.setItem("canvas_activeId_ts", String(Date.now()));
            } else {
                localStorage.removeItem("canvas_activeId");
                localStorage.setItem("canvas_activeId_ts", String(Date.now()));
            }
        } catch { }
    };

    const forceClipPathUpdate = (group: any) => {
        if (!group || !group.clipPath) return;

        // Force the clipPath to update by temporarily removing and re-adding
        const currentClip = group.clipPath;
        group.clipPath = undefined;
        group.clipPath = currentClip;
        group.dirty = true;

        // Also mark the group as dirty to ensure re-render
        if (typeof group.set === 'function') {
            group.set('dirty', true);
        }
    };

    // ===================== UI RENDER =====================
    return (
        <div className="flex h-screen bg-gray-100">
            {/* ===== LEFT TOOLS ===== */}
            <div className="flex flex-col w-[220px] gap-2 bg-white shadow p-3 border-b overflow-y-scroll">
                <div className="text-xs text-gray-500 mb-2">
                    Shortcuts: Ctrl+Z (Undo), Ctrl+Y (Redo), Delete, Ctrl+S (Save)
                    <br />
                    Layers: Ctrl+Shift+] (Front), Ctrl+Shift+[ (Back)
                </div>

                <h3 className="font-semibold mb-2">Custom Elements</h3>

                {/* Element Upload */}
                <div className="space-y-2 mb-2">
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-3 text-center">
                        {elementPreview ? (
                            <div className="space-y-2">
                                <div className="relative w-16 h-16 mx-auto">
                                    <img
                                        src={elementPreview}
                                        alt="Uploaded"
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

                    {/* Text Color - FIXED: Now applies to all custom elements */}
                    <div>
                        <label className="text-xs block mb-1">Text Color</label>
                        <input
                            type="color"
                            value={globalTextColor}
                            onChange={(e) => {
                                const newColor = e.target.value;
                                setGlobalTextColor(newColor);
                                updateAllCustomElementsTextColor(newColor);
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

                    {/* Layout Buttons */}
                    <div className="mt-2">
                        <label className="text-xs block mb-2 font-medium">Layout</label>
                        <div className="grid grid-cols-3 gap-2">
                            {layoutOptions.map((layout) => (
                                <button
                                    key={layout.value}
                                    onClick={() => setSelectedLayout(layout.value as LayoutType)}
                                    className={`p-2 border rounded text-xs flex flex-col items-center justify-center transition-all ${selectedLayout === layout.value
                                        ? "bg-purple-600 text-white border-purple-600"
                                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                                        }`}
                                >
                                    <span className="text-lg mb-1">{layout.icon}</span>
                                    <span>{layout.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Layout Descriptions */}
                    <div className="mt-1 text-xs text-gray-500 text-center">
                        {selectedLayout === "horizontal" && "Letters in a straight horizontal line"}
                        {selectedLayout === "vertical" && "Letters in a vertical line"}
                        {selectedLayout === "wave" && "Letters in a wave pattern"}
                        {selectedLayout === "spiral" && "Letters in a spiral"}
                        {selectedLayout === "circle" && "Letters in a circle"}
                        {selectedLayout === "arc" && "Letters in a semi-circle"}
                    </div>

                    {/* Layout Sliders */}
                    {selectedLayout === "wave" && (
                        <div className="mt-2">
                            <label className="text-xs block mb-1">
                                Wave Height: {layoutParams.waveAmplitude}px
                            </label>
                            <input
                                type="range"
                                min="20"
                                max="100"
                                value={layoutParams.waveAmplitude}
                                onChange={(e) =>
                                    setLayoutParams((p) => ({
                                        ...p,
                                        waveAmplitude: parseInt(e.target.value),
                                    }))
                                }
                                className="w-full"
                            />
                        </div>
                    )}

                    {selectedLayout === "spiral" && (
                        <div className="mt-2">
                            <label className="text-xs block mb-1">
                                Spiral Tightness: {layoutParams.spiralTightness}
                            </label>
                            <input
                                type="range"
                                min="5"
                                max="30"
                                value={layoutParams.spiralTightness}
                                onChange={(e) =>
                                    setLayoutParams((p) => ({
                                        ...p,
                                        spiralTightness: parseInt(e.target.value),
                                    }))
                                }
                                className="w-full"
                            />
                        </div>
                    )}

                    {selectedLayout === "circle" && (
                        <div className="mt-2">
                            <label className="text-xs block mb-1">
                                Circle Radius: {layoutParams.circleRadius}px
                            </label>
                            <input
                                type="range"
                                min="50"
                                max="300"
                                value={layoutParams.circleRadius}
                                onChange={(e) =>
                                    setLayoutParams((p) => ({
                                        ...p,
                                        circleRadius: parseInt(e.target.value),
                                    }))
                                }
                                className="w-full"
                            />
                        </div>
                    )}

                    {selectedLayout === "arc" && (
                        <div className="mt-2">
                            <label className="text-xs block mb-1">
                                Arc Radius: {layoutParams.arcRadius}px
                            </label>
                            <input
                                type="range"
                                min="50"
                                max="300"
                                value={layoutParams.arcRadius}
                                onChange={(e) =>
                                    setLayoutParams((p) => ({
                                        ...p,
                                        arcRadius: parseInt(e.target.value),
                                    }))
                                }
                                className="w-full"
                            />
                        </div>
                    )}

                    {/* Action Buttons */}
                    <Button
                        size="lg"
                        onClick={addElementName}
                        className="w-full bg-purple-600 hover:bg-purple-700"
                        disabled={!elementPreview}
                    >
                        Create Name Elements
                    </Button>

                    <Button
                        size="lg"
                        onClick={addSingleElement}
                        disabled={!elementPreview}
                        variant="outline"
                    >
                        Single Element
                    </Button>
                </div>

                <h3 className="font-semibold mt-4 mb-2">Shapes</h3>
                <Button size="lg" onClick={() => addShape("rect")}>
                    Rectangle
                </Button>
                <Button size="lg" onClick={() => addShape("circle")}>
                    Circle
                </Button>
                <Button size="lg" onClick={() => addShape("triangle")}>
                    Triangle
                </Button>

                <h3 className="font-semibold mt-4 mb-2">Text & Media</h3>
                <Button size="lg" onClick={addText}>
                    Text
                </Button>
                <label className="text-center py-2 cursor-pointer bg-blue-500 text-white px-3 rounded-md">
                    Upload Image
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleUpload}
                    />
                </label>

                <h3 className="font-semibold mt-4 mb-2">Layer Management</h3>
                <Button size="lg" onClick={bringToFront} variant="outline">
                    Bring to Front
                </Button>
                <Button size="lg" onClick={sendToBack} variant="outline">
                    Send to Back
                </Button>
                <Button size="lg" onClick={bringForward} variant="outline">
                    Bring Forward
                </Button>
                <Button size="lg" onClick={sendBackwards} variant="outline">
                    Send Backward
                </Button>

                <h3 className="font-semibold mt-4 mb-2">Tools</h3>
                <Button size="lg" variant="destructive" onClick={deleteSelected}>
                    Delete
                </Button>
                <Button size="lg" onClick={undo}>
                    Undo
                </Button>
                <Button size="lg" onClick={redo}>
                    Redo
                </Button>
                <Button size="lg" variant="outline" onClick={toggleLock}>
                    {activeAttrs.isLocked ? "Unlock" : "Lock"}
                </Button>

                <h3 className="font-semibold mt-4 mb-2">Export</h3>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size="lg" variant="outline">
                            Export
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        <DropdownMenuLabel>
                            <Button
                                size="lg"
                                variant="outline"
                                onClick={() => {
                                    const link = document.createElement("a");
                                    link.href =
                                        canvasRef.current?.toDataURL({
                                            format: "png",
                                        }) ?? "";
                                    link.download = "canvas.png";
                                    link.click();
                                }}
                            >
                                PNG
                            </Button>
                        </DropdownMenuLabel>

                        <DropdownMenuLabel>
                            <Button
                                size="lg"
                                variant="outline"
                                onClick={() => {
                                    const pdf = new jsPDF("l", "pt", "a4");
                                    const img =
                                        canvasRef.current?.toDataURL({
                                            format: "png",
                                        });
                                    if (img) {
                                        pdf.addImage(img, "PNG", 0, 0, 800, 600);
                                        pdf.save("canvas.pdf");
                                    }
                                }}
                            >
                                PDF
                            </Button>
                        </DropdownMenuLabel>

                        <DropdownMenuSeparator />

                        <DropdownMenuLabel>
                            <Button
                                size="lg"
                                variant="outline"
                                onClick={() => {
                                    const json = JSON.stringify(
                                        canvasRef.current?.toJSON()
                                    );
                                    const blob = new Blob([json], {
                                        type: "application/json",
                                    });
                                    const link = document.createElement("a");
                                    link.href = URL.createObjectURL(blob);
                                    link.download = "project.json";
                                    link.click();
                                }}
                            >
                                JSON
                            </Button>
                        </DropdownMenuLabel>
                    </DropdownMenuContent>
                </DropdownMenu>

                <label className="cursor-pointer border rounded-md px-3 py-2 mt-2 text-center">
                    Load JSON
                    <input
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={loadJSON}
                    />
                </label>

                <label className="flex items-center gap-2 mt-4 text-sm">
                    <input
                        type="checkbox"
                        checked={autoFitEnabled}
                        onChange={(e) => setAutoFitEnabled(e.target.checked)}
                    />
                    Auto-Fit on Load
                </label>
            </div>

            {/* MAIN CANVAS */}
            <div className="flex flex-col flex-1">
                <div className="flex justify-center items-center flex-1 overflow-auto">
                    <canvas
                        ref={canvasEl}
                        className="border shadow-lg rounded-lg"
                    />
                </div>
            </div>

            {/* RIGHT SIDEBAR */}
            <aside className="w-80 bg-white border-r shadow-md flex flex-col">
                <div className="p-3 border-b flex justify-between items-center">
                    <h2 className="font-semibold text-lg">Projects</h2>
                    <Button size="sm" onClick={saveProject}>
                        Save
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {projects.length === 0 && (
                        <div className="text-gray-500 text-sm p-4">
                            No projects yet
                        </div>
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
                                    {new Date(
                                        project.updatedAt
                                    ).toLocaleString()}
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

                            {/* Opacity */}
                            <div>
                                <label className="text-sm font-medium">Opacity</label>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={activeAttrs.opacity || 1}
                                    onChange={(e) =>
                                        updateAttr(
                                            "opacity",
                                            parseFloat(e.target.value)
                                        )
                                    }
                                    className="w-full"
                                />
                                <div className="text-xs text-gray-500 text-right">
                                    {Math.round((activeAttrs.opacity || 1) * 100)}%
                                </div>
                            </div>

                            {/* TEXT & CUSTOM ELEMENT TEXT PROPS */}
                            {(activeType === "text" ||
                                activeType === "custom-element") && (
                                    <>
                                        <div>
                                            <label className="text-sm font-medium">
                                                Font Family
                                            </label>
                                            <select
                                                value={activeAttrs.fontFamily || "Arial"}
                                                onChange={(e) =>
                                                    updateAttr(
                                                        "fontFamily",
                                                        e.target.value
                                                    )
                                                }
                                                className="w-full border border-gray-300 rounded p-2 text-sm"
                                            >
                                                {fontFamilies.map((f) => (
                                                    <option key={f} value={f}>
                                                        {f}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="text-sm font-medium">
                                                Font Size
                                            </label>
                                            <input
                                                type="number"
                                                value={activeAttrs.fontSize || 24}
                                                onChange={(e) =>
                                                    updateAttr(
                                                        "fontSize",
                                                        parseInt(e.target.value)
                                                    )
                                                }
                                                className="w-full border border-gray-300 rounded p-2 text-sm"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-sm font-medium">
                                                Font Weight
                                            </label>
                                            <select
                                                value={
                                                    activeAttrs.fontWeight || "normal"
                                                }
                                                onChange={(e) =>
                                                    updateAttr(
                                                        "fontWeight",
                                                        e.target.value
                                                    )
                                                }
                                                className="w-full border border-gray-300 rounded p-2 text-sm"
                                            >
                                                {fontWeights.map((w) => (
                                                    <option key={w} value={w}>
                                                        {w}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="text-sm font-medium">
                                                Font Style
                                            </label>
                                            <select
                                                value={
                                                    activeAttrs.fontStyle || "normal"
                                                }
                                                onChange={(e) =>
                                                    updateAttr(
                                                        "fontStyle",
                                                        e.target.value
                                                    )
                                                }
                                                className="w-full border border-gray-300 rounded p-2 text-sm"
                                            >
                                                <option value="normal">Normal</option>
                                                <option value="italic">Italic</option>
                                                <option value="oblique">Oblique</option>
                                            </select>
                                        </div>

                                        <div>
                                            <label className="text-sm font-medium">
                                                Text Align
                                            </label>
                                            <select
                                                value={
                                                    activeAttrs.textAlign || "left"
                                                }
                                                onChange={(e) =>
                                                    updateAttr(
                                                        "textAlign",
                                                        e.target.value
                                                    )
                                                }
                                                className="w-full border border-gray-300 rounded p-2 text-sm"
                                            >
                                                <option value="left">Left</option>
                                                <option value="center">Center</option>
                                                <option value="right">Right</option>
                                                <option value="justify">
                                                    Justify
                                                </option>
                                            </select>
                                        </div>

                                        <div className="flex gap-2">
                                            <label className="flex items-center gap-1 text-sm">
                                                <input
                                                    type="checkbox"
                                                    checked={
                                                        activeAttrs.underline || false
                                                    }
                                                    onChange={(e) =>
                                                        updateAttr(
                                                            "underline",
                                                            e.target.checked
                                                        )
                                                    }
                                                />
                                                Underline
                                            </label>

                                            <label className="flex items-center gap-1 text-sm">
                                                <input
                                                    type="checkbox"
                                                    checked={
                                                        activeAttrs.linethrough ||
                                                        false
                                                    }
                                                    onChange={(e) =>
                                                        updateAttr(
                                                            "linethrough",
                                                            e.target.checked
                                                        )
                                                    }
                                                />
                                                Strikethrough
                                            </label>
                                        </div>
                                    </>
                                )}

                            {/* FILL COLOR */}
                            <div>
                                <label className="text-sm font-medium">
                                    {activeType === "text"
                                        ? "Text Color"
                                        : activeType === "custom-element"
                                            ? "Element Color"
                                            : "Fill Color"}
                                </label>

                                <input
                                    type="color"
                                    value={
                                        activeAttrs.fill ||
                                        activeAttrs.elementColor ||
                                        "#000000"
                                    }
                                    onChange={(e) => {
                                        if (activeType === "custom-element") {
                                            updateAttr(
                                                "elementColor",
                                                e.target.value
                                            );
                                        } else {
                                            updateAttr("fill", e.target.value);
                                        }
                                    }}
                                    className="w-full h-10 border rounded"
                                />
                            </div>

                            {/* CUSTOM ELEMENT EXTRA FIELDS */}
                            {activeType === "custom-element" && (
                                <>
                                    <div>
                                        <label className="text-sm font-medium">
                                            Letter
                                        </label>
                                        <input
                                            type="text"
                                            value={activeAttrs.letter || ""}
                                            onChange={(e) =>
                                                updateAttr(
                                                    "letter",
                                                    e.target.value
                                                        .charAt(0)
                                                        .toUpperCase()
                                                )
                                            }
                                            maxLength={1}
                                            className="w-full border border-gray-300 rounded p-2 text-sm"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-sm font-medium">
                                            Text Color
                                        </label>
                                        <input
                                            type="color"
                                            value={activeAttrs.textColor || "#000"}
                                            onChange={(e) =>
                                                updateAttr(
                                                    "textColor",
                                                    e.target.value
                                                )
                                            }
                                            className="w-full h-10 border rounded"
                                        />
                                    </div>
                                </>
                            )}

                            {/* BORDER PROPERTIES */}
                            {(activeType === "shape" || activeType === "image") && (
                                <>
                                    <div>
                                        <label className="text-sm font-medium">
                                            Border Color
                                        </label>
                                        <input
                                            type="color"
                                            value={activeAttrs.stroke || "#000000"}
                                            onChange={(e) =>
                                                updateAttr(
                                                    "stroke",
                                                    e.target.value
                                                )
                                            }
                                            className="w-full h-10 border rounded"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-sm font-medium">
                                            Border Width
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            max="20"
                                            value={activeAttrs.strokeWidth || 0}
                                            onChange={(e) =>
                                                updateAttr(
                                                    "strokeWidth",
                                                    parseInt(e.target.value)
                                                )
                                            }
                                            className="w-full border border-gray-300 rounded p-2 text-sm"
                                        />
                                    </div>

                                    {(activeType === "shape" && activeAttrs.type === "rect") || activeType === "image" ? (
                                        <div>
                                            <label className="text-sm font-medium">
                                                Border Radius
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                max="100"
                                                value={activeAttrs.rx || 0}
                                                onChange={(e) => {
                                                    const radius = parseInt(e.target.value);
                                                    updateAttr("rx", radius);

                                                    // For rectangles, sync ry automatically
                                                    if (activeType === "shape" && activeAttrs.type === "rect") {
                                                        updateAttr("ry", radius);
                                                    }
                                                }}
                                                className="w-full border border-gray-300 rounded p-2 text-sm"
                                            />
                                        </div>
                                    ) : null}
                                </>
                            )}

                            {/* STATUS */}
                            <div className="text-sm pt-2 border-t">
                                <span className="font-medium">Status: </span>
                                <span
                                    className={
                                        activeAttrs.isLocked
                                            ? "text-orange-500"
                                            : "text-green-500"
                                    }
                                >
                                    {activeAttrs.isLocked
                                        ? "Locked"
                                        : "Editable"}
                                </span>
                            </div>

                            {/* OBJECT INFO */}
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