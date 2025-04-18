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

import { useEffect, useState } from "react";
import { TopBar } from "./TopBar";
import { Content } from "./Content";
import { ExtraModeControls } from "./ExtraModeControls";
import { useAtom } from "jotai";
import {
  InitFinishedAtom,
  ShareStream,
  NavigationModeAtom,
  DirectionalAudioEnabledAtom
} from "./atoms";
import { useResetState } from "./hooks";
import { NavigationControls } from "./NavigationControls";
import { SpeechFeedback } from "./SpeechFeedback";
import { NavigationAudioGuide } from "./NavigationAudioGuide";
import { ConsoleCard } from "./components/ConsoleCard";
import { APIKeySetup } from "./components/APIKeySetup";

function App() {
  const resetState = useResetState();
  const [initFinished, setInitFinished] = useAtom(InitFinishedAtom);
  const [isNavigating, setIsNavigating] = useState(false);
  const [stream, setStream] = useAtom(ShareStream);
  const [navigationMode, setNavigationMode] = useAtom(NavigationModeAtom);
  const [_directionalAudioEnabled, setDirectionalAudioEnabled] = useAtom(DirectionalAudioEnabledAtom);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    setInitFinished(true);
    
    if (!window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const startNavigation = async () => {
    try {
      setCameraError(null);
      
      // First try to get camera access with rear-facing camera preference
      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
        
        console.log('Successfully connected to camera');
        setStream(cameraStream);
        setIsNavigating(true);
        
        // Enable directional audio in detailed and advanced modes
        if (navigationMode !== 'basic') {
          setDirectionalAudioEnabled(true);
        }
        return;
      } catch (err) {
        console.error('Error accessing camera:', err);
        throw err; // Re-throw to be caught by outer try-catch
      }
    } catch (err) {
      console.error("Error:", err);
      setCameraError(
        "Could not access camera. Please ensure you've given camera permissions and try again. " +
        "If using your phone, make sure you're accessing this page through HTTPS."
      );
    }
  };

  const stopNavigation = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsNavigating(false);
    setDirectionalAudioEnabled(false);
    setCameraError(null);
    resetState();
  };
  
  const handleNavigationModeChange = (mode: "basic" | "detailed" | "advanced") => {
    setNavigationMode(mode);
    
    // Enable directional audio in detailed and advanced modes only if navigating
    if (isNavigating) {
      setDirectionalAudioEnabled(mode !== 'basic');
    }
  };

  return (
    <div className="flex flex-col h-[100dvh]">
      <div className="flex grow flex-col border-b overflow-hidden">
        <TopBar title="Visual Navigator for the Blind" />
        {initFinished ? <Content isNavigating={isNavigating} /> : null}
        {isNavigating && (
          <>
            <SpeechFeedback />
            <NavigationAudioGuide />
          </>
        )}
        <ExtraModeControls />
      </div>
      <div className="flex shrink-0 w-full overflow-auto py-6 px-5 gap-6 items-center justify-center flex-wrap">
        {/* Show camera error if any */}
        {cameraError && (
          <div className="w-full max-w-md bg-red-600 text-white p-3 rounded-lg text-center mb-4">
            {cameraError}
          </div>
        )}
        
        <NavigationControls 
          isNavigating={isNavigating} 
          onStartNavigation={startNavigation}
          onStopNavigation={stopNavigation}
        />
        
        {/* Navigation Mode Selector */}
        {isNavigating && (
          <div className="flex flex-col gap-2 items-center">
            <div className="text-sm font-medium mb-1">Navigation Mode:</div>
            <div className="flex gap-2">
              <button
                onClick={() => handleNavigationModeChange("basic")}
                className={`px-3 py-2 rounded-lg text-sm ${
                  navigationMode === "basic"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                }`}
              >
                Basic
              </button>
              <button
                onClick={() => handleNavigationModeChange("detailed")}
                className={`px-3 py-2 rounded-lg text-sm ${
                  navigationMode === "detailed"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                }`}
              >
                Detailed
              </button>
              <button
                onClick={() => handleNavigationModeChange("advanced")}
                className={`px-3 py-2 rounded-lg text-sm ${
                  navigationMode === "advanced"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                }`}
              >
                Advanced
              </button>
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 text-center max-w-xs">
              {navigationMode === "basic" ? 
                "Simple voice guidance about obstacles" : 
                navigationMode === "detailed" ? 
                "Enhanced descriptions with distance estimation and audio cues" : 
                "Full spatial audio with 3D positional cues and detailed environment information"}
            </div>
          </div>
        )}
      </div>
      <ConsoleCard />
      <APIKeySetup />
    </div>
  );
}

export default App;
