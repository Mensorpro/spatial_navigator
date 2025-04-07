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

export function SpeechFeedback() {
  const [boundingBoxes2D] = useAtom(BoundingBoxes2DAtom);
  const [boundingBoxes3D] = useAtom(BoundingBoxes3DAtom);
  const [points] = useAtom(PointsAtom);
  const [detectType] = useAtom(DetectTypeAtom);
  const [lastSpoken, setLastSpoken] = useState('');
  const [lastSpeechTime, setLastSpeechTime] = useState(0);
  const [lastSceneSummaryTime, setLastSceneSummaryTime] = useState(0);
  const speakTimeoutRef = useRef<number | null>(null);
  const speechInProgressRef = useRef<boolean>(false);
  const [detectionHistory, setDetectionHistory] = useState<Array<{label: string, count: number, lastSeen: number}>>([]);

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
    
    // Check if it's time for a scene summary
    const shouldGiveSummary = currentTime - lastSceneSummaryTime > SCENE_SUMMARY_INTERVAL &&
                             detectionHistory.length > 0 &&
                             !speechInProgressRef.current;
    
    // Only generate new speech if we're not already speaking and enough time has passed
    if (speechInProgressRef.current || 
        (currentTime - lastSpeechTime < SPEECH_COOLDOWN_MS && !shouldGiveSummary)) {
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
        message = `Caution! ${hazard.label} ${position}, ${distance}`;
      } else if (obstacles.length > 0) {
        const obstacleDescriptions = obstacles
          .slice(0, 3) // Take up to 3 most important obstacles
          .map(box => {
            const position = getDetailedPositionDescription(box.x, box.y, box.width, box.height);
            const distance = estimateDistance(box);
            return `${box.label} ${position}, ${distance}`;
          });
        
        message = `${obstacleDescriptions.join('. ')}`;
      } else {
        // Look for objects on the periphery to help with awareness
        const peripheralObjects = boundingBoxes2D
          .filter(box => {
            const centerX = box.x + box.width / 2;
            return centerX < 0.2 || centerX > 0.8; // Far left or right
          })
          .slice(0, 2);
          
        if (peripheralObjects.length > 0) {
          const descriptions = peripheralObjects.map(box => {
            const position = getDetailedPositionDescription(box.x, box.y, box.width, box.height);
            return `${box.label} ${position}`;
          });
          message = `Path clear. Also seeing: ${descriptions.join(', ')}`;
        } else {
          message = 'Path clear ahead';
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
        message = `Caution! ${closest.label} very close, ${orientation}`;
      } else {
        const obstacleDescriptions = sortedObstacles
          .slice(0, 3)
          .map(box => {
            const distance = estimateDistanceFrom3DBox(box);
            const orientation = getOrientationFromBox(box);
            return `${box.label} ${distance} ${orientation}`;
          });
        
        message = `${obstacleDescriptions.join('. ')}`;
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
        message = `${descriptions.join('. ')}`;
      } else {
        const peripheralPoints = points.slice(0, 2);
        const descriptions = peripheralPoints.map(point => {
          const position = getPositionDescriptionFromPoint(point.point.x, point.point.y);
          return `${point.label} ${position}`;
        });
        message = `Note: ${descriptions.join(', ')}`;
      }
    }
    
    // Only speak if we have a new message and it's different from the last one
    if (message && (message !== lastSpoken || isSummary)) {
      // Clear any pending speech
      if (speakTimeoutRef.current) {
        window.clearTimeout(speakTimeoutRef.current);
      }
      
      // For urgent messages or summaries, cancel ongoing speech
      if (isUrgent || isSummary) {
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
        }
      }
      
      // Set a short delay before speaking
      speakTimeoutRef.current = window.setTimeout(() => {
        speechInProgressRef.current = true;
        speakText(message, isUrgent, isSummary);
        setLastSpoken(message);
        setLastSpeechTime(Date.now());
      }, SPEECH_DELAY_MS);
    }
    
    return () => {
      if (speakTimeoutRef.current) {
        window.clearTimeout(speakTimeoutRef.current);
      }
    };
  }, [boundingBoxes2D, boundingBoxes3D, points, detectType, lastSpoken, lastSpeechTime, lastSceneSummaryTime, detectionHistory]);
  
  // Function to speak text using the Web Speech API
  const speakText = (text: string, isUrgent = false, isSummary = false) => {
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
    if (depth < 3.5) return "close";
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