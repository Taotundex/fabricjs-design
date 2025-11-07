"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { jsPDF } from "jspdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type * as fabricType from "fabric";
import NextImage from "next/image";

interface Project {
    name: string;
    thumbnail: string;
    json: string;
    updatedAt: number;
}

interface EditableField {
    id: string;
    type: "text" | "image" | "color";
    originalValue: string;
    property: string;
    objectId?: string;
}

export default function CustomerEditor() {
    const canvasRef = useRef<fabricType.Canvas | null>(null);
    const fabricRef = useRef<any | null>(null);
    const canvasEl = useRef<HTMLCanvasElement | null>(null);

    const [isReady, setIsReady] = useState(false);
    const [isInitializing, setIsInitializing] = useState(false);
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<string>("");
    const [editableFields, setEditableFields] = useState<EditableField[]>([]);
    const [formValues, setFormValues] = useState<Record<string, string>>({});
    const [previewImages, setPreviewImages] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [initError, setInitError] = useState<string | null>(null);

    // ===================== LOAD PROJECTS =====================
    useEffect(() => {
        try {
            const saved = localStorage.getItem("projects");
            if (saved) {
                const list: Project[] = JSON.parse(saved);
                setProjects(list);
                console.log("Loaded projects:", list.length);
            }
        } catch (err) {
            console.error("Error loading projects:", err);
        }
    }, []);

    // ===================== INIT FABRIC =====================
    const initializeFabric = useCallback(async () => {
        if (canvasRef.current || isInitializing) {
            console.log("Fabric already initialized or initializing");
            return;
        }

        if (!canvasEl.current) {
            console.warn("Canvas element not found, aborting init");
            return;
        }

        setIsInitializing(true);
        setInitError(null);

        try {
            console.log("Loading Fabric.js...");
            const fabricModule = await import("fabric");
            const fabric = (fabricModule as any).fabric || fabricModule.default || fabricModule;
            fabricRef.current = fabric;

            const c = new fabric.Canvas(canvasEl.current, {
                width: 800,
                height: 600,
                backgroundColor: "#fff",
                selection: false,
            });

            canvasRef.current = c;
            setIsReady(true);
            setIsInitializing(false);
            console.log("Fabric.js initialized successfully");

            // If a project is already selected, load it
            if (selectedProject) {
                await loadSelectedProject(selectedProject);
            }

        } catch (err) {
            const msg = `Error initializing Fabric.js: ${err}`;
            console.error(msg);
            setInitError(msg);
            setIsInitializing(false);
        }
    }, [selectedProject, isInitializing]);

    // ✅ Only initialize once both canvas & project are ready
    useEffect(() => {
        if (!canvasEl.current) return;
        if (!selectedProject) return;
        if (canvasRef.current) return;

        initializeFabric();
    }, [selectedProject, canvasEl.current, initializeFabric]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (canvasRef.current) {
                try {
                    canvasRef.current.dispose();
                } catch (e) {
                    console.error("Error disposing canvas:", e);
                }
            }
            canvasRef.current = null;
            fabricRef.current = null;
        };
    }, []);

    // ===================== LOAD PROJECT =====================
    const loadSelectedProject = useCallback(async (projectName: string) => {
        const project = projects.find((p) => p.name === projectName);
        if (!project) return;

        if (!canvasRef.current || !fabricRef.current) {
            console.warn("Fabric not ready, waiting...");
            return;
        }

        setIsLoading(true);
        setSelectedProject(projectName);
        setEditableFields([]);
        setFormValues({});
        setPreviewImages({});

        try {
            console.log("Loading project data...");
            canvasRef.current.clear();

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject("Timeout loading project"), 10000);
                canvasRef.current?.loadFromJSON(project.json, () => {
                    clearTimeout(timeout);
                    canvasRef.current?.renderAll();
                    console.log("Project loaded successfully");
                    extractEditableFields();
                    resolve();
                });
            });
        } catch (err) {
            console.error("Error loading project:", err);
            setInitError("Failed to load project");
        } finally {
            setIsLoading(false);
        }
    }, [projects]);

    // ===================== HANDLE PROJECT SELECT =====================
    const handleProjectSelect = (projectName: string) => {
        console.log("Selected project:", projectName);
        setSelectedProject(projectName);
    };

    // ===================== EXTRACT EDITABLE FIELDS =====================
    const extractEditableFields = () => {
        if (!canvasRef.current) return;

        const fields: EditableField[] = [];
        const values: Record<string, string> = {};
        const objects = canvasRef.current.getObjects();

        objects.forEach((obj: any, index) => {
            const id = obj.id || `obj_${index}`;

            if (obj.type === "i-text" || obj.type === "textbox" || obj.type === "text") {
                const fieldId = `text_${index}`;
                const value = obj.text || "";
                fields.push({
                    id: fieldId,
                    type: "text",
                    originalValue: value,
                    property: "text",
                    objectId: id
                });
                values[fieldId] = value;

                // Also create a color field for text objects
                const colorFieldId = `color_${index}`;
                const colorValue = obj.fill || "#000000";
                fields.push({
                    id: colorFieldId,
                    type: "color",
                    originalValue: colorValue,
                    property: "fill",
                    objectId: id
                });
                values[colorFieldId] = colorValue;

            } else if (obj.type === "image") {
                const fieldId = `image_${index}`;
                fields.push({
                    id: fieldId,
                    type: "image",
                    originalValue: obj.src || "",
                    property: "src",
                    objectId: id
                });
                values[fieldId] = "";
            }
        });

        setEditableFields(fields);
        setFormValues(values);
        console.log("Extracted editable fields:", fields.length);
    };

    // ===================== TEXT UPDATE =====================
    const updateTextOnCanvas = (fieldId: string, value: string) => {
        const field = editableFields.find((f) => f.id === fieldId);
        if (!field || !canvasRef.current) return;

        const objects = canvasRef.current.getObjects();
        const target = objects.find((obj: any) =>
            field.objectId && obj.id === field.objectId
        );

        if (target && field.property === "text") {
            target.set(field.property, value);
            canvasRef.current.renderAll();
        }
    };

    // ===================== COLOR UPDATE =====================
    const updateColorOnCanvas = (fieldId: string, value: string) => {
        const field = editableFields.find((f) => f.id === fieldId);
        if (!field || !canvasRef.current) return;

        const objects = canvasRef.current.getObjects();
        const target = objects.find((obj: any) =>
            field.objectId && obj.id === field.objectId
        );

        if (target && field.property === "fill") {
            target.set(field.property, value);
            canvasRef.current.renderAll();
        }
    };

    // ===================== IMAGE UPDATE =====================
    const updateImageOnCanvas = async (fieldId: string, file: File) => {
        const field = editableFields.find((f) => f.id === fieldId);
        if (!field || !canvasRef.current || !fabricRef.current) return;

        try {
            const dataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target?.result as string);
                reader.readAsDataURL(file);
            });

            // Find the target image object
            const objects = canvasRef.current.getObjects();
            const target = objects.find((obj: any) =>
                field.objectId && obj.id === field.objectId
            );

            if (target && target.type === "image") {
                // Create new image and replace the existing one
                const img = new Image();
                await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = () => reject("Image load failed");
                    img.src = dataUrl;
                });

                const fabricImg = new fabricRef.current.Image(img, {
                    left: target.left,
                    top: target.top,
                    scaleX: target.scaleX,
                    scaleY: target.scaleY,
                    angle: target.angle,
                    originX: target.originX,
                    originY: target.originY,
                });

                // Remove old image and add new one
                canvasRef.current.remove(target);
                canvasRef.current.add(fabricImg);
                canvasRef.current.renderAll();

                setPreviewImages((prev) => ({ ...prev, [fieldId]: dataUrl }));
                console.log("Image updated successfully");
            }
        } catch (err) {
            console.error("Error updating image:", err);
        }
    };

    // ===================== HANDLERS =====================
    const handleTextChange = (id: string, value: string) => {
        setFormValues((p) => ({ ...p, [id]: value }));
        updateTextOnCanvas(id, value);
    };

    const handleColorChange = (id: string, value: string) => {
        setFormValues((p) => ({ ...p, [id]: value }));
        updateColorOnCanvas(id, value);
    };

    const handleImageUpload = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        updateImageOnCanvas(id, file);
        e.target.value = "";
    };

    // ===================== EXPORTS =====================
    const exportImage = (type: "png" | "jpg") => {
        if (!canvasRef.current) return;
        const data = canvasRef.current.toDataURL({ format: type === "jpg" ? "jpeg" : "png", multiplier: 2 });
        const a = document.createElement("a");
        a.href = data;
        a.download = `design.${type}`;
        a.click();
    };

    const exportPDF = () => {
        if (!canvasRef.current) return;
        const data = canvasRef.current.toDataURL({ format: "png", multiplier: 2 });
        const pdf = new jsPDF("l", "pt", "a4");
        pdf.addImage(data, "PNG", 0, 0, 800, 600);
        pdf.save("design.pdf");
    };

    const saveCustomizedProject = () => {
        if (!canvasRef.current || !selectedProject) return;
        const json = JSON.stringify(canvasRef.current.toJSON());
        const thumb = canvasRef.current.toDataURL({ format: "png", quality: 0.6 });
        const newProject: Project = {
            name: `${selectedProject}_custom_${Date.now()}`,
            json,
            thumbnail: thumb,
            updatedAt: Date.now(),
        };
        const updated = [...projects, newProject];
        localStorage.setItem("projects", JSON.stringify(updated));
        setProjects(updated);
        alert("Saved customized design!");
    };

    const retryInitialization = () => {
        setInitError(null);
        initializeFabric();
    };

    // Group fields by object for better organization
    const groupedFields = editableFields.reduce((acc, field) => {
        const baseId = field.objectId || field.id;
        if (!acc[baseId]) {
            acc[baseId] = [];
        }
        acc[baseId].push(field);
        return acc;
    }, {} as Record<string, EditableField[]>);

    // ===================== UI =====================
    return (
        <div className="flex flex-col lg:flex-row h-screen bg-gray-50 p-4 gap-6">
            {/* LEFT PANEL */}
            <div className="w-full lg:w-1/3 space-y-6 overflow-y-auto">
                <Card>
                    <CardHeader>
                        <CardTitle>Select a Design</CardTitle>
                        <CardDescription>
                            {isInitializing ? "Initializing editor..." : "Choose a saved design to customize"}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Select value={selectedProject} onValueChange={handleProjectSelect} disabled={isInitializing}>
                            <SelectTrigger>
                                <SelectValue placeholder="Choose a design..." />
                            </SelectTrigger>
                            <SelectContent>
                                {projects.map((p) => (
                                    <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {initError && (
                            <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                                {initError}
                                <Button size="sm" className="ml-2" onClick={retryInitialization}>Retry</Button>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* EDITING FORM */}
                {selectedProject && isReady && !isLoading && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Customize Your Design</CardTitle>
                            <CardDescription>Edit text, colors, and upload images</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {Object.keys(groupedFields).length > 0 ? (
                                Object.entries(groupedFields).map(([objectId, fields], groupIndex) => (
                                    <div key={objectId} className="space-y-4 p-4 border rounded-lg">
                                        <h3 className="font-semibold text-lg">Element {groupIndex + 1}</h3>

                                        {fields.map((field) => (
                                            <div key={field.id} className="space-y-2">
                                                {field.type === "text" && (
                                                    <>
                                                        <Label htmlFor={field.id}>Text</Label>
                                                        <Input
                                                            id={field.id}
                                                            value={formValues[field.id] || ""}
                                                            onChange={(e) => handleTextChange(field.id, e.target.value)}
                                                            placeholder="Enter text..."
                                                        />
                                                    </>
                                                )}

                                                {field.type === "color" && (
                                                    <>
                                                        <Label htmlFor={field.id}>Color</Label>
                                                        <div className="flex items-center gap-2">
                                                            <Input
                                                                id={field.id}
                                                                type="color"
                                                                value={formValues[field.id] || "#000000"}
                                                                onChange={(e) => handleColorChange(field.id, e.target.value)}
                                                                className="w-12 h-10 p-1"
                                                            />
                                                            <Input
                                                                value={formValues[field.id] || "#000000"}
                                                                onChange={(e) => handleColorChange(field.id, e.target.value)}
                                                                placeholder="#000000"
                                                                className="flex-1"
                                                            />
                                                        </div>
                                                    </>
                                                )}

                                                {field.type === "image" && (
                                                    <>
                                                        <Label htmlFor={field.id}>Replace Image</Label>
                                                        <Input
                                                            id={field.id}
                                                            type="file"
                                                            accept="image/*"
                                                            onChange={(e) => handleImageUpload(field.id, e)}
                                                        />
                                                        {previewImages[field.id] && (
                                                            <div className="mt-2">
                                                                <p className="text-sm text-gray-600 mb-1">Preview:</p>
                                                                <NextImage
                                                                    src={previewImages[field.id]}
                                                                    alt="preview"
                                                                    width={100}
                                                                    height={100}
                                                                    className="w-24 h-24 object-cover rounded border"
                                                                />
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ))
                            ) : (
                                <p className="text-gray-500 text-center py-4">No editable elements found in this design.</p>
                            )}

                            <div className="flex flex-wrap gap-2 pt-4 border-t">
                                <Button onClick={saveCustomizedProject}>Save Customized Design</Button>
                                <Button variant="outline" onClick={() => exportImage("png")}>Export PNG</Button>
                                <Button variant="outline" onClick={() => exportImage("jpg")}>Export JPG</Button>
                                <Button variant="outline" onClick={exportPDF}>Export PDF</Button>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* RIGHT PANEL */}
            <div className="w-full lg:w-2/3">
                <Card className="h-full">
                    <CardHeader>
                        <CardTitle>Design Preview</CardTitle>
                        <CardDescription>
                            {isInitializing ? "Initializing..." : isLoading ? "Loading design..." : initError ? "Error" : selectedProject ? `Editing: ${selectedProject}` : "Select a design to start"}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="h-full">
                        <div className="flex justify-center items-center bg-gray-100 rounded-lg p-4 h-full min-h-[500px]">
                            {initError ? (
                                <div className="text-center text-red-600">
                                    <p>Initialization failed</p>
                                    <Button onClick={retryInitialization} className="mt-2">Retry</Button>
                                </div>
                            ) : (
                                <canvas ref={canvasEl} className="border shadow-lg rounded-lg max-w-full max-h-full" />
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}