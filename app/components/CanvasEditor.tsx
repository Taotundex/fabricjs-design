// 'use client';
// import React, { useRef, useEffect, useState } from 'react';
// import { FabricJSCanvas, useFabricJSEditor } from 'fabricjs-react';
// import {
//     FiSquare,
//     FiCircle,
//     FiType,
//     FiImage,
//     FiMousePointer,
//     FiMinus,
//     FiArrowRight,
//     FiSave,
//     FiFolder,
//     FiEdit3
// } from 'react-icons/fi';

// type Tool = 'select' | 'rectangle' | 'circle' | 'line' | 'arrow' | 'text' | 'pen';

// interface Project {
//     id: string;
//     name: string;
//     createdAt: Date;
//     updatedAt: Date;
//     thumbnail?: string;
// }

// const CanvasEditor: React.FC = () => {
//     const { editor, onReady } = useFabricJSEditor();
//     const [activeTool, setActiveTool] = useState<Tool>('select');
//     const [projects, setProjects] = useState<Project[]>([]);
//     const [currentProject, setCurrentProject] = useState<Project | null>(null);
//     const [textContent, setTextContent] = useState('');
//     const [textColor, setTextColor] = useState('#000000');
//     const [fontSize, setFontSize] = useState(24);
//     const [strokeColor, setStrokeColor] = useState('#000000');
//     const [fillColor, setFillColor] = useState('#4f46e5');

//     // Tool Handlers
//     const handleToolSelect = (tool: Tool) => {
//         setActiveTool(tool);
//         if (!editor?.canvas) return;

//         editor.canvas.isDrawingMode = false;
//         editor.canvas.selection = true;

//         switch (tool) {
//             case 'select':
//                 editor.canvas.defaultCursor = 'default';
//                 break;
//             case 'rectangle':
//             case 'circle':
//             case 'line':
//             case 'arrow':
//                 editor.canvas.defaultCursor = 'crosshair';
//                 break;
//             case 'text':
//                 editor.canvas.defaultCursor = 'text';
//                 break;
//             case 'pen':
//                 editor.canvas.isDrawingMode = true;
//                 if (editor.canvas.freeDrawingBrush) {
//                     editor.canvas.freeDrawingBrush.width = 5;
//                     editor.canvas.freeDrawingBrush.color = strokeColor;
//                 }
//                 break;
//         }
//     };

//     // Shape Creation Functions
//     const addRectangle = () => {
//         if (!editor?.canvas) return;
//         const rect = new editor.fabric.Rect({
//             left: 100,
//             top: 100,
//             width: 100,
//             height: 100,
//             fill: fillColor,
//             stroke: strokeColor,
//             strokeWidth: 2,
//         });
//         editor.canvas.add(rect);
//         editor.canvas.renderAll();
//     };

//     const addCircle = () => {
//         if (!editor?.canvas) return;
//         const circle = new editor.fabric.Circle({
//             left: 100,
//             top: 100,
//             radius: 50,
//             fill: fillColor,
//             stroke: strokeColor,
//             strokeWidth: 2,
//         });
//         editor.canvas.add(circle);
//         editor.canvas.renderAll();
//     };

//     const addLine = () => {
//         if (!editor?.canvas) return;
//         const line = new editor.fabric.Line([50, 100, 200, 100], {
//             stroke: strokeColor,
//             strokeWidth: 3,
//         });
//         editor.canvas.add(line);
//         editor.canvas.renderAll();
//     };

//     const addArrow = () => {
//         if (!editor?.canvas) return;

//         // Create arrow using Line and Triangle
//         const line = new editor.fabric.Line([50, 100, 150, 100], {
//             stroke: strokeColor,
//             strokeWidth: 3,
//         });

//         const triangle = new editor.fabric.Triangle({
//             left: 150,
//             top: 100,
//             width: 15,
//             height: 15,
//             fill: strokeColor,
//             angle: 0,
//             originX: 'center',
//             originY: 'center'
//         });

//         const arrowGroup = new editor.fabric.Group([line, triangle], {
//             left: 50,
//             top: 100
//         });

//         editor.canvas.add(arrowGroup);
//         editor.canvas.renderAll();
//     };

//     const addText = () => {
//         if (!editor?.canvas || !textContent.trim()) return;

//         const text = new editor.fabric.Text(textContent, {
//             left: 100,
//             top: 100,
//             fontSize: fontSize,
//             fill: textColor,
//             fontFamily: 'Arial',
//         });

//         editor.canvas.add(text);
//         editor.canvas.renderAll();
//         setTextContent('');
//     };

//     // Handle canvas click for text placement
//     const handleCanvasClick = (opt: any) => {
//         if (activeTool === 'text' && editor?.canvas && textContent.trim()) {
//             const pointer = editor.canvas.getPointer(opt.e);
//             const text = new editor.fabric.Text(textContent, {
//                 left: pointer.x,
//                 top: pointer.y,
//                 fontSize: fontSize,
//                 fill: textColor,
//                 fontFamily: 'Arial',
//             });

//             editor.canvas.add(text);
//             editor.canvas.renderAll();
//             setTextContent('');
//             setActiveTool('select');
//         }
//     };

//     // File Upload Handler
//     const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
//         const file = event.target.files?.[0];
//         if (!file || !editor?.canvas) return;

//         const reader = new FileReader();
//         reader.onload = (e) => {
//             editor.fabric.Image.fromURL(e.target?.result as string, (img) => {
//                 img.scale(0.5);
//                 editor.canvas.add(img);
//                 editor.canvas.renderAll();
//             });
//         };
//         reader.readAsDataURL(file);
//     };

//     // Save Functions
//     const saveAsJSON = () => {
//         if (!editor?.canvas) return;
//         const json = editor.canvas.toJSON();
//         const dataStr = JSON.stringify(json);
//         const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`;

//         const exportFileDefaultName = `project-${Date.now()}.json`;
//         const linkElement = document.createElement('a');
//         linkElement.setAttribute('href', dataUri);
//         linkElement.setAttribute('download', exportFileDefaultName);
//         linkElement.click();
//     };

//     const saveAsImage = (format: 'png' | 'jpeg') => {
//         if (!editor?.canvas) return;
//         const dataURL = editor.canvas.toDataURL({
//             format: format,
//             quality: 0.8
//         });

//         const link = document.createElement('a');
//         link.download = `project-${Date.now()}.${format === 'png' ? 'png' : 'jpg'}`;
//         link.href = dataURL;
//         link.click();
//     };

//     // Project Management
//     const createNewProject = () => {
//         const newProject: Project = {
//             id: Date.now().toString(),
//             name: `Project ${projects.length + 1}`,
//             createdAt: new Date(),
//             updatedAt: new Date()
//         };
//         setProjects(prev => [...prev, newProject]);
//         setCurrentProject(newProject);

//         // Clear canvas
//         editor?.canvas.clear();
//         editor?.canvas.setBackgroundColor('#ffffff', () => {
//             editor?.canvas.renderAll();
//         });
//     };

//     const loadProject = (project: Project) => {
//         setCurrentProject(project);
//         // Load project data from storage (you can implement localStorage here)
//         const modal = document.getElementById('projects-modal') as HTMLDialogElement;
//         if (modal) modal.close();
//     };

//     // Initialize canvas events
//     useEffect(() => {
//         if (editor?.canvas) {
//             editor.canvas.on('mouse:down', handleCanvasClick);
//         }

//         return () => {
//             if (editor?.canvas) {
//                 editor.canvas.off('mouse:down', handleCanvasClick);
//             }
//         };
//     }, [editor, activeTool, textContent, fontSize, textColor]);

//     return (
//         <div className="flex h-screen bg-gray-100">
//             {/* Sidebar */}
//             <div className="w-16 bg-white shadow-lg flex flex-col items-center py-4">
//                 <button
//                     className={`p-3 mb-2 rounded-lg ${activeTool === 'select' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
//                     onClick={() => handleToolSelect('select')}
//                     title="Select"
//                 >
//                     <FiMousePointer size={20} />
//                 </button>
//                 <button
//                     className={`p-3 mb-2 rounded-lg ${activeTool === 'rectangle' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
//                     onClick={addRectangle}
//                     title="Rectangle"
//                 >
//                     <FiSquare size={20} />
//                 </button>
//                 <button
//                     className={`p-3 mb-2 rounded-lg ${activeTool === 'circle' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
//                     onClick={addCircle}
//                     title="Circle"
//                 >
//                     <FiCircle size={20} />
//                 </button>
//                 <button
//                     className={`p-3 mb-2 rounded-lg ${activeTool === 'line' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
//                     onClick={addLine}
//                     title="Line"
//                 >
//                     <FiMinus size={20} />
//                 </button>
//                 <button
//                     className={`p-3 mb-2 rounded-lg ${activeTool === 'arrow' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
//                     onClick={addArrow}
//                     title="Arrow"
//                 >
//                     <FiArrowRight size={20} />
//                 </button>
//                 <button
//                     className={`p-3 mb-2 rounded-lg ${activeTool === 'text' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
//                     onClick={() => handleToolSelect('text')}
//                     title="Text"
//                 >
//                     <FiType size={20} />
//                 </button>
//                 <button
//                     className={`p-3 mb-2 rounded-lg ${activeTool === 'pen' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
//                     onClick={() => handleToolSelect('pen')}
//                     title="Pen"
//                 >
//                     <FiEdit3 size={20} />
//                 </button>

//                 <div className="mt-auto space-y-2">
//                     <button
//                         className="p-3 rounded-lg hover:bg-gray-100"
//                         onClick={() => document.getElementById('image-upload')?.click()}
//                         title="Upload Image"
//                     >
//                         <FiImage size={20} />
//                     </button>
//                     <button
//                         className="p-3 rounded-lg hover:bg-gray-100"
//                         onClick={() => document.getElementById('projects-modal')?.showModal()}
//                         title="Projects"
//                     >
//                         <FiFolder size={20} />
//                     </button>
//                 </div>

//                 <input
//                     id="image-upload"
//                     type="file"
//                     accept="image/*"
//                     onChange={handleImageUpload}
//                     className="hidden"
//                 />
//             </div>

//             {/* Main Content */}
//             <div className="flex-1 flex flex-col">
//                 {/* Top Bar */}
//                 <div className="bg-white shadow-sm border-b px-6 py-3">
//                     <div className="flex justify-between items-center">
//                         <div className="flex items-center space-x-4">
//                             <button
//                                 onClick={createNewProject}
//                                 className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
//                             >
//                                 New Project
//                             </button>
//                             {currentProject && (
//                                 <span className="text-lg font-semibold">{currentProject.name}</span>
//                             )}
//                         </div>

//                         <div className="flex items-center space-x-4">
//                             {/* Color Pickers */}
//                             <div className="flex items-center space-x-2">
//                                 <label className="text-sm text-gray-600">Fill:</label>
//                                 <input
//                                     type="color"
//                                     value={fillColor}
//                                     onChange={(e) => setFillColor(e.target.value)}
//                                     className="w-8 h-8 border rounded cursor-pointer"
//                                 />
//                             </div>
//                             <div className="flex items-center space-x-2">
//                                 <label className="text-sm text-gray-600">Stroke:</label>
//                                 <input
//                                     type="color"
//                                     value={strokeColor}
//                                     onChange={(e) => setStrokeColor(e.target.value)}
//                                     className="w-8 h-8 border rounded cursor-pointer"
//                                 />
//                             </div>

//                             {/* Text Controls */}
//                             <div className="flex items-center space-x-2">
//                                 <label className="text-sm text-gray-600">Text Size:</label>
//                                 <select
//                                     className="border rounded px-2 py-1 text-sm"
//                                     value={fontSize}
//                                     onChange={(e) => setFontSize(Number(e.target.value))}
//                                 >
//                                     <option value={12}>12</option>
//                                     <option value={18}>18</option>
//                                     <option value={24}>24</option>
//                                     <option value={36}>36</option>
//                                     <option value={48}>48</option>
//                                     <option value={64}>64</option>
//                                 </select>
//                             </div>

//                             <div className="flex items-center space-x-2">
//                                 <label className="text-sm text-gray-600">Text Color:</label>
//                                 <input
//                                     type="color"
//                                     value={textColor}
//                                     onChange={(e) => setTextColor(e.target.value)}
//                                     className="w-8 h-8 border rounded cursor-pointer"
//                                 />
//                             </div>

//                             {/* Save Buttons */}
//                             <div className="flex space-x-2 ml-4">
//                                 <button
//                                     onClick={saveAsJSON}
//                                     className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
//                                 >
//                                     Save JSON
//                                 </button>
//                                 <button
//                                     onClick={() => saveAsImage('png')}
//                                     className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
//                                 >
//                                     Save PNG
//                                 </button>
//                                 <button
//                                     onClick={() => saveAsImage('jpeg')}
//                                     className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
//                                 >
//                                     Save JPG
//                                 </button>
//                             </div>
//                         </div>
//                     </div>
//                 </div>

//                 {/* Text Input */}
//                 {activeTool === 'text' && (
//                     <div className="bg-white border-b px-6 py-3">
//                         <div className="flex items-center space-x-4">
//                             <input
//                                 type="text"
//                                 value={textContent}
//                                 onChange={(e) => setTextContent(e.target.value)}
//                                 placeholder="Click on canvas to place text or enter text here and click Add Text..."
//                                 className="flex-1 border rounded px-3 py-2 text-sm"
//                             />
//                             <button
//                                 onClick={addText}
//                                 className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
//                             >
//                                 Add Text
//                             </button>
//                             <button
//                                 onClick={() => setActiveTool('select')}
//                                 className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-sm"
//                             >
//                                 Cancel
//                             </button>
//                         </div>
//                     </div>
//                 )}

//                 {/* Canvas Area */}
//                 <div className="flex-1 p-8 overflow-auto bg-gray-200">
//                     <div className="bg-white rounded-lg shadow-lg inline-block">
//                         <FabricJSCanvas className="sample-canvas" onReady={onReady} />
//                     </div>
//                 </div>
//             </div>

//             {/* Projects Modal */}
//             <dialog id="projects-modal" className="modal">
//                 <div className="modal-box">
//                     <h3 className="font-bold text-lg mb-4">Your Projects</h3>
//                     <div className="space-y-2 max-h-96 overflow-y-auto">
//                         {projects.length === 0 ? (
//                             <p className="text-gray-500 text-center py-4">No projects yet. Create your first project!</p>
//                         ) : (
//                             projects.map(project => (
//                                 <div
//                                     key={project.id}
//                                     className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer flex justify-between items-center"
//                                     onClick={() => loadProject(project)}
//                                 >
//                                     <div>
//                                         <div className="font-medium">{project.name}</div>
//                                         <div className="text-sm text-gray-500">
//                                             Created: {project.createdAt.toLocaleDateString()}
//                                         </div>
//                                     </div>
//                                     <button
//                                         onClick={(e) => {
//                                             e.stopPropagation();
//                                             setProjects(prev => prev.filter(p => p.id !== project.id));
//                                         }}
//                                         className="text-red-500 hover:text-red-700 text-sm"
//                                     >
//                                         Delete
//                                     </button>
//                                 </div>
//                             ))
//                         )}
//                     </div>
//                     <div className="modal-action">
//                         <form method="dialog">
//                             <button className="btn">Close</button>
//                         </form>
//                     </div>
//                 </div>
//             </dialog>
//         </div>
//     );
// };

// export default CanvasEditor;