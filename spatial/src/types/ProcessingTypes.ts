// Interface for frame history item
export interface FrameHistoryItem {
  timestamp: number;
  dataUrl: string;
  detections: any[];  // Store the AI detection results
  movementDirection?: string; // Direction of movement since last frame
  isKeyFrame?: boolean; // Whether this frame was processed by the API
}

// Interface for enhanced bounding box with movement tracking
export interface EnhancedBoundingBox2D {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  id?: string; // Unique identifier to track objects across frames
  distance?: string; // Estimated distance like "3 footsteps away"
  movement?: "approaching" | "receding" | "stationary" | "left" | "right"; // Movement direction
  prevSize?: number; // Previous size for comparison
  firstSeen?: number; // Timestamp when object was first detected
  lastSeen?: number; // Timestamp when object was last detected
}

export interface ProcessingDimensions {
  width: number;
  height: number;
}

export interface BoundingBox3D {
  center: [number, number, number];
  size: [number, number, number];
  rpy: [number, number, number];
  label: string;
}