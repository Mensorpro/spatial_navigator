import { EnhancedBoundingBox2D } from '../types/ProcessingTypes';

// Export these constants for better configurability
export const FRAME_PROCESSING_INTERVAL_MS = 3000; // Process frames every 3 seconds
export const MAX_FRAME_HISTORY = 5; // Keep last 5 frames for context
export const RATE_LIMIT_BUFFER_INCREMENT = 2000; // Add 2 seconds on rate limit
export const MAX_RATE_LIMIT_BUFFER = 10000; // Max 10 seconds between requests

// Helper function to estimate movement based on time between frames
export function detectMovementDirection(timeSinceLastFrame: number): string {
  // If last frame was processed a long time ago, assume stationary
  if (timeSinceLastFrame > 5000) {
    return "stationary";
  }
  
  // Simple random movement for demo purposes
  // In a real app, this would use accelerometer/gyro data
  const rand = Math.random();
  if (rand < 0.7) return "moving forward"; // Most likely
  if (rand < 0.8) return "turning";
  if (rand < 0.9) return "stopped";
  return "stationary";
}

export function matrixMultiply(A: number[][], b: number[]) {
  return A.map((row) => row.reduce((acc, val, j) => acc + val * b[j], 0));
}

// Process and track 2D bounding boxes between frames
export async function processAndTrack2DBoundingBoxes(
  parsedResponse: any[],
  currentTimestamp: number,
  previousBoxes: EnhancedBoundingBox2D[],
  objectTrackingMap: Map<string, { id: string; label: string; lastSeen: number }>
): Promise<EnhancedBoundingBox2D[]> {
  console.log(`Processing ${parsedResponse.length} boxes from API response`);
  
  try {
    // Format boxes from API response
    const formattedBoxes = parsedResponse.map((box: any) => {
      // Handle different API response formats
      let boxData: [number, number, number, number] = [0, 0, 0, 0];
      
      if (box.box_2d && Array.isArray(box.box_2d) && box.box_2d.length === 4) {
        // Standard format: [ymin, xmin, ymax, xmax]
        boxData = box.box_2d as [number, number, number, number];
      } else if (box.bounding_box && Array.isArray(box.bounding_box) && box.bounding_box.length === 4) {
        // Alternative format
        boxData = box.bounding_box as [number, number, number, number];
      } else {
        // Try to extract from other fields or use defaults
        console.warn('Unexpected box format, attempting to recover:', box);
        const defaults = [0, 0, 500, 500]; // middle of the image as fallback
        boxData = [
          box.ymin ?? box.top ?? defaults[0],
          box.xmin ?? box.left ?? defaults[1],
          box.ymax ?? box.bottom ?? defaults[2],
          box.xmax ?? box.right ?? defaults[3]
        ] as [number, number, number, number];
      }
      
      const [ymin, xmin, ymax, xmax] = boxData;
      
      // Normalize coordinates to 0-1 range if they're in 0-1000 range
      const normalizedX = xmin > 1 ? xmin / 1000 : xmin;
      const normalizedY = ymin > 1 ? ymin / 1000 : ymin;
      const normalizedWidth = xmax > 1 ? (xmax - xmin) / 1000 : xmax - xmin;
      const normalizedHeight = ymax > 1 ? (ymax - ymin) / 1000 : ymax - ymin;
      
      const label = box.label || 'Unknown';
      const distance = box.distance || '';
      const movement = box.movement || 'stationary';
      const combinedLabel = [label, distance].filter(Boolean).join(' - ');
      
      // Initialize with default values, will update id below
      return {
        x: normalizedX,
        y: normalizedY,
        width: normalizedWidth,
        height: normalizedHeight,
        label: combinedLabel,
        id: '', // Will be set below
        firstSeen: currentTimestamp,
        lastSeen: currentTimestamp,
        movement: movement === 'approaching' ? 'approaching' : 
                  movement === 'receding' ? 'receding' : 
                  movement === 'left' ? 'left' : 
                  movement === 'right' ? 'right' : 'stationary'
      } as EnhancedBoundingBox2D;
    });
    
    // Update tracking IDs
    for (let box of formattedBoxes) {
      // Use object center for matching
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      const boxSize = box.width * box.height;
      
      // Try to match with previously tracked objects
      let bestMatch = '';
      let bestScore = 0;
      
      for (let i = 0; i < previousBoxes.length; i++) {
        const prevBox = previousBoxes[i];
        // Skip if this box was last seen too long ago
        if (currentTimestamp - prevBox.lastSeen! > 10000) continue;
        
        const prevCenterX = prevBox.x + prevBox.width / 2;
        const prevCenterY = prevBox.y + prevBox.height / 2;
        const prevBoxSize = prevBox.width * prevBox.height;
        
        // Distance between centers
        const centerDist = Math.sqrt(
          Math.pow(centerX - prevCenterX, 2) + 
          Math.pow(centerY - prevCenterY, 2)
        );
        
        // Size similarity (ratio of min/max)
        const sizeRatio = Math.min(boxSize, prevBoxSize) / Math.max(boxSize, prevBoxSize);
        
        // Combined score - higher is better
        const score = (1 - centerDist) * 0.7 + sizeRatio * 0.3;
        
        if (score > 0.6 && score > bestScore) { // Threshold score for matching
          bestScore = score;
          bestMatch = prevBox.id || '';
        }
      }
      
      if (bestMatch) {
        // Matched with a previous box
        box.id = bestMatch;
        // Update tracking map
        if (objectTrackingMap.has(bestMatch)) {
          const trackInfo = objectTrackingMap.get(bestMatch)!;
          objectTrackingMap.set(bestMatch, {
            ...trackInfo,
            lastSeen: currentTimestamp
          });
        }
      } else {
        // New object - create tracking ID
        const trackingId = `obj-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        box.id = trackingId;
        
        // Add to tracking map
        objectTrackingMap.set(trackingId, {
          id: trackingId,
          label: box.label,
          lastSeen: currentTimestamp
        });
      }
    }
    
    // Include recent boxes from previous frames that weren't detected in this frame
    // This provides continuity between frames
    const recentTimeCutoff = currentTimestamp - 3000; // Consider boxes seen in last 3s
    
    const recentPreviousBoxes = previousBoxes.filter(box => 
      box.lastSeen! > recentTimeCutoff &&
      !formattedBoxes.some(newBox => newBox.id === box.id)
    );
    
    // Create combined result
    const combinedBoxes = [
      ...formattedBoxes,
      ...recentPreviousBoxes.map(box => ({
        ...box,
        // Add "fading" to older detections
        label: box.label.includes('(fading)') ? box.label : `${box.label} (fading)`
      }))
    ];
    
    console.log(`Processed and tracked ${combinedBoxes.length} boxes (${formattedBoxes.length} new, ${recentPreviousBoxes.length} carried over)`);
    
    return combinedBoxes;
  } catch (err) {
    console.error('Error processing bounding boxes:', err);
    return previousBoxes; // Return previous boxes on error
  }
}