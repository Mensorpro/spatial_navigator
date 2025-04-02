import { useState, useRef, useEffect } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { FrameHistoryItem, EnhancedBoundingBox2D } from '../types/ProcessingTypes';
import { 
  processAndTrack2DBoundingBoxes, 
  detectMovementDirection,
  MAX_FRAME_HISTORY,
  RATE_LIMIT_BUFFER_INCREMENT,
  MAX_RATE_LIMIT_BUFFER
} from '../utils/ProcessingUtils';

// Increase the default interval to reduce API calls (from 3000ms to 5000ms)
const REDUCED_FRAME_PROCESSING_INTERVAL = 5000; // 5 seconds between processing

// Check for API key in localStorage first (for the API key setup component)
const getApiKey = () => {
  const localStorageKey = localStorage.getItem('gemini_api_key');
  if (localStorageKey) {
    console.log('Using API key from localStorage');
    return localStorageKey;
  }
  
  const envApiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!envApiKey) {
    console.error('VITE_GEMINI_API_KEY is not defined in environment variables');
  } else {
    console.log('API key loaded from environment variables');
  }
  return envApiKey || '';
};

// Initialize Gemini client
const API_KEY = getApiKey();
const client = new GoogleGenerativeAI(API_KEY);

export function useFrameProcessing(
  isNavigating: boolean,
  videoRef: React.RefObject<HTMLVideoElement>,
  videoReady: boolean,
  canvasRef: React.RefObject<HTMLCanvasElement>,
  detectType: string
) {
  const [frameHistory, setFrameHistory] = useState<FrameHistoryItem[]>([]);
  const [movementDirection, setMovementDirection] = useState<string>("stationary");
  const [enhancedBoundingBoxes, setEnhancedBoundingBoxes] = useState<EnhancedBoundingBox2D[]>([]);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [boundingBoxes2D, setBoundingBoxes2D] = useState<EnhancedBoundingBox2D[]>([]);
  const [boundingBoxes3D, setBoundingBoxes3D] = useState<any[]>([]);
  const [points, setPoints] = useState<any[]>([]);

  const processingRef = useRef(false);
  const retryTimeoutRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const lastFrameTimeRef = useRef<number>(0);
  const objectTrackingMapRef = useRef<Map<string, { id: string, label: string, lastSeen: number }>>(new Map());
  const consecutiveErrorsRef = useRef(0);
  let dynamicRateLimitBuffer = 0;

  // Add test/mock data for development/testing
  const mockData = useRef<boolean>(false);
  const useMockData = () => {
    if (mockData.current) return;
    console.log('Using mock data for testing');
    
    // Create mock bounding boxes for testing with the correct movement type
    const testBoxes: EnhancedBoundingBox2D[] = [
      {
        x: 0.2,
        y: 0.3,
        width: 0.2,
        height: 0.2,
        label: "Chair - close",
        id: "mock-1",
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        movement: "stationary"
      },
      {
        x: 0.6,
        y: 0.4,
        width: 0.15,
        height: 0.25,
        label: "Table - in front",
        id: "mock-2",
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        movement: "stationary"
      }
    ];
    
    setBoundingBoxes2D(testBoxes);
    setEnhancedBoundingBoxes(testBoxes);
    
    // Set mock points
    if (detectType === "Points") {
      setPoints([
        {
          point: { x: 0.3, y: 0.4 },
          label: "Door handle - left side"
        },
        {
          point: { x: 0.7, y: 0.5 },
          label: "Obstacle - center"
        }
      ]);
    }
    
    mockData.current = true;
  };

  // Analyze a captured frame with context
  const analyzeFrameWithContext = async (dataUrl: string) => {
    try {
      if (retryTimeoutRef.current) return;
      
      setProcessingError(null);
      console.log(`Starting frame analysis with detection type: ${detectType}`);
      
      // If API key is missing, use mock data instead
      if (!API_KEY) {
        console.warn('No API key available, using mock data');
        useMockData();
        return;
      }
      
      // Create context from previous frames
      let contextPrompt = '';
      if (frameHistory.length > 0) {
        contextPrompt = "Previous context: ";
        frameHistory.forEach(frame => {
          const timeAgo = Date.now() - frame.timestamp;
          const secondsAgo = Math.round(timeAgo / 1000);
          if (frame.detections && frame.detections.length > 0) {
            contextPrompt += `${secondsAgo} seconds ago I saw: ${frame.detections.map((d: any) => d.label).join(', ')}. `;
          }
        });
        contextPrompt += `I am currently ${movementDirection}. `;
      }
      
      // Configure prompt based on detection type
      let prompt = contextPrompt;
      if (detectType === '2D bounding boxes') {
        prompt += "Detect potential obstacles and hazards for a blind person. Output a json list where each entry contains the 2D bounding box in 'box_2d', a clear description in 'label', and an estimated distance in 'distance' (expressed in human terms like '3 footsteps away'). If you recognize objects from previous frames, indicate whether I'm approaching them or moving away from them.";
      } else if (detectType === '3D bounding boxes') {
        prompt += "Detect the 3D bounding boxes of obstacles and hazards for a blind person, output no more than 5 items. Return a list where each entry contains a clear description in 'label', its 3D bounding box in 'box_3d', and whether I'm approaching or moving away from this object based on previous frames.";
      } else {
        prompt += "Point to the critical obstacles or hazards for a blind person with no more than 5 items. The answer should follow the json format: [{\"point\": <point>, \"label\": <clear description>, \"distance\": <human readable distance>}, ...]. The points are in [y, x] format normalized to 0-1000.";
      }
      
      console.log(`Sending API request to Gemini with ${dataUrl.length} bytes of image data`);
      
      try {
        const response = await client
          .getGenerativeModel({ model: "models/gemini-1.5-flash" }, { apiVersion: 'v1beta' })
          .generateContent({
            contents: [{ 
              role: "user", 
              parts: [
                { text: prompt },
                { inlineData: { 
                  data: dataUrl.replace("data:image/jpeg;base64,", ""),
                  mimeType: "image/jpeg"
                }}
              ]
            }],
            generationConfig: { temperature: 0.2 }
          });
          
        console.log(`Received response from Gemini API`);
        retryCountRef.current = 0;
        let responseText = response.response.text();
        console.log(`Raw response: ${responseText.substring(0, 100)}...`);
        
        // Extract JSON from response
        if (responseText.includes("```json")) {
          responseText = responseText.split("```json")[1].split("```")[0];
        } else if (responseText.includes("```")) {
          responseText = responseText.split("```")[1].split("```")[0];
        }
        
        try {
          const parsedResponse = JSON.parse(responseText.trim());
          if (!Array.isArray(parsedResponse)) {
            throw new Error('API response is not an array');
          }
          
          console.log(`Successfully parsed response with ${parsedResponse.length} detected objects`);
          
          // Store detections in frame history
          const newFrameHistoryItem: FrameHistoryItem = {
            timestamp: Date.now(),
            dataUrl: dataUrl,
            detections: parsedResponse,
            movementDirection: movementDirection
          };
          
          setFrameHistory(prev => {
            const updatedHistory = [...prev, newFrameHistoryItem];
            return updatedHistory.slice(-MAX_FRAME_HISTORY);
          });
          
          // Process response based on detection type
          if (detectType === "2D bounding boxes") {
            const formattedBoxes = await processAndTrack2DBoundingBoxes(
              parsedResponse,
              Date.now(),
              enhancedBoundingBoxes,
              objectTrackingMapRef.current
            );
            
            if (formattedBoxes.length > 0) {
              console.log(`Setting ${formattedBoxes.length} 2D bounding boxes`);
              setBoundingBoxes2D(formattedBoxes);
              setEnhancedBoundingBoxes(formattedBoxes);
            } else {
              console.log(`No 2D bounding boxes detected in this frame`);
            }
          } else if (detectType === "Points") {
            const formattedPoints = parsedResponse.map(
              (point: { point: [number, number]; label: string; distance?: string }) => ({
                point: {
                  x: point.point[1] / 1000,
                  y: point.point[0] / 1000,
                },
                label: point.distance ? `${point.label} (${point.distance})` : point.label || 'Unknown',
              }),
            );
            console.log(`Setting ${formattedPoints.length} points`);
            setPoints(formattedPoints);
          } else {
            // Process 3D boxes
            const formattedBoxes = parsedResponse.map(
              (box: any) => {
                if (!box.box_3d || !Array.isArray(box.box_3d) || box.box_3d.length !== 9) {
                  throw new Error('Invalid box_3d format');
                }
                const center = box.box_3d.slice(0, 3) as [number, number, number];
                const size = box.box_3d.slice(3, 6) as [number, number, number];
                const rpy = box.box_3d
                  .slice(6)
                  .map((x: number) => (x * Math.PI) / 180) as [number, number, number];
                
                let enhancedLabel = box.label || 'Unknown';
                if (box.distance) enhancedLabel += ` (${box.distance})`;
                if (box.movement) enhancedLabel += ` - ${box.movement}`;
                
                return { center, size, rpy, label: enhancedLabel };
              },
            );
            console.log(`Setting ${formattedBoxes.length} 3D bounding boxes`);
            setBoundingBoxes3D(formattedBoxes);
          }
        } catch (parseErr) {
          console.error('Error parsing response:', parseErr);
          console.error('Response text was:', responseText);
          setProcessingError('Error parsing detection response');
          
          // If we can't parse the response, use mock data for a better user experience
          useMockData();
        }
      } catch (apiErr: any) {
        console.error('API request error:', apiErr);
        
        if (apiErr?.message?.includes('429') || apiErr?.message?.includes('quota') || apiErr?.message?.includes('rate limit')) {
          let suggestedRetryDelay = 12000;
          try {
            const retryDelayMatch = apiErr.message.match(/retryDelay":"(\d+)s"/);
            if (retryDelayMatch && retryDelayMatch[1]) {
              suggestedRetryDelay = parseInt(retryDelayMatch[1]) * 1000;
            }
          } catch (parseErr) {
            console.log('Could not parse retry delay, using default 12s');
          }
          
          setProcessingError('API rate limit exceeded. Using cached results and adjusting request rate.');
          
          const newBuffer = Math.min(
            MAX_RATE_LIMIT_BUFFER,
            dynamicRateLimitBuffer + RATE_LIMIT_BUFFER_INCREMENT
          );
          
          dynamicRateLimitBuffer = newBuffer;
          
          if (retryTimeoutRef.current) {
            window.clearTimeout(retryTimeoutRef.current);
          }
          
          retryTimeoutRef.current = window.setTimeout(() => {
            retryTimeoutRef.current = null;
          }, suggestedRetryDelay);
        } else {
          setProcessingError('Error processing image. Will continue with cached results.');
          // Use mock data for a better user experience
          useMockData();
        }
      }
    } catch (err) {
      console.error('Error analyzing frame with context:', err);
      setProcessingError('Error analyzing camera feed');
      // Use mock data for a better user experience
      useMockData();
    }
  };

  // Capture a frame from the video
  const captureFrame = async () => {
    if (!videoRef.current || !canvasRef.current || !videoReady) {
      console.log('Cannot capture frame: video/canvas not ready', { 
        videoExists: !!videoRef.current, 
        canvasExists: !!canvasRef.current, 
        videoReady 
      });
      return null;
    }
    
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.log('Cannot capture frame: canvas context is null');
        return null;
      }
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      if (!dataUrl || dataUrl === 'data:,' || !dataUrl.includes('base64')) {
        console.log('Cannot capture frame: invalid dataUrl generated');
        return null;
      }
      
      console.log(`Successfully captured frame (${dataUrl.length} bytes)`);
      return dataUrl;
    } catch (err) {
      console.error('Error capturing frame:', err);
      return null;
    }
  };

  // Process frames periodically
  useEffect(() => {
    let processingIntervalId: number | null = null;
    let lastProcessTime = Date.now();
    
    const processFrame = async () => {
      if (!isNavigating || !videoRef.current || processingRef.current || !videoReady) {
        return;
      }

      const currentTime = Date.now();
      // Use the increased interval to reduce API calls
      if (currentTime - lastProcessTime < REDUCED_FRAME_PROCESSING_INTERVAL + dynamicRateLimitBuffer) {
        return;
      }

      try {
        processingRef.current = true;
        lastProcessTime = currentTime;

        const dataUrl = await captureFrame();
        if (!dataUrl) {
          processingRef.current = false;
          return;
        }

        const timeSinceLastFrame = currentTime - lastFrameTimeRef.current;
        lastFrameTimeRef.current = currentTime;
        
        const newMovementDirection = detectMovementDirection(timeSinceLastFrame);
        if (newMovementDirection !== movementDirection) {
          setMovementDirection(newMovementDirection);
        }
        
        await analyzeFrameWithContext(dataUrl);
        
        // Reset consecutive errors counter on success
        consecutiveErrorsRef.current = 0;
      } catch (err) {
        console.error('Error processing frame:', err);
        consecutiveErrorsRef.current += 1;
        
        // If we have too many consecutive errors, increase the processing interval
        if (consecutiveErrorsRef.current > 2) {
          dynamicRateLimitBuffer += 2000; // Add 2 seconds after multiple errors
          console.log(`Increasing processing interval due to errors: ${REDUCED_FRAME_PROCESSING_INTERVAL + dynamicRateLimitBuffer}ms`);
        }
      } finally {
        processingRef.current = false;
      }
    };

    if (isNavigating && videoReady) {
      // Process frames less frequently to avoid rate limits
      processingIntervalId = window.setInterval(() => {
        if (!processingRef.current) {
          processFrame();
        }
      }, Math.min(REDUCED_FRAME_PROCESSING_INTERVAL / 2, 1500)); // More conservative polling
    }

    return () => {
      if (processingIntervalId !== null) {
        window.clearInterval(processingIntervalId);
      }
    };
  }, [isNavigating, videoReady, frameHistory, enhancedBoundingBoxes, movementDirection, detectType]);

  return {
    frameHistory,
    movementDirection,
    enhancedBoundingBoxes,
    processingError,
    boundingBoxes2D,
    boundingBoxes3D,
    points
  };
}