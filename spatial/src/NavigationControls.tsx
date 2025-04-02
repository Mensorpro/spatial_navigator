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
import { DetectTypeAtom } from "./atoms";
import { useState } from "react";

interface NavigationControlsProps {
  isNavigating: boolean;
  onStartNavigation: () => void;
  onStopNavigation: () => void;
}

export function NavigationControls({ 
  isNavigating, 
  onStartNavigation, 
  onStopNavigation 
}: NavigationControlsProps) {
  const [detectType, setDetectType] = useAtom(DetectTypeAtom);
  const [showRateLimitInfo, setShowRateLimitInfo] = useState(false);

  return (
    <div className="flex flex-col gap-4 items-center">
      <div className="text-xl font-bold mb-2">
        {isNavigating ? "Navigation Active" : "Start Navigation"}
      </div>
      
      {!isNavigating ? (
        <div className="flex flex-col gap-3 w-full max-w-md">
          <div className="flex gap-3 justify-between">
            <select 
              className="p-3 rounded-lg bg-[var(--input-color)] border border-[var(--border-color)]"
              value={detectType}
              onChange={(e) => setDetectType(e.target.value as any)}
            >
              <option value="2D bounding boxes">Standard Detection</option>
              <option value="3D bounding boxes">Distance Estimation (3D)</option>
              <option value="Points">Critical Points</option>
            </select>
          </div>
          
          <button
            className="flex items-center justify-center gap-3 button bg-[#3B68FF] px-12 !text-white !border-none h-16 text-lg"
            onClick={onStartNavigation}
          >
            <span className="text-2xl">🎥</span>
            <span>Start Camera Navigation</span>
          </button>
          
          <p className="text-center text-[var(--text-color-secondary)] mt-2">
            This will use your camera to detect and identify obstacles in your path and provide audio guidance
          </p>
          
          <div className="mt-2">
            <button 
              onClick={() => setShowRateLimitInfo(!showRateLimitInfo)}
              className="text-sm text-[var(--text-color-secondary)] underline"
            >
              {showRateLimitInfo ? "Hide API information" : "Show API information"}
            </button>
            
            {showRateLimitInfo && (
              <div className="mt-2 p-3 rounded-lg bg-[var(--input-color)] text-sm">
                <p className="font-semibold mb-1">About API Rate Limits:</p>
                <p className="mb-2">
                  This app uses Google's Gemini API which has the following free tier limits:
                </p>
                <ul className="list-disc pl-5 mb-2">
                  <li>15 requests per minute for Gemini 1.5 Flash</li>
                  <li>60 requests per minute across all models</li>
                </ul>
                <p>
                  If you see rate limit errors, the app will automatically slow down requests and continue using cached results until the limits reset.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 w-full max-w-md">
          <div className="flex gap-3 justify-between items-center">
            <div className="text-lg">
              <span className="animate-pulse inline-block w-3 h-3 rounded-full bg-red-500 mr-2"></span>
              Camera active
            </div>
            <div className="text-[var(--text-color-secondary)]">
              Continuously analyzing your surroundings
            </div>
          </div>
          
          <button
            className="flex items-center justify-center gap-3 button bg-red-500 px-12 !text-white !border-none h-14"
            onClick={onStopNavigation}
          >
            <span className="text-xl">⏹️</span>
            <span>Stop Navigation</span>
          </button>
        </div>
      )}
    </div>
  );
}