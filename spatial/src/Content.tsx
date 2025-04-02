// Copyright 2024 Google LLC

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     https://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { useAtom } from "jotai";
import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import {
  ImageSrcAtom,
  BoundingBoxes2DAtom,
  BoundingBoxes3DAtom,
  ShareStream,
  DetectTypeAtom,
  FOVAtom,
  PointsAtom,
  VideoRefAtom,
} from "./atoms";
import { ResizePayload, useResizeDetector } from "react-resize-detector";
import { GoogleGenerativeAI } from "@google/generative-ai";

const client = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

// Add rate limiting and retry logic for API requests
const RETRY_DELAY_MS = 1000; // Start with 1 second delay
const MAX_RETRY_DELAY_MS = 10000; // Max 10 second delay
const MAX_RETRIES = 3;

// Frame processing interval in milliseconds
// Free tier quota is 15 requests per minute for gemini-1.5-flash
// Set to 4500ms (~13.3 requests/min) to stay safely under the quota limit of 15
const FRAME_PROCESSING_INTERVAL_MS = 10000; 

// Additional safety buffer (milliseconds) applied when rate limit errors occur
let dynamicRateLimitBuffer = 0;

// Increment for dynamic buffer when hitting rate limits (ms)
const RATE_LIMIT_BUFFER_INCREMENT = 5000;

// Maximum number of frames to keep in history for context
const MAX_FRAME_HISTORY = 1;

// Number of intermediate frames to capture between API requests
const INTERMEDIATE_FRAMES_COUNT = 1;

// Interface for frame history item
interface FrameHistoryItem {
  timestamp: number;
  dataUrl: string;
  detections: any[];  // Store the AI detection results
  movementDirection?: string; // Direction of movement since last frame
  isKeyFrame?: boolean; // Whether this frame was processed by the API
}

// Interface for enhanced bounding box with movement tracking
interface EnhancedBoundingBox2D {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  id?: string; // Unique identifier to track objects across frames
  distance?: string; // Estimated distance like "3 footsteps away"
  movement?: "approaching" | "receding" | "stationary" | "left" | "right"; // Movement direction
  prevSize?: number; // Previous size for comparison
}

export function Content({ isNavigating = false }) {
  const [imageSrc] = useAtom(ImageSrcAtom);
  const [boundingBoxes2D, setBoundingBoxes2D] = useAtom(BoundingBoxes2DAtom);
  const [boundingBoxes3D, setBoundingBoxes3D] = useAtom(BoundingBoxes3DAtom);
  const [stream] = useAtom(ShareStream);
  const [detectType] = useAtom(DetectTypeAtom);
  const [videoRef] = useAtom(VideoRefAtom);
  const [fov] = useAtom(FOVAtom);
  const [points, setPoints] = useAtom(PointsAtom);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const processingRef = useRef(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const retryTimeoutRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const [videoReady, setVideoReady] = useState(false);
  const videoInitTimeoutRef = useRef<number | null>(null);
  
  // New states for context tracking
  const [frameHistory, setFrameHistory] = useState<FrameHistoryItem[]>([]);
  const [movementDirection, setMovementDirection] = useState<string>("stationary");
  const [enhancedBoundingBoxes, setEnhancedBoundingBoxes] = useState<EnhancedBoundingBox2D[]>([]);
  const objectTrackingMapRef = useRef<Map<string, { id: string, label: string, lastSeen: number }>>(new Map());
  const lastFrameTimeRef = useRef<number>(0);
  
  // Handling resize and aspect ratios
  const boundingBoxContainerRef = useRef<HTMLDivElement | null>(null);
  const [containerDims, setContainerDims] = useState({
    width: 0,
    height: 0,
  });
  const [activeMediaDimensions, setActiveMediaDimensions] = useState({
    width: 1,
    height: 1,
  });

  const onResize = useCallback(
    (el: ResizePayload) => {
      if (el.width && el.height) {
        setContainerDims({
          width: el.width,
          height: el.height,
        });
      }
    },
    [],
  );

  const { ref: containerRef } = useResizeDetector({ onResize });

  const boundingBoxContainer = useMemo(() => {
    const { width, height } = activeMediaDimensions;
    const aspectRatio = width / height;
    const containerAspectRatio = containerDims.width / containerDims.height;
    if (aspectRatio < containerAspectRatio) {
      return {
        height: containerDims.height,
        width: containerDims.height * aspectRatio,
      };
    } else {
      return {
        width: containerDims.width,
        height: containerDims.width / aspectRatio,
      };
    }
  }, [containerDims, activeMediaDimensions]);
  
  // Handle continuous frame processing for navigation mode
  useEffect(() => {
    let processingIntervalId: number | null = null;
    let lastProcessTime = 0;
    let intermediateFrameIntervalId: number | null = null;
    
    // Function to schedule intermediate frame captures between main API-processed frames
    const scheduleIntermediateFrames = () => {
      // Only schedule if we're navigating and video is ready
      if (!isNavigating || !videoReady) return;
      
      // Clear any existing interval
      if (intermediateFrameIntervalId !== null) {
        clearInterval(intermediateFrameIntervalId);
      }
      
      // Calculate the current interval between API calls
      const currentApiInterval = FRAME_PROCESSING_INTERVAL_MS + dynamicRateLimitBuffer;
      
      // Calculate interval for intermediate frames
      // We want to capture INTERMEDIATE_FRAMES_COUNT frames evenly spaced between API calls
      const intermediateInterval = Math.floor(currentApiInterval / (INTERMEDIATE_FRAMES_COUNT + 1));
      
      console.log(`Scheduling ${INTERMEDIATE_FRAMES_COUNT} intermediate frames every ${intermediateInterval}ms`);
      
      // Set up interval for capturing intermediate frames
      intermediateFrameIntervalId = window.setInterval(async () => {
        // Don't capture if we're in the middle of an API call or video isn't ready
        if (processingRef.current || !videoReady) return;
        
        // Calculate time since last API-processed frame
        const timeSinceLastApiFrame = Date.now() - lastProcessTime;
        
        // Only capture intermediate frames if we're in between API calls
        if (timeSinceLastApiFrame < currentApiInterval && timeSinceLastApiFrame > 200) {
          const frameItem = await captureIntermediateFrame();
          if (frameItem) {
            // Add to frame history (maintaining maximum size)
            setFrameHistory(prev => {
              const updatedHistory = [...prev, frameItem];
              if (updatedHistory.length > MAX_FRAME_HISTORY) {
                return updatedHistory.slice(-MAX_FRAME_HISTORY);
              }
              return updatedHistory;
            });
            console.log(`Captured intermediate frame at ${timeSinceLastApiFrame}ms after last API frame`);
          }
        }
      }, intermediateInterval);
    };
    
    const processFrame = async () => {
      // Only process frames if video is ready with valid dimensions
      if (!isNavigating || !videoRef.current || processingRef.current || !videoReady) {
        return;
      }
      
      const currentTime = Date.now();
      // Only process a new frame if enough time has passed since the last processing
      // Apply dynamic buffer if we've hit rate limits
      const currentInterval = FRAME_PROCESSING_INTERVAL_MS + dynamicRateLimitBuffer;
      if (currentTime - lastProcessTime < currentInterval) {
        return;
      }
      
      lastProcessTime = currentTime;
      
      try {
        processingRef.current = true;
        
        // Capture current frame to canvas
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        // Set canvas dimensions to match video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Extra safety check for video dimensions
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          console.error('Video has zero width or height despite videoReady being true');
          setVideoReady(false); // Reset the ready state
          processingRef.current = false;
          return;
        }
        
        // Draw the current video frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Get image data from canvas
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        
        // Validate that we got a proper data URL with content
        if (!dataUrl || dataUrl === 'data:,' || !dataUrl.includes('base64')) {
          console.error('Failed to get valid image data from canvas');
          setProcessingError('Camera data not available. Please check camera permissions.');
          processingRef.current = false;
          return;
        }
        
        // Calculate time since last frame
        const timeSinceLastFrame = currentTime - lastFrameTimeRef.current;
        lastFrameTimeRef.current = currentTime;
        
        // Detect movement direction based on time between frames
        const newMovementDirection = detectMovementDirection(timeSinceLastFrame);
        if (newMovementDirection !== movementDirection) {
          setMovementDirection(newMovementDirection);
        }
        
        // Process with Gemini, including context from previous frames
        await analyzeFrameWithContext(dataUrl);
        
        // After successful processing, schedule intermediate frames
        scheduleIntermediateFrames();
      } catch (err) {
        console.error('Error processing frame:', err);
      } finally {
        processingRef.current = false;
      }
    };
    
    // Simple movement detection based on time between frames
    const detectMovementDirection = (timeSinceLastFrame: number): string => {
      // If this is our first frame, assume stationary
      if (lastFrameTimeRef.current === 0) return "stationary";
      
      // If we have previous detections, we could analyze the change in object sizes/positions
      if (frameHistory.length >= 2 && enhancedBoundingBoxes.length > 0) {
        // Look at movement patterns of objects
        // This is where we'd implement more sophisticated movement detection
        // For now, we'll use a placeholder implementation
        return movementDirection; // Keep the current direction
      }
      
      return "stationary"; // Default
    };
    
    if (isNavigating && videoReady) {
      // Initial processing
      processFrame();
      
      // Set up interval for regular processing every FRAME_PROCESSING_INTERVAL_MS
      processingIntervalId = window.setInterval(processFrame, 1000); // Check every second, but only process based on interval
      
      console.log(`Starting navigation with ${FRAME_PROCESSING_INTERVAL_MS}ms between frames`);
    }
    
    return () => {
      if (processingIntervalId !== null) {
        window.clearInterval(processingIntervalId);
      }
    };
  }, [isNavigating, videoReady, frameHistory, enhancedBoundingBoxes, movementDirection]);
  
  // Function to analyze a frame with context from previous frames
  const analyzeFrameWithContext = async (dataUrl: string) => {
    try {
      // If we're already in a retry backoff, don't attempt a new API call
      if (retryTimeoutRef.current) {
        return;
      }
      
      // Reset the error state
      setProcessingError(null);
      
      // Create context from previous frames
      let contextPrompt = '';
      if (frameHistory.length > 0) {
        contextPrompt = "Previous context: ";
        
        // Add context from the last few frames
        frameHistory.forEach((frame, index) => {
          const timeAgo = Date.now() - frame.timestamp;
          const secondsAgo = Math.round(timeAgo / 1000);
          
          if (frame.detections && frame.detections.length > 0) {
            contextPrompt += `${secondsAgo} seconds ago I saw: ${frame.detections.map((d: any) => d.label).join(', ')}. `;
          }
        });
        
        // Add movement direction
        contextPrompt += `I am currently ${movementDirection}. `;
      }
      
      // Configure the prompt based on detection type
      let prompt = contextPrompt;
      
      if (detectType === '2D bounding boxes') {
        prompt += "Detect potential obstacles and hazards for a blind person. Output a json list where each entry contains the 2D bounding box in 'box_2d', a clear description in 'label', and an estimated distance in 'distance' (expressed in human terms like '3 footsteps away'). If you recognize objects from previous frames, indicate whether I'm approaching them or moving away from them.";
      } else if (detectType === '3D bounding boxes') {
        prompt += "Detect the 3D bounding boxes of obstacles and hazards for a blind person, output no more than 5 items. Return a list where each entry contains a clear description in 'label', its 3D bounding box in 'box_3d', and whether I'm approaching or moving away from this object based on previous frames.";
      } else {
        prompt += "Point to the critical obstacles or hazards for a blind person with no more than 5 items. The answer should follow the json format: [{\"point\": <point>, \"label\": <clear description>, \"distance\": <human readable distance>}, ...]. The points are in [y, x] format normalized to 0-1000.";
      }
      
      console.log('Using context-enhanced prompt:', prompt);
      
      const response = await client
        .getGenerativeModel(
          { model: "models/gemini-1.5-flash" },
          { apiVersion: 'v1beta' }
        )
        .generateContent({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    data: dataUrl.replace("data:image/jpeg;base64,", ""),
                    mimeType: "image/jpeg"
                  }
                }
              ]
            }
          ],
          generationConfig: { temperature: 0.2 }
        });
      
      // Reset retry count on successful request
      retryCountRef.current = 0;
      
      let responseText = response.response.text();
      
      // Extract JSON from response
      if (responseText.includes("```json")) {
        responseText = responseText.split("```json")[1].split("```")[0];
      } else if (responseText.includes("```")) {
        responseText = responseText.split("```")[1].split("```")[0];
      }
      
      // Safely parse the response, with fallback
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(responseText.trim());
        
        // Validate that parsedResponse is actually an array
        if (!Array.isArray(parsedResponse)) {
          console.error('API response is not an array:', parsedResponse);
          setProcessingError('Response format error. Using cached results.');
          return;
        }
      } catch (parseError) {
        console.error('Failed to parse API response:', parseError);
        console.log('Response text was:', responseText);
        setProcessingError('Failed to parse detection results. Using cached results.');
        return;
      }
      
      // Store the detections in frame history
      const newFrameHistoryItem: FrameHistoryItem = {
        timestamp: Date.now(),
        dataUrl: dataUrl,
        detections: parsedResponse,
        movementDirection: movementDirection
      };
      
      // Update the frame history (keep only the last MAX_FRAME_HISTORY frames)
      setFrameHistory(prev => {
        const updatedHistory = [...prev, newFrameHistoryItem];
        if (updatedHistory.length > MAX_FRAME_HISTORY) {
          return updatedHistory.slice(-MAX_FRAME_HISTORY);
        }
        return updatedHistory;
      });
      
      // Process the response based on detection type
      if (detectType === "2D bounding boxes") {
        try {
          // Format and enhance bounding boxes with contextual information
          const formattedBoxes = await processAndTrack2DBoundingBoxes(parsedResponse);
          
          if (formattedBoxes.length > 0) {
            console.log('Successfully formatted boxes with context:', formattedBoxes);
            setBoundingBoxes2D(formattedBoxes);
            setEnhancedBoundingBoxes(formattedBoxes);
          } else {
            console.warn('No valid 2D boxes found in response');
            setProcessingError('No valid obstacles detected. Using cached results.');
          }
        } catch (formatError) {
          console.error('Error formatting 2D boxes:', formatError);
          setProcessingError('Error processing detection data. Using cached results.');
        }
      } else if (detectType === "Points") {
        // Process points with context
        try {
          const formattedPoints = parsedResponse.map(
            (point: { point: [number, number]; label: string; distance?: string }) => {
              if (!point.point || !Array.isArray(point.point) || point.point.length !== 2) {
                throw new Error('Invalid point format');
              }
              
              return {
                point: {
                  x: point.point[1] / 1000,
                  y: point.point[0] / 1000,
                },
                label: point.distance ? `${point.label} (${point.distance})` : point.label || 'Unknown',
              };
            },
          );
          setPoints(formattedPoints);
        } catch (formatError) {
          console.error('Error formatting points:', formatError);
          setProcessingError('Error processing detection data. Using cached results.');
        }
      } else {
        // Process 3D boxes with context
        try {
          const formattedBoxes = parsedResponse.map(
            (box: {
              box_3d: [
                number, number, number, number, number, number, number, number, number,
              ];
              label: string;
              distance?: string;
              movement?: string;
            }) => {
              if (!box.box_3d || !Array.isArray(box.box_3d) || box.box_3d.length !== 9) {
                throw new Error('Invalid box_3d format');
              }
              const center = box.box_3d.slice(0, 3) as [number, number, number];
              const size = box.box_3d.slice(3, 6) as [number, number, number];
              const rpy = box.box_3d
                .slice(6)
                .map((x: number) => (x * Math.PI) / 180) as [number, number, number];
              
              // Add distance and movement information to label if available
              let enhancedLabel = box.label || 'Unknown';
              if (box.distance) {
                enhancedLabel += ` (${box.distance})`;
              }
              if (box.movement) {
                enhancedLabel += ` - ${box.movement}`;
              }
              
              return {
                center,
                size,
                rpy,
                label: enhancedLabel,
              };
            },
          );
          setBoundingBoxes3D(formattedBoxes);
        } catch (formatError) {
          console.error('Error formatting 3D boxes:', formatError);
          setProcessingError('Error processing detection data. Using cached results.');
        }
      }
    } catch (err: any) {
      console.error('Error analyzing frame with context:', err);
      
      // Handle rate limit errors specifically
      if (err?.message?.includes('429') || err?.message?.includes('quota')) {
        // Extract retry delay from error message if available
        let suggestedRetryDelay = 12000; // Default to 12s as seen in the error message
        try {
          // Try to extract the exact retry delay from the error message
          const retryDelayMatch = err.message.match(/retryDelay":"(\d+)s"/);
          if (retryDelayMatch && retryDelayMatch[1]) {
            suggestedRetryDelay = parseInt(retryDelayMatch[1]) * 1000; // Convert to milliseconds
            console.log(`API suggested retry delay: ${suggestedRetryDelay}ms`);
          }
        } catch (parseErr) {
          console.log('Could not parse retry delay, using default 12s');
        }
        
        const errorMessage = 'API rate limit exceeded. Using cached results and slowing down requests.';
        setProcessingError(errorMessage);
        
        // Implement exponential backoff as before, but respect the API's suggested retry delay
        retryCountRef.current += 1;
        const backoffDelay = Math.max(
          suggestedRetryDelay,
          Math.min(
            RETRY_DELAY_MS * Math.pow(2, retryCountRef.current - 1),
            MAX_RETRY_DELAY_MS
          )
        );
        
        if (retryTimeoutRef.current) {
          window.clearTimeout(retryTimeoutRef.current);
        }
        
        retryTimeoutRef.current = window.setTimeout(() => {
          retryTimeoutRef.current = null;
        }, backoffDelay);
        
        // Increase the dynamic rate limit buffer to slow down future requests
        // Make a more significant adjustment based on the API's suggested delay
        dynamicRateLimitBuffer += Math.max(RATE_LIMIT_BUFFER_INCREMENT, Math.floor(suggestedRetryDelay / 2));
        console.log(`Rate limit hit. Increasing frame interval to ${FRAME_PROCESSING_INTERVAL_MS + dynamicRateLimitBuffer}ms`);
        
        if (retryCountRef.current > MAX_RETRIES) {
          setProcessingError('Maximum retry attempts reached. Try again later or check your API quota.');
        }
      } else {
        setProcessingError('Error processing image. Will continue with cached results.');
      }
    }
  };

  // Function to capture a frame without sending it to the API
  const captureIntermediateFrame = async () => {
    if (!videoRef.current || !canvasRef.current || !videoReady) {
      return null;
    }
    
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      
      // Set canvas dimensions to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      // Draw the current video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Get image data from canvas at lower quality to save memory
      const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
      
      if (!dataUrl || dataUrl === 'data:,' || !dataUrl.includes('base64')) {
        return null;
      }
      
      // Create a frame history item without API detections
      const frameItem: FrameHistoryItem = {
        timestamp: Date.now(),
        dataUrl: dataUrl,
        detections: [],  // No AI detections for intermediate frames
        movementDirection: movementDirection,
        isKeyFrame: false // Flag as non-key frame (wasn't processed by API)
      };
      
      return frameItem;
    } catch (err) {
      console.error('Error capturing intermediate frame:', err);
      return null;
    }
  };

  // Map 3D boxes to lines for rendering
  const linesAndLabels3D = useMemo(() => {
    if (!boundingBoxContainer) {
      return null;
    }
    let allLines = [];
    let allLabels = [];
    for (const box of boundingBoxes3D) {
      const { center, size, rpy } = box;

      // Convert Euler angles to quaternion
      const [sr, sp, sy] = rpy.map((x) => Math.sin(x / 2));
      const [cr, cp, cz] = rpy.map((x) => Math.cos(x / 2));
      const quaternion = [
        sr * cp * cz - cr * sp * sy,
        cr * sp * cz + sr * cp * sy,
        cr * cp * sy - sr * sp * cz,
        cr * cp * cz + sr * sp * sy,
      ];

      // Calculate camera parameters
      const height = boundingBoxContainer.height;
      const width = boundingBoxContainer.width;
      const f = width / (2 * Math.tan(((fov / 2) * Math.PI) / 180));
      const cx = width / 2;
      const cy = height / 2;
      const intrinsics = [
        [f, 0, cx],
        [0, f, cy],
        [0, 0, 1],
      ];

      // Get box vertices
      const halfSize = size.map((s) => s / 2);
      let corners = [];
      for (let x of [-halfSize[0], halfSize[0]]) {
        for (let y of [-halfSize[1], halfSize[1]]) {
          for (let z of [-halfSize[2], halfSize[2]]) {
            corners.push([x, y, z]);
          }
        }
      }
      corners = [
        corners[1],
        corners[3],
        corners[7],
        corners[5],
        corners[0],
        corners[2],
        corners[6],
        corners[4],
      ];

      // Apply rotation from quaternion
      const q = quaternion;
      const rotationMatrix = [
        [
          1 - 2 * q[1] ** 2 - 2 * q[2] ** 2,
          2 * q[0] * q[1] - 2 * q[3] * q[2],
          2 * q[0] * q[2] + 2 * q[3] * q[1],
        ],
        [
          2 * q[0] * q[1] + 2 * q[3] * q[2],
          1 - 2 * q[0] ** 2 - 2 * q[2] ** 2,
          2 * q[1] * q[2] - 2 * q[3] * q[0],
        ],
        [
          2 * q[0] * q[2] - 2 * q[3] * q[1],
          2 * q[1] * q[2] + 2 * q[3] * q[0],
          1 - 2 * q[0] ** 2 - 2 * q[1] ** 2,
        ],
      ];

      const boxVertices = corners.map((corner) => {
        const rotated = matrixMultiply(rotationMatrix, corner);
        return rotated.map((val, idx) => val + center[idx]);
      });

      // Project 3D points to 2D
      const tiltAngle = 90.0;
      const viewRotationMatrix = [
        [1, 0, 0],
        [
          0,
          Math.cos((tiltAngle * Math.PI) / 180),
          -Math.sin((tiltAngle * Math.PI) / 180),
        ],
        [
          0,
          Math.sin((tiltAngle * Math.PI) / 180),
          Math.cos((tiltAngle * Math.PI) / 180),
        ],
      ];

      const points = boxVertices;
      const rotatedPoints = points.map((p) =>
        matrixMultiply(viewRotationMatrix, p),
      );
      const translatedPoints = rotatedPoints.map((p) => p.map((v) => v + 0));
      const projectedPoints = translatedPoints.map((p) =>
        matrixMultiply(intrinsics, p),
      );
      const vertices = projectedPoints.map((p) => [p[0] / p[2], p[1] / p[2]]);

      const topVertices = vertices.slice(0, 4);
      const bottomVertices = vertices.slice(4, 8);

      for (let i = 0; i < 4; i++) {
        const lines = [
          [topVertices[i], topVertices[(i + 1) % 4]],
          [bottomVertices[i], bottomVertices[(i + 1) % 4]],
          [topVertices[i], bottomVertices[i]],
        ];

        for (let [start, end] of lines) {
          const dx = end[0] - start[0];
          const dy = end[1] - start[1];
          const length = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx);

          allLines.push({ start, end, length, angle });
        }
      }

      // Add label with fade effect
      const textPosition3d = points[0].map(
        (_, idx) => points.reduce((sum, p) => sum + p[idx], 0) / points.length,
      );
      textPosition3d[2] += 0.1;

      const textPoint = matrixMultiply(
        intrinsics,
        matrixMultiply(
          viewRotationMatrix,
          textPosition3d.map((v) => v + 0),
        ),
      );
      const textPos = [
        textPoint[0] / textPoint[2],
        textPoint[1] / textPoint[2],
      ];
      allLabels.push({ label: box.label, pos: textPos });
    }
    return [allLines, allLabels] as const;
  }, [boundingBoxes3D, boundingBoxContainer, fov]);

  // Helper function for matrix multiplication
  function matrixMultiply(m: number[][], v: number[]): number[] {
    return m.map((row: number[]) =>
      row.reduce((sum, val, i) => sum + val * v[i], 0),
    );
  }

  // Add an effect to handle video initialization
  useEffect(() => {
    // Clear any existing timeout
    if (videoInitTimeoutRef.current) {
      clearTimeout(videoInitTimeoutRef.current);
      videoInitTimeoutRef.current = null;
    }
    
    // Reset video ready state when stream changes
    setVideoReady(false);
    
    if (stream && videoRef.current) {
      const checkVideoReady = () => {
        const video = videoRef.current;
        if (!video) return;
        
        // Check if the video has valid dimensions
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          console.log(`Video initialized with dimensions: ${video.videoWidth}x${video.videoHeight}`);
          setVideoReady(true);
        } else {
          // If not ready yet, try again in 100ms
          videoInitTimeoutRef.current = window.setTimeout(checkVideoReady, 100);
        }
      };
      
      // Start checking if video is ready
      videoInitTimeoutRef.current = window.setTimeout(checkVideoReady, 500);
      
      // Also set up event listeners for the video element
      const handleLoadedMetadata = () => {
        if (videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
          console.log('Video loaded metadata with dimensions:', videoRef.current.videoWidth, videoRef.current.videoHeight);
          setVideoReady(true);
        }
      };
      
      videoRef.current.addEventListener('loadedmetadata', handleLoadedMetadata);
      
      return () => {
        if (videoInitTimeoutRef.current) {
          clearTimeout(videoInitTimeoutRef.current);
        }
        
        if (videoRef.current) {
          videoRef.current.removeEventListener('loadedmetadata', handleLoadedMetadata);
        }
      };
    }
  }, [stream]);

  // Function to process and track 2D bounding boxes across frames
  const processAndTrack2DBoundingBoxes = async (parsedResponse: any[]): Promise<EnhancedBoundingBox2D[]> => {
    try {
      const currentTime = Date.now();
      const formattedBoxes: EnhancedBoundingBox2D[] = [];
      
      for (const item of parsedResponse) {
        // Extract label, distance and any movement info provided by AI
        let label = item.label || item.description || item.name || item.class || item.category || 'Unknown';
        const distance = item.distance || null;
        const aiMovement = item.movement || null;
        
        // Extract the bounding box coordinates (reusing existing box extraction code)
        let box2D = null;
        
        // Case 1: Standard format [ymin, xmin, ymax, xmax]
        if (item.box_2d && Array.isArray(item.box_2d) && item.box_2d.length === 4) {
          box2D = item.box_2d;
        }
        // Case 2: Format with separate coordinates like {xmin, ymin, xmax, ymax}
        else if (item.bounding_box || item.bbox || item.box) {
          const bbox = item.bounding_box || item.bbox || item.box;
          if (bbox) {
            if (Array.isArray(bbox) && bbox.length === 4) {
              box2D = [bbox[1], bbox[0], bbox[3], bbox[2]]; // Convert [xmin,ymin,xmax,ymax] to [ymin,xmin,ymax,xmax]
            } else if (typeof bbox === 'object') {
              // Handle object with properties like {x, y, width, height} or {xmin, ymin, xmax, ymax}
              if ('x' in bbox && 'y' in bbox && 'width' in bbox && 'height' in bbox) {
                box2D = [
                  bbox.y, 
                  bbox.x, 
                  bbox.y + bbox.height, 
                  bbox.x + bbox.width
                ];
              } else if ('xmin' in bbox && 'ymin' in bbox && 'xmax' in bbox && 'ymax' in bbox) {
                box2D = [bbox.ymin, bbox.xmin, bbox.ymax, bbox.xmax];
              }
            }
          }
        }
        // Case 3: Direct coordinates in the object
        else if ('xmin' in item && 'ymin' in item && 'xmax' in item && 'ymax' in item) {
          box2D = [item.ymin, item.xmin, item.ymax, item.xmax];
        }
        // Case 4: Format with position and dimensions
        else if ('x' in item && 'y' in item && ('width' in item || 'w' in item) && ('height' in item || 'h' in item)) {
          const width = item.width || item.w;
          const height = item.height || item.h;
          box2D = [item.y, item.x, item.y + height, item.x + width];
        }
        // Handle other cases from original code...
        
        // If we found a valid box format, process it with context tracking
        if (box2D) {
          // Convert any string values to numbers
          const [ymin, xmin, ymax, xmax] = box2D.map((v: any) => typeof v === 'string' ? parseFloat(v) : v);
          
          // Normalize to 0-1 range if the values are in pixel coordinates (>10)
          const normalizeFactor = Math.max(...box2D) > 10 ? 1000 : 1;
          
          // Calculate box size (area) for comparison with previous frames
          const width = (xmax - xmin) / normalizeFactor;
          const height = (ymax - ymin) / normalizeFactor;
          const x = xmin / normalizeFactor;
          const y = ymin / normalizeFactor;
          const boxSize = width * height;
          
          // Generate a unique ID for the object based on position and label
          // This helps track the same object across frames
          const boxCenter = { x: x + width/2, y: y + height/2 };
          const boxId = `${label.toLowerCase().replace(/\s+/g, '-')}-${boxCenter.x.toFixed(2)}-${boxCenter.y.toFixed(2)}`;
          
          // Look for this object in previous frames (by matching object IDs or finding closest match)
          let movement: "approaching" | "receding" | "stationary" | "left" | "right" = "stationary";
          let prevSize = null;
          
          // Check if we have tracked this object before
          const trackedObject = objectTrackingMapRef.current.get(boxId);
          
          if (trackedObject) {
            // We found the same object from a previous frame
            // Now find this object in our previous enhanced bounding boxes to get its previous size
            const prevBox = enhancedBoundingBoxes.find(box => box.id === boxId);
            
            if (prevBox && prevBox.prevSize) {
              prevSize = prevBox.prevSize;
              
              // Compare current size with previous size to determine movement
              const sizeDiff = boxSize - prevSize;
              const sizeDiffPercent = sizeDiff / prevSize;
              
              // Object is approaching if it's getting bigger (threshold: 5% bigger)
              if (sizeDiffPercent > 0.05) {
                movement = "approaching";
              } 
              // Object is receding if it's getting smaller (threshold: 5% smaller)
              else if (sizeDiffPercent < -0.05) {
                movement = "receding";
              }
              // Otherwise consider it stationary
              else {
                movement = "stationary";
              }
            }
            
            // Update the last seen timestamp for this object
            objectTrackingMapRef.current.set(boxId, {
              ...trackedObject,
              lastSeen: currentTime
            });
          } else {
            // This is a new object we haven't seen before
            objectTrackingMapRef.current.set(boxId, {
              id: boxId,
              label: label,
              lastSeen: currentTime
            });
          }
          
          // Override our calculated movement with AI-provided movement if available
          if (aiMovement) {
            if (aiMovement.toLowerCase().includes('approach')) {
              movement = "approaching";
            } else if (aiMovement.toLowerCase().includes('reced') || 
                      aiMovement.toLowerCase().includes('away') ||
                      aiMovement.toLowerCase().includes('further')) {
              movement = "receding";
            } else if (aiMovement.toLowerCase().includes('left')) {
              movement = "left";
            } else if (aiMovement.toLowerCase().includes('right')) {
              movement = "right";
            }
          }
          
          // Enhance the label with distance and movement information
          let enhancedLabel = label;
          if (distance) {
            enhancedLabel += ` (${distance})`;
          }
          if (movement !== "stationary") {
            enhancedLabel += ` - ${movement}`;
          }
          
          // Add the enhanced box to our results
          formattedBoxes.push({
            x,
            y,
            width,
            height,
            label: enhancedLabel,
            id: boxId,
            distance: distance,
            movement: movement,
            prevSize: boxSize // Store current size as prevSize for next frame
          });
        }
      }
      
      // Clean up stale entries from the tracking map (objects not seen recently)
      const staleThresholdMs = 30000; // 30 seconds
      objectTrackingMapRef.current.forEach((value, key) => {
        if (currentTime - value.lastSeen > staleThresholdMs) {
          objectTrackingMapRef.current.delete(key);
        }
      });
      
      return formattedBoxes;
    } catch (error) {
      console.error('Error processing and tracking bounding boxes:', error);
      return [];
    }
  };

  return (
    <div ref={containerRef} className="w-full grow relative">
      {stream ? (
        <video
          className="absolute top-0 left-0 w-full h-full object-contain"
          autoPlay
          playsInline
          muted
          onLoadedMetadata={(e) => {
            setActiveMediaDimensions({
              width: e.currentTarget.videoWidth,
              height: e.currentTarget.videoHeight,
            });
          }}
          ref={(video) => {
            videoRef.current = video;
            if (video && !video.srcObject) {
              video.srcObject = stream;
            }
          }}
        />
      ) : imageSrc ? (
        <img
          src={imageSrc}
          className="absolute top-0 left-0 w-full h-full object-contain"
          alt="Uploaded image"
          onLoad={(e) => {
            setActiveMediaDimensions({
              width: e.currentTarget.naturalWidth,
              height: e.currentTarget.naturalHeight,
            });
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-white">
          <div className="text-center p-4">
            <div className="text-4xl mb-4">🔍</div>
            <div className="text-xl">Start navigation to use the camera</div>
          </div>
        </div>
      )}
      
      {/* Hidden canvas for frame capture */}
      <canvas 
        ref={canvasRef} 
        className="hidden"
      />
      
      <div
        className="absolute w-full h-full left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2"
        ref={boundingBoxContainerRef}
        style={{
          width: boundingBoxContainer?.width,
          height: boundingBoxContainer?.height,
        }}
      >
        {/* Video initialization loading indicator */}
        {isNavigating && !videoReady && (
          <div className="absolute top-4 left-4 right-4 bg-yellow-600 text-white p-3 rounded-lg z-20 shadow-lg">
            <div className="flex items-center gap-2">
              <span className="text-lg">⌛</span>
              <span>Initializing camera feed... Please wait.</span>
            </div>
          </div>
        )}
        
        {/* Error Message for API rate limits */}
        {processingError && (
          <div className="absolute top-4 left-4 right-4 bg-red-600 text-white p-3 rounded-lg z-20 shadow-lg">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <span>{processingError}</span>
            </div>
          </div>
        )}
        
        {/* Navigation Guide - a center point indicator */}
        {isNavigating && (
          <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <div className="w-12 h-12 rounded-full border-2 border-white opacity-70 flex items-center justify-center">
              <div className="w-2 h-2 bg-white rounded-full"></div>
            </div>
          </div>
        )}
        
        {/* 2D Bounding boxes */}
        {detectType === "2D bounding boxes" &&
          boundingBoxes2D.map((box, i) => (
            <div
              key={i}
              className="absolute bbox border-2 border-[#3B68FF]"
              style={{
                transformOrigin: "0 0",
                top: box.y * 100 + "%",
                left: box.x * 100 + "%",
                width: box.width * 100 + "%",
                height: box.height * 100 + "%",
              }}
            >
              <div className="bg-[#3B68FF] text-white absolute left-0 top-0 text-sm px-1">
                {box.label}
              </div>
            </div>
          ))}
          
        {/* Points */}
        {detectType === "Points" &&
          points.map((point, i) => {
            return (
              <div
                key={i}
                className="absolute"
                style={{
                  left: `${point.point.x * 100}%`,
                  top: `${point.point.y * 100}%`,
                }}
              >
                <div className="absolute bg-[#3B68FF] text-center text-white text-xs px-1 bottom-4 rounded-sm -translate-x-1/2 left-1/2">
                  {point.label}
                </div>
                <div className="absolute w-4 h-4 bg-[#3B68FF] rounded-full border-white border-[2px] -translate-x-1/2 -translate-y-1/2"></div>
              </div>
            );
          })}
          
        {/* 3D Bounding Boxes */}
        {detectType === "3D bounding boxes" && linesAndLabels3D ? (
          <>
            {linesAndLabels3D[0].map((line, i) => (
              <div
                key={i}
                className="absolute h-[2px] bg-[#3B68FF]"
                style={{
                  width: `${line.length}px`,
                  transform: `translate(${line.start[0]}px, ${line.start[1]}px) rotate(${line.angle}rad)`,
                  transformOrigin: "0 0",
                }}
              ></div>
            ))}
            {linesAndLabels3D[1].map((label, i) => (
              <div
                key={i}
                className="absolute bg-[#3B68FF] text-white text-xs px-1"
                style={{
                  top: `${label.pos[1]}px`,
                  left: `${label.pos[0]}px`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                {label.label}
              </div>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
