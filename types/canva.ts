export interface Project {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  thumbnail?: string;
}

export interface CanvasState {
  objects: fabric.Object[];
  background: string;
  width: number;
  height: number;
}

export type Tool = 'select' | 'rectangle' | 'circle' | 'line' | 'arrow' | 'text' | 'pen';