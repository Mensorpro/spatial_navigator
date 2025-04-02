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

import { useEffect, useState, useRef } from 'react';
import { useAtom } from 'jotai';
import { BoundingBoxes2DAtom, BoundingBoxes3DAtom, PointsAtom, DetectTypeAtom, availableVoicesAtom, selectedVoiceAtom, preferredVoiceNameAtom } from './atoms';

// Speech timing constants
const SPEECH_DELAY_MS = 500;       // Shorter delay before speaking
const SPEECH_COOLDOWN_MS = 3000;   // Minimum time between announcements
const SCENE_SUMMARY_INTERVAL = 20000; // Give scene summary every 20 seconds
const PATH_GUIDANCE_INTERVAL = 6000; // Give path guidance every 6 seconds

export function SpeechFeedback() {
  const [boundingBoxes2D] = useAtom(BoundingBoxes2DAtom);
  const [boundingBoxes3D] = useAtom(BoundingBoxes3DAtom);
  const [points] = useAtom(PointsAtom);
  const [detectType] = useAtom(DetectTypeAtom);
  const [lastSpoken, setLastSpoken] = useState('');
  const [lastSpeechTime, setLastSpeechTime] = useState(0);
  const [lastSceneSummaryTime, setLastSceneSummaryTime] = useState(0);
  const [lastPathGuidanceTime, setLastPathGuidanceTime] = useState(0);
  const speakTimeoutRef = useRef<number | null>(null);
  const speechInProgressRef = useRef<boolean>(false);
  const [detectionHistory, setDetectionHistory] = useState<Array<{label: string, count: number, lastSeen: number}>>([]);
  
  // Track available paths and navigation guidance
  const [navigationData, setNavigationData] = useState<{
    paths: string[],
    safeDirection: string,
    warnings: string[],
    lastUpdated: number
  }>({
    paths: [],
    safeDirection: "",
    warnings: [],
    lastUpdated: 0
  });

  // Voice selection state
  const [availableVoices, setAvailableVoices] = useAtom(availableVoicesAtom);
  const [selectedVoice, setSelectedVoice] = useAtom(selectedVoiceAtom);
  const [preferredVoiceName, setPreferredVoiceName] = useAtom(preferredVoiceNameAtom);

  // Get available voices when component mounts and when voiceschanged event fires
  useEffect(() => {
    const loadVoices = () => {
      if ('speechSynthesis' in window) {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          setAvailableVoices(voices);
          
          // If no voice is selected yet, try to select a good default
          if (!selectedVoice) {
            if (preferredVoiceName) {
              const savedVoice = voices.find(v => v.name === preferredVoiceName);
              if (savedVoice) {
                setSelectedVoice(savedVoice);
                return;
              }
            }
            
            // Look for natural voice identifiers
            const naturalVoicePatterns = [
                /neural/i, /natural/i, /enhanced/i, /premium/i,
                /wavenet/i, /online/i, /plus/i, /modern/i
            ];
            
            // Try to find a neural/natural English voice
            const naturalEnglishVoice = voices.find(v => 
                v.lang.startsWith('en') && 
                naturalVoicePatterns.some(pattern => pattern.test(v.name))
            );
            
            if (naturalEnglishVoice) {
                setSelectedVoice(naturalEnglishVoice);
                setPreferredVoiceName(naturalEnglishVoice.name);
                return;
            }
            
            // Next try any English voice
            const englishVoice = voices.find(v => v.lang.startsWith('en'));
            if (englishVoice) {
                setSelectedVoice(englishVoice);
                setPreferredVoiceName(englishVoice.name);
                return;
            }
            
            // Fallback to first voice
            if (voices.length > 0) {
                setSelectedVoice(voices[0]);
                setPreferredVoiceName(voices[0].name);
            }
          }
        }
      }
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, []);

  // Update detection history for scene summary
  useEffect(() => {
    const updateDetectionHistory = () => {
      const currentTime = Date.now();
      const newObjects = new Set<string>();
      
      // Add all current objects to the set
      if (detectType === '2D bounding boxes') {
        boundingBoxes2D.forEach(box => newObjects.add(box.label));
      } else if (detectType === '3D bounding boxes') {
        boundingBoxes3D.forEach(box => newObjects.add(box.label));
      } else if (points.length > 0) {
        points.forEach(point => newObjects.add(point.label));
      }
      
      // Extract navigation data from object labels or special fields
      let paths: string[] = [];
      let safeDirection = "";
      let warnings: string[] = [];
      
      // Look for navigation cues in the objects
      if (detectType === '2D bounding boxes') {
        // Check for navigation information in box labels
        boundingBoxes2D.forEach(box => {
          const label = box.label.toLowerCase();
          
          // Extract path information
          if (label.includes("path") || label.includes("way") || label.includes("door") || 
              label.includes("corridor") || label.includes("left") || label.includes("right") ||
              label.includes("ahead") || label.includes("exit")) {
            
            // Try to construct a clear path instruction
            let pathDirection = "";
            
            if (label.includes("left")) pathDirection = "to your left";
            else if (label.includes("right")) pathDirection = "to your right";
            else if (label.includes("ahead") || label.includes("forward")) pathDirection = "straight ahead";
            
            // If no direction was found in the label, use box position
            if (!pathDirection) {
              const centerX = box.x + box.width/2;
              if (centerX < 0.4) pathDirection = "to your left";
              else if (centerX > 0.6) pathDirection = "to your right";
              else pathDirection = "straight ahead";
            }
            
            // Construct full path description
            let pathDescription = "";
            if (label.includes("clear path")) {
              pathDescription = `Clear path ${pathDirection}`;
            } else if (label.includes("door")) {
              pathDescription = `Door ${pathDirection}`;
            } else if (label.includes("exit")) {
              pathDescription = `Exit ${pathDirection}`;
            } else if (label.includes("corridor")) {
              pathDescription = `Corridor ${pathDirection}`;
            } else if (label.includes("blocked")) {
              pathDescription = `Path ${pathDirection} is blocked`;
              warnings.push(`Path ${pathDirection} is blocked`);
            } else {
              pathDescription = `Possible path ${pathDirection}`;
            }
            
            // Add to paths if it's not a blocked path
            if (!label.includes("blocked") && !label.includes("no path")) {
              paths.push(pathDescription);
            }
          }
          
          // Extract warning information
          if (label.includes("caution") || label.includes("warning") || 
              label.includes("danger") || label.includes("obstacle") ||
              label.includes("hazard") || label.includes("careful") ||
              label.includes("watch out")) {
            
            // Create a more specific warning message
            const boxCenterX = box.x + box.width/2;
            const boxCenterY = box.y + box.height/2;
            let locationDetail = "";
            
            if (boxCenterX < 0.4) locationDetail = "on your left";
            else if (boxCenterX > 0.6) locationDetail = "on your right";
            else locationDetail = "in front of you";
            
            if (boxCenterY > 0.7) locationDetail += ", very close";
            
            const warningMsg = `Caution: ${box.label} ${locationDetail}`;
            warnings.push(warningMsg);
          }
        });
        
        // Determine safest direction based on obstacles and paths
        if (paths.length > 0) {
          // Prefer forward path if available
          const forwardPath = paths.find(p => 
            p.includes("straight ahead") && !p.includes("blocked"));
          
          if (forwardPath) {
            safeDirection = "Continue straight ahead carefully";
          } else {
            // Otherwise suggest the first available path
            const safePath = paths[0];
            if (safePath.includes("left")) {
              safeDirection = "Turn left and proceed carefully";
            } else if (safePath.includes("right")) {
              safeDirection = "Turn right and proceed carefully";
            } else {
              safeDirection = "Proceed carefully toward the available path";
            }
          }
        } else {
          // If no paths detected, recommend caution
          const obstacles = boundingBoxes2D.filter(box => {
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;
            return centerX > 0.3 && centerX < 0.7 && centerY > 0.5;
          });
          
          if (obstacles.length > 0) {
            safeDirection = "Stop and scan around for a clear path";
          } else {
            safeDirection = "Proceed very slowly and scan for obstacles";
          }
        }
      }
      
      // Look for navigation field in any object (often provided by the API)
      const navigationObjects = Array.from(newObjects)
        .filter(label => 
          label.toLowerCase().includes("path") || 
          label.toLowerCase().includes("navigation") ||
          label.toLowerCase().includes("direction"));
      
      if (navigationObjects.length > 0) {
        // Use these as additional navigation cues
        navigationObjects.forEach(navLabel => {
          const navInfo = navLabel.toLowerCase();
          
          if (navInfo.includes("left") && !paths.some(p => p.includes("left"))) {
            paths.push("Path to your left");
          }
          if (navInfo.includes("right") && !paths.some(p => p.includes("right"))) {
            paths.push("Path to your right");
          }
          if (navInfo.includes("ahead") && !paths.some(p => p.includes("ahead"))) {
            paths.push("Path straight ahead");
          }
          if (navInfo.includes("blocked") && !warnings.some(w => w.includes("blocked"))) {
            warnings.push("Warning: Blocked path detected");
          }
        });
      }
      
      // Update navigation data if we have new information
      if (paths.length > 0 || safeDirection || warnings.length > 0) {
        setNavigationData({
          paths,
          safeDirection,
          warnings,
          lastUpdated: currentTime
        });
      }
      
      // Update detection history
      setDetectionHistory(prev => {
        const updated = [...prev];
        
        // Process current detections
        newObjects.forEach(label => {
          const existing = updated.findIndex(item => item.label === label);
          if (existing >= 0) {
            updated[existing] = {
              ...updated[existing],
              count: updated[existing].count + 1,
              lastSeen: currentTime
            };
          } else {
            updated.push({ label, count: 1, lastSeen: currentTime });
          }
        });
        
        // Remove stale items (over 30 seconds old)
        return updated.filter(item => currentTime - item.lastSeen < 30000)
          .sort((a, b) => b.count - a.count); // Sort by frequency
      });
    };
    
    if (boundingBoxes2D.length > 0 || boundingBoxes3D.length > 0 || points.length > 0) {
      updateDetectionHistory();
    }
  }, [boundingBoxes2D, boundingBoxes3D, points, detectType]);

  // Generate and speak notifications
  useEffect(() => {
    let message = '';
    const currentTime = Date.now();
    let isUrgent = false;
    let isSummary = false;
    let isPathGuidance = false;
    
    // Check if it's time for a scene summary
    const shouldGiveSummary = currentTime - lastSceneSummaryTime > SCENE_SUMMARY_INTERVAL &&
                              detectionHistory.length > 0 &&
                              !speechInProgressRef.current;
    
    // Check if it's time for path guidance
    const shouldGivePathGuidance = currentTime - lastPathGuidanceTime > PATH_GUIDANCE_INTERVAL &&
                                  navigationData.lastUpdated > lastPathGuidanceTime &&
                                  !speechInProgressRef.current;
    
    // Only generate new speech if we're not already speaking and enough time has passed,
    // or if it's time for a summary or path guidance
    if (speechInProgressRef.current || 
        (currentTime - lastSpeechTime < SPEECH_COOLDOWN_MS && 
         !shouldGiveSummary && !shouldGivePathGuidance)) {
      return;
    }
    
    if (shouldGiveSummary) {
      // Provide a summary of the environment
      isSummary = true;
      const topObjects = detectionHistory.slice(0, 5).map(item => item.label);
      
      if (topObjects.length > 0) {
        message = `Environment summary: You are in an area with ${topObjects.join(', ')}`;
        setLastSceneSummaryTime(currentTime);
      }
    } else if (shouldGivePathGuidance) {
      // Provide guidance on available paths
      isPathGuidance = true;
      
      let pathMessage = "";
      
      // Start with warnings if any
      if (navigationData.warnings.length > 0) {
        const uniqueWarnings = [...new Set(navigationData.warnings)];
        const criticalWarnings = uniqueWarnings.slice(0, 2);
        pathMessage += `${criticalWarnings.join('. ')}. `;
      }
      
      // Then describe available paths
      if (navigationData.paths.length > 0) {
        pathMessage += "Available paths: ";
        const uniquePaths = [...new Set(navigationData.paths)];
        pathMessage += uniquePaths.slice(0, 3).join('. ');
      } else {
        pathMessage += "No clear paths detected. ";
      }
      
      // Finally add the recommended direction
      if (navigationData.safeDirection) {
        pathMessage += ` Recommendation: ${navigationData.safeDirection}.`;
      }
      
      message = pathMessage;
      setLastPathGuidanceTime(currentTime);
    } else if (detectType === '2D bounding boxes' && boundingBoxes2D.length > 0) {
      // Find obstacles that are large or in the center (likely in the path)
      const obstacles = boundingBoxes2D
        .filter(box => {
          // Center of the screen is around 0.5, 0.5
          const centerX = box.x + box.width / 2;
          const centerY = box.y + box.height / 2;
          const isCentered = centerX > 0.3 && centerX < 0.7 && centerY > 0.3 && centerY < 0.7;
          const isLarge = box.width * box.height > 0.1; // 10% of screen
          return isCentered || isLarge;
        })
        .sort((a, b) => {
          // Sort by distance from center and size
          const distA = Math.abs(0.5 - (a.x + a.width / 2)) + Math.abs(0.5 - (a.y + a.height / 2));
          const distB = Math.abs(0.5 - (b.x + b.width / 2)) + Math.abs(0.5 - (b.y + b.height / 2));
          return distA - distB;
        });
      
      // Check for very close objects (potential immediate hazards)
      const immediateHazards = obstacles.filter(box => {
        const centerY = box.y + box.height / 2;
        const size = box.width * box.height;
        return size > 0.15 || (centerY > 0.6 && size > 0.08); // Large or close objects
      });
      
      if (immediateHazards.length > 0) {
        isUrgent = true;
        const hazard = immediateHazards[0];
        const distance = estimateDistance(hazard);
        const position = getDetailedPositionDescription(hazard.x, hazard.y, hazard.width, hazard.height);
        
        // Add movement instruction for hazard avoidance
        let avoidanceInstruction = "";
        const centerX = hazard.x + hazard.width / 2;
        
        if (centerX < 0.5) {
          avoidanceInstruction = "Move to your right to avoid";
        } else {
          avoidanceInstruction = "Move to your left to avoid";
        }
        
        message = `Caution! ${hazard.label} ${position}, ${distance}. ${avoidanceInstruction}.`;
      } else if (obstacles.length > 0) {
        const obstacleDescriptions = obstacles
          .slice(0, 2) // Take up to 2 most important obstacles
          .map(box => {
            const position = getDetailedPositionDescription(box.x, box.y, box.width, box.height);
            const distance = estimateDistance(box);
            return `${box.label} ${position}, ${distance}`;
          });
        
        // Add basic navigation instruction
        let navInstruction = "";
        if (navigationData.safeDirection) {
          navInstruction = ` ${navigationData.safeDirection}.`;
        } else {
          // Generate a basic instruction based on obstacle positions
          const rightObstacles = obstacles.filter(box => (box.x + box.width/2) > 0.5);
          const leftObstacles = obstacles.filter(box => (box.x + box.width/2) < 0.5);
          
          if (leftObstacles.length > rightObstacles.length) {
            navInstruction = " Consider moving right.";
          } else if (rightObstacles.length > leftObstacles.length) {
            navInstruction = " Consider moving left.";
          } else {
            navInstruction = " Proceed with caution.";
          }
        }
        
        message = `${obstacleDescriptions.join('. ')}.${navInstruction}`;
      } else {
        // Path is clear, provide navigation guidance
        if (navigationData.paths.length > 0) {
          // Pick the most relevant path
          const primaryPath = navigationData.paths[0];
          message = `Path clear. ${primaryPath}. Proceed with caution.`;
        } else {
          // No specific paths found, but area is clear
          message = 'Path clear ahead. Proceed slowly and watch your step.';
        }
      }
    } else if (detectType === '3D bounding boxes' && boundingBoxes3D.length > 0) {
      // 3D boxes provide better distance information
      const sortedObstacles = [...boundingBoxes3D].sort((a, b) => {
        // Sort by approximate distance (center[2] is depth)
        return a.center[2] - b.center[2];
      });
      
      // Check for very close objects
      const closeObstacles = sortedObstacles.filter(box => {
        const depth = box.center[2];
        return depth < 1.5; // Very close objects
      });
      
      if (closeObstacles.length > 0) {
        isUrgent = true;
        const closest = closeObstacles[0];
        const orientation = getOrientationFromBox(closest);
        
        // Add avoidance instruction
        let avoidanceDirection = "";
        if (closest.center[0] < 0) {
          avoidanceDirection = "Step right to avoid";
        } else {
          avoidanceDirection = "Step left to avoid";
        }
        
        message = `Caution! ${closest.label} very close, ${orientation}. ${avoidanceDirection}.`;
      } else {
        // Provide navigational guidance based on 3D scene
        const obstacleDescriptions = sortedObstacles
          .slice(0, 2)
          .map(box => {
            const distance = estimateDistanceFrom3DBox(box);
            const orientation = getOrientationFromBox(box);
            return `${box.label} ${distance} ${orientation}`;
          });
        
        // Add path information if available
        let pathGuidance = "";
        if (navigationData.paths.length > 0) {
          pathGuidance = ` Available path: ${navigationData.paths[0]}.`;
        }
        
        message = `${obstacleDescriptions.join('. ')}.${pathGuidance}`;
      }
    } else if (points.length > 0) {
      // Points based detection is useful for identifying specific features
      const centerPoints = points
        .filter(point => {
          const { x, y } = point.point;
          return x > 0.3 && x < 0.7 && y > 0.3 && y < 0.7; // In center area
        })
        .slice(0, 2);
        
      if (centerPoints.length > 0) {
        const descriptions = centerPoints.map(point => {
          const position = getPositionDescriptionFromPoint(point.point.x, point.point.y);
          return `${point.label} ${position}`;
        });
        
        // Add movement guidance for points
        let movementAdvice = "";
        if (navigationData.safeDirection) {
          movementAdvice = ` ${navigationData.safeDirection}`;
        } else {
          // Provide generic movement advice
          movementAdvice = " Proceed with caution.";
        }
        
        message = `${descriptions.join('. ')}.${movementAdvice}`;
      } else {
        // No critical points in center, check for path information
        if (navigationData.paths.length > 0) {
          message = `No immediate obstacles. ${navigationData.paths[0]}. Proceed carefully.`;
        } else {
          message = 'No immediate obstacles. Proceed slowly and scan for paths.';
        }
      }
    }
    
    // Only speak if we have a new message and it's different from the last one
    // or if it's path guidance or a summary (these should be repeated)
    if (message && (message !== lastSpoken || isSummary || isPathGuidance)) {
      // Clear any pending speech
      if (speakTimeoutRef.current) {
        window.clearTimeout(speakTimeoutRef.current);
      }
      
      // For urgent messages, summaries, or path guidance, cancel ongoing speech
      if (isUrgent || isSummary || isPathGuidance) {
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
        }
      }
      
      // Set a short delay before speaking
      speakTimeoutRef.current = window.setTimeout(() => {
        speechInProgressRef.current = true;
        speakText(message, isUrgent, isSummary || isPathGuidance);
        setLastSpoken(message);
        setLastSpeechTime(Date.now());
      }, SPEECH_DELAY_MS);
    }
    
    return () => {
      if (speakTimeoutRef.current) {
        window.clearTimeout(speakTimeoutRef.current);
      }
    };
  }, [boundingBoxes2D, boundingBoxes3D, points, detectType, lastSpoken, lastSpeechTime, 
      lastSceneSummaryTime, lastPathGuidanceTime, detectionHistory, navigationData]);
  
  // Function to speak text using the Web Speech API
  const speakText = (text: string, isUrgent = false, isInformational = false) => {
    if ('speechSynthesis' in window) {
      const speech = new SpeechSynthesisUtterance(text);
      
      // Use the selected natural voice if available
      if (selectedVoice) {
        speech.voice = selectedVoice;
      }
      
      // Adjust speech properties based on message type
      if (isUrgent) {
        speech.rate = 1.2; // Slightly faster for urgent messages
        speech.pitch = 1.1; // Slightly higher pitch for urgency
        speech.volume = 1.0;
      } else if (isSummary) {
        speech.rate = 1.0; // Normal speed for summaries
        speech.pitch = 0.95; // Slightly lower pitch for summaries
        speech.volume = 0.95;
      } else {
        speech.rate = 1.1; // Slightly faster than normal
        speech.pitch = 1.0;
        speech.volume = 1.0;
      }
      
      speech.onend = () => {
        speechInProgressRef.current = false;
      };
      
      speech.onerror = () => {
        speechInProgressRef.current = false;
      };
      
      window.speechSynthesis.speak(speech);
    }
  };
  
  // Helper to estimate distance from 2D bounding box
  const estimateDistance = (box: { width: number, height: number }) => {
    const size = box.width * box.height;
    if (size > 0.25) return "within arm's reach";
    if (size > 0.15) return "very close";
    if (size > 0.08) return "close";
    if (size > 0.04) return "approaching";
    if (size > 0.01) return "in the distance";
    return "far away";
  };
  
  // Helper to estimate distance from 3D box
  const estimateDistanceFrom3DBox = (box: { center: [number, number, number] }) => {
    const depth = box.center[2];
    if (depth < 1) return "within arm's reach";
    if (depth < 2) return "very close";
    if (depth < 3) return "close";
    if (depth < 5) return "approaching";
    return "in the distance";
  };
  
  // Helper to get orientation info from 3D box
  const getOrientationFromBox = (box: { center: [number, number, number] }) => {
    const [x, y, _] = box.center;
    
    let horizontalPosition = "";
    let verticalPosition = "";
    
    if (x < -0.5) horizontalPosition = "far left";
    else if (x < -0.2) horizontalPosition = "to your left";
    else if (x < 0.2) horizontalPosition = "straight ahead";
    else if (x < 0.5) horizontalPosition = "to your right";
    else horizontalPosition = "far right";
    
    if (y < -0.3) verticalPosition = "above you";
    else if (y > 0.3) verticalPosition = "low";
    
    return verticalPosition ? `${horizontalPosition}, ${verticalPosition}` : horizontalPosition;
  };
  
  // Helper to describe position in detailed terms
  const getDetailedPositionDescription = (x: number, y: number, width: number, height: number) => {
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    
    // Horizontal position
    let horizontalPosition = "";
    if (centerX < 0.2) horizontalPosition = "far left";
    else if (centerX < 0.4) horizontalPosition = "to your left";
    else if (centerX < 0.6) horizontalPosition = "in front of you";
    else if (centerX < 0.8) horizontalPosition = "to your right";
    else horizontalPosition = "far right";
    
    // Vertical position
    let verticalPosition = "";
    if (centerY < 0.3) verticalPosition = "in the distance";
    else if (centerY < 0.5) verticalPosition = "ahead";
    else if (centerY < 0.7) verticalPosition = "getting closer";
    else verticalPosition = "very close";
    
    // Size-based modifier
    const size = width * height;
    let sizeModifier = "";
    if (size > 0.25) sizeModifier = "large ";
    else if (size < 0.04) sizeModifier = "small ";
    
    return `${sizeModifier}${horizontalPosition}, ${verticalPosition}`;
  };
  
  // Helper for point-based position description
  const getPositionDescriptionFromPoint = (x: number, y: number) => {
    // Horizontal position
    let horizontalPosition = "";
    if (x < 0.2) horizontalPosition = "far left";
    else if (x < 0.4) horizontalPosition = "to your left";
    else if (x < 0.6) horizontalPosition = "in front of you";
    else if (x < 0.8) horizontalPosition = "to your right";
    else horizontalPosition = "far right";
    
    // Vertical position
    let verticalPosition = "";
    if (y < 0.3) verticalPosition = "in the distance";
    else if (y < 0.5) verticalPosition = "ahead";
    else if (y < 0.7) verticalPosition = "getting closer";
    else verticalPosition = "very close";
    
    return `${horizontalPosition}, ${verticalPosition}`;
  };
  
  // Function to handle voice selection change
  const handleVoiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const voiceName = e.target.value;
    const voice = availableVoices.find(v => v.name === voiceName) || null;
    setSelectedVoice(voice);
    setPreferredVoiceName(voiceName);
    
    // Speak a test phrase with the new voice
    if (voice && 'speechSynthesis' in window) {
      const testSpeech = new SpeechSynthesisUtterance("Voice selected");
      testSpeech.voice = voice;
      window.speechSynthesis.speak(testSpeech);
    }
  };
  
  return (
    <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-70 text-white p-3 rounded-lg z-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔊</span>
          <span>{lastSpoken || "Waiting for detection results..."}</span>
        </div>
        
        {/* Voice selector */}
        {availableVoices.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="voice-select">Voice:</label>
            <select 
              id="voice-select"
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm flex-1"
              value={selectedVoice?.name || ''}
              onChange={handleVoiceChange}
            >
              {availableVoices.map(voice => (
                <option key={voice.name} value={voice.name}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}