"use client";

import { useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { Button } from "@/components/ui/button";
import type * as fabricType from "fabric";
import Image from "next/image";

interface Project {
    name: string;
    thumbnail: string;
    json: string;
    updatedAt: number;
}

export default function EditorPage() {
    const canvasRef = useRef<fabricType.Canvas | null>(null);
    const fabricRef = useRef<any | null>(null);
    const canvasEl = useRef<HTMLCanvasElement | null>(null);

    const undoStack = useRef<string[]>([]);
    const redoStack = useRef<string[]>([]);
    const [isReady, setIsReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);
    const isApplyingRef = useRef(false);
    const handlersRef = useRef<{ undo: () => void; redo: () => void; deleteSelected: () => void }>({
        undo: () => { },
        redo: () => { },
        deleteSelected: () => { },
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
                setTimeout(initFabric, 100);
                return;
            }
            if (canvasRef.current || disposed) return;

            const fabricModule = await import("fabric");
            const fabric = (fabricModule as any).fabric || fabricModule.default || fabricModule;
            fabricRef.current = fabric;

            const c = new fabric.Canvas(canvasEl.current, {
                width: 1000,
                height: 600,
                backgroundColor: "#fff",
                selection: true,
            });
            canvasRef.current = c;

            c.on("object:added", () => { if (!isApplyingRef.current) saveCurrentState(); });
            c.on("object:modified", () => { if (!isApplyingRef.current) saveCurrentState(); });
            c.on("object:removed", () => { if (!isApplyingRef.current) saveCurrentState(); });

            // Load previous canvas
            const saved = localStorage.getItem("canvas_state");
            if (saved) applyJSON(saved);
            else undoStack.current.push(JSON.stringify(c.toJSON()));

            setIsReady(true);
            loadProjects();
        };

        initFabric();

        return () => {
            disposed = true;
            if (canvasRef.current) {
                try { canvasRef.current.dispose(); } catch { }
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

        const thumbnail = c.toDataURL({ format: "png", quality: 0.6 });
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

    // ===================== TOOLS =====================
    const addShape = (type: "rect" | "circle" | "triangle") => {
        if (!fabricRef.current || !canvasRef.current) return;
        const fabric = fabricRef.current;
        let shape: any;

        switch (type) {
            case "rect":
                shape = new fabric.Rect({ left: 100, top: 100, width: 120, height: 80, fill: "#38bdf8" });
                break;
            case "circle":
                shape = new fabric.Circle({ left: 150, top: 150, radius: 50, fill: "#a3e635" });
                break;
            case "triangle":
                shape = new fabric.Triangle({ left: 200, top: 200, width: 100, height: 100, fill: "#f87171" });
                break;
        }

        canvasRef.current.add(shape);
    };

    const addText = () => {
        if (!fabricRef.current || !canvasRef.current) return;
        const fabric = fabricRef.current;
        const text = new fabric.IText("Edit me", { left: 300, top: 200, fontSize: 24, fill: "#000" });
        canvasRef.current.add(text);
    };

    const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            const imgEl = new Image();
            imgEl.onload = () => {
                const imgInstance = new fabricRef.current.Image(imgEl, { left: 100, top: 100 });
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

    // keep handler refs up-to-date so the keydown listener can call latest functions
    handlersRef.current = { undo, redo, deleteSelected };

    // Keyboard shortcuts: Ctrl/Cmd+Z (undo), Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y (redo), Delete/Backspace (delete)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const active = document.activeElement as HTMLElement | null;
            const isEditable = !!active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
            if (isEditable) return; // don't intercept typing

            const isMod = e.ctrlKey || e.metaKey;
            const key = e.key;

            if (isMod && (key === "z" || key === "Z")) {
                e.preventDefault();
                if (e.shiftKey) handlersRef.current.redo(); else handlersRef.current.undo();
            } else if (isMod && (key === "y" || key === "Y")) {
                e.preventDefault();
                handlersRef.current.redo();
            } else if (key === "Delete" || key === "Backspace") {
                // only delete when not focused in an input
                e.preventDefault();
                handlersRef.current.deleteSelected();
            }
        };

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // ===================== EXPORT =====================
    const exportImage = (type: "png" | "jpg") => {
        const data = canvasRef.current?.toDataURL({ format: type });
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
            try {
                const jsonString = reader.result as string;
                applyJSON(jsonString);
                console.log(`✅ Loaded project: ${file.name}`);
            } catch (err) {
                console.error("❌ Invalid JSON file:", err);
            }
            (e.target as HTMLInputElement).value = "";
        };
        reader.readAsText(file);
    };

    // ===================== RENDER =====================
    return (
        <div className="flex h-screen bg-gray-100">
            {/* LEFT SIDEBAR */}
            <aside className="w-64 bg-white border-r shadow-md flex flex-col">
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
                            <Image
                                src={project.thumbnail}
                                alt={project.name}
                                width={12}
                                height={12}
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

            {/* MAIN EDITOR */}
            <div className="flex-1 flex flex-col">
                <div className="flex flex-wrap items-center gap-2 bg-white shadow p-3 border-b">
                    <Button onClick={() => addShape("rect")}>Rectangle</Button>
                    <Button onClick={() => addShape("circle")}>Circle</Button>
                    <Button onClick={() => addShape("triangle")}>Triangle</Button>
                    <Button onClick={addText}>Text</Button>

                    <label className="cursor-pointer bg-blue-500 text-white px-3 py-1 rounded-md">
                        Upload Image
                        <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
                    </label>

                    <Button variant="destructive" onClick={deleteSelected}>Delete</Button>
                    <Button onClick={undo}>Undo</Button>
                    <Button onClick={redo}>Redo</Button>

                    <Button variant="outline" onClick={() => exportImage("png")}>PNG</Button>
                    <Button variant="outline" onClick={() => exportImage("jpg")}>JPG</Button>
                    <Button variant="outline" onClick={exportPDF}>PDF</Button>
                    <Button variant="outline" onClick={saveJSON}>Save JSON</Button>

                    <label className="cursor-pointer border rounded-md px-3 py-1">
                        Load JSON
                        <input type="file" accept=".json" className="hidden" onChange={loadJSON} />
                    </label>
                </div>

                <div className="flex flex-1 justify-center items-center overflow-auto">
                    <canvas ref={canvasEl} className="border shadow-lg rounded-lg" />
                </div>
            </div>
        </div>
    );
}
