import  { useEffect, useRef,  } from 'react';
import { useAtom } from 'jotai';
import { 
  BoundingBoxes2DAtom, 
  BoundingBoxes3DAtom, 
  DirectionalAudioEnabledAtom,
  NavigationModeAtom
} from './atoms';

// Web Audio context for spatial audio
let audioContext: AudioContext | null = null;

export function NavigationAudioGuide() {
  const [boundingBoxes2D] = useAtom(BoundingBoxes2DAtom);
  const [boundingBoxes3D] = useAtom(BoundingBoxes3DAtom);
  const [directionalAudioEnabled] = useAtom(DirectionalAudioEnabledAtom);
  const [navigationMode] = useAtom(NavigationModeAtom);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorsRef = useRef<Map<string, OscillatorNode>>(new Map());
  const gainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const panNodesRef = useRef<Map<string, StereoPannerNode>>(new Map());
  const activeTimersRef = useRef<Map<string, number>>(new Map());
  
  // Initialize audio context on first render
  useEffect(() => {
    if (!audioContext && typeof window !== 'undefined') {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
    }
    
    return () => {
      // Clean up all audio nodes when component unmounts
      oscillatorsRef.current.forEach(osc => {
        try {
          osc.stop();
          osc.disconnect();
        } catch (e) {
          // Ignore errors on cleanup
        }
      });
      oscillatorsRef.current.clear();
      gainNodesRef.current.clear();
      panNodesRef.current.clear();
      
      // Clear all timers
      activeTimersRef.current.forEach(timer => window.clearTimeout(timer));
      activeTimersRef.current.clear();
    };
  }, []);
  
  // Process 2D bounding boxes to create audio cues
  useEffect(() => {
    if (!directionalAudioEnabled || !audioContextRef.current || navigationMode === 'basic') {
      return;
    }
    
    // Process obstacles and generate appropriate audio cues
    const obstacles = boundingBoxes2D
      .filter(box => {
        // Focus on significant obstacles
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        const size = box.width * box.height;
        
        // For obstacles in center or large ones
        return (centerX > 0.3 && centerX < 0.7 && centerY > 0.4) || size > 0.08;
      })
      .sort((a, b) => {
        // Sort by proximity (Y position) and size
        const sizeA = a.width * a.height;
        const sizeB = b.width * b.height;
        const yA = a.y + a.height / 2;
        const yB = b.y + b.height / 2;
        
        // Prioritize closer objects
        if (Math.abs(yA - yB) > 0.2) {
          return yB - yA;
        }
        // Then prioritize larger objects
        return sizeB - sizeA;
      })
      .slice(0, 3); // Limit to 3 most important obstacles for audio
    
    // Create new audio identifiers
    const currentObstacleIds = new Set(
      obstacles.map((box, index) => `${box.label}-${index}`)
    );
    
    // Stop audio for obstacles that are no longer relevant
    oscillatorsRef.current.forEach((_, id) => {
      if (!currentObstacleIds.has(id)) {
        stopAudioCue(id);
      }
    });
    
    // Create audio cues for current obstacles
    obstacles.forEach((box, index) => {
      const id = `${box.label}-${index}`;
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      const size = box.width * box.height;
      
      // Pan value: -1 (left) to 1 (right)
      const pan = (centerX - 0.5) * 2;
      
      // Frequency based on object type and position
      // Higher objects = higher pitch, larger objects = lower pitch
      let frequency = 220; // Base frequency (A3)
      
      // Adjust frequency based on object type
      if (box.label.includes('person')) {
        frequency = 330; // E4 - distinct sound for people
      } else if (box.label.includes('car') || box.label.includes('vehicle')) {
        frequency = 165; // E3 - lower sound for vehicles
      } else if (box.label.includes('door') || box.label.includes('entrance')) {
        frequency = 392; // G4 - higher sound for entrances
      }
      
      // Adjust for vertical position
      frequency *= (1 - centerY * 0.3); // Higher frequency for distant objects
      
      // Volume based on size and proximity
      const volume = Math.min(0.7, Math.max(0.1, size * 3 + centerY * 0.5));
      
      // Play the audio cue
      playAudioCue(id, frequency, volume, pan);
    });
    
    return () => {
      // Clean up audio cues when effect re-runs
      obstacles.forEach((_, index) => {
        const id = `obstacle-${index}`;
        stopAudioCue(id);
      });
    };
  }, [boundingBoxes2D, directionalAudioEnabled, navigationMode]);
  
  // Process 3D bounding boxes for more accurate audio positioning
  useEffect(() => {
    if (!directionalAudioEnabled || !audioContextRef.current || navigationMode !== 'advanced') {
      return;
    }
    
    // Process 3D obstacles (when using the 3D detection mode)
    boundingBoxes3D.forEach((box, index) => {
      const id = `3d-${box.label}-${index}`;
      
      // X position (left to right) from -1 to 1
      const pan = Math.max(-1, Math.min(1, box.center[0]));
      
      // Distance affects volume
      const distance = box.center[2];
      const volume = Math.min(0.8, Math.max(0.1, 1.5 / (distance + 1)));
      
      // Base frequency varies by object type
      let frequency = 262; // Middle C
      
      // Adjust frequency based on height (Y position)
      frequency *= (1 - box.center[1] * 0.2); // Higher for objects below, lower for above
      
      playAudioCue(id, frequency, volume, pan);
    });
    
    return () => {
      boundingBoxes3D.forEach((box, index) => {
        const id = `3d-${box.label}-${index}`;
        stopAudioCue(id);
      });
    };
  }, [boundingBoxes3D, directionalAudioEnabled, navigationMode]);
  
  // Helper function to play a directional audio cue
  const playAudioCue = (id: string, frequency: number, volume: number, pan: number) => {
    if (!audioContextRef.current) return;
    
    // If this cue is already playing, update its properties
    if (oscillatorsRef.current.has(id)) {
      const osc = oscillatorsRef.current.get(id)!;
      const gain = gainNodesRef.current.get(id)!;
      const panner = panNodesRef.current.get(id)!;
      
      // Update properties
      osc.frequency.setValueAtTime(frequency, audioContextRef.current.currentTime);
      gain.gain.setValueAtTime(volume, audioContextRef.current.currentTime);
      panner.pan.setValueAtTime(pan, audioContextRef.current.currentTime);
      
      // Clear any existing timeout for this ID
      if (activeTimersRef.current.has(id)) {
        window.clearTimeout(activeTimersRef.current.get(id));
      }
    } else {
      // Create new audio nodes
      try {
        const oscillator = audioContextRef.current.createOscillator();
        const gainNode = audioContextRef.current.createGain();
        const pannerNode = audioContextRef.current.createStereoPanner();
        
        // Configure nodes
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, audioContextRef.current.currentTime);
        gainNode.gain.setValueAtTime(0, audioContextRef.current.currentTime); // Start silent
        pannerNode.pan.setValueAtTime(pan, audioContextRef.current.currentTime);
        
        // Connect nodes
        oscillator.connect(gainNode);
        gainNode.connect(pannerNode);
        pannerNode.connect(audioContextRef.current.destination);
        
        // Start oscillator
        oscillator.start();
        
        // Fade in
        gainNode.gain.linearRampToValueAtTime(
          volume, 
          audioContextRef.current.currentTime + 0.1
        );
        
        // Store references
        oscillatorsRef.current.set(id, oscillator);
        gainNodesRef.current.set(id, gainNode);
        panNodesRef.current.set(id, pannerNode);
      } catch (e) {
        console.error('Error creating audio cue:', e);
      }
    }
    
    // Set a timeout to stop the sound after a while
    const timer = window.setTimeout(() => {
      stopAudioCue(id);
    }, 2000); // 2 seconds
    
    activeTimersRef.current.set(id, timer);
  };
  
  // Helper function to stop an audio cue
  const stopAudioCue = (id: string) => {
    if (!audioContextRef.current) return;
    
    // Get the nodes
    const oscillator = oscillatorsRef.current.get(id);
    const gain = gainNodesRef.current.get(id);
    
    if (oscillator && gain) {
      try {
        // Fade out
        gain.gain.linearRampToValueAtTime(
          0, 
          audioContextRef.current.currentTime + 0.1
        );
        
        // Stop and clean up after fade out
        setTimeout(() => {
          try {
            oscillator.stop();
            oscillator.disconnect();
            oscillatorsRef.current.delete(id);
            gainNodesRef.current.delete(id);
            panNodesRef.current.delete(id);
          } catch (e) {
            // Ignore errors during cleanup
          }
        }, 120);
      } catch (e) {
        console.error('Error stopping audio cue:', e);
      }
    }
    
    // Clear any active timer
    if (activeTimersRef.current.has(id)) {
      window.clearTimeout(activeTimersRef.current.get(id));
      activeTimersRef.current.delete(id);
    }
  };
  
  // This component doesn't render anything visible
  return null;
}