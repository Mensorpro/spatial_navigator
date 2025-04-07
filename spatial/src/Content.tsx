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
import { useFrameProcessing } from "./hooks/useFrameProcessing";
import { VisualizationOverlay } from "./components/VisualizationOverlay";
import { MediaDisplay } from "./components/MediaDisplay";
import { matrixMultiply } from "./utils/ProcessingUtils";

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
  const [videoReady, setVideoReady] = useState(false);
  const videoInitTimeoutRef = useRef<number | null>(null);

  // Handling resize and aspect ratios
  const boundingBoxContainerRef = useRef<HTMLDivElement | null>(null);
  const [containerDims, setContainerDims] = useState({ width: 0, height: 0 });
  const [activeMediaDimensions, setActiveMediaDimensions] = useState({ width: 1, height: 1 });

  const onResize = useCallback((el: ResizePayload) => {
    if (el.width && el.height) {
      setContainerDims({ width: el.width, height: el.height });
    }
  }, []);

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

  // Use the frame processing hook for navigation
  const {
    processingError,
    boundingBoxes2D: processedBoxes2D,
    boundingBoxes3D: processedBoxes3D,
    points: processedPoints
  } = useFrameProcessing(
    isNavigating,
    videoRef,
    videoReady,
    canvasRef,
    detectType
  );

  // Update state atoms with processed results
  useEffect(() => {
    if (processedBoxes2D.length > 0) setBoundingBoxes2D(processedBoxes2D);
    if (processedBoxes3D.length > 0) setBoundingBoxes3D(processedBoxes3D);
    if (processedPoints.length > 0) setPoints(processedPoints);
  }, [processedBoxes2D, processedBoxes3D, processedPoints, setBoundingBoxes2D, setBoundingBoxes3D, setPoints]);

  // Map 3D boxes to lines for rendering
  const linesAndLabels3D = useMemo(() => {
    if (!boundingBoxContainer) return null;

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
      const intrinsics = [[f, 0, cx], [0, f, cy], [0, 0, 1]];

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
        corners[1], corners[3], corners[7], corners[5],
        corners[0], corners[2], corners[6], corners[4],
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
      const rotatedPoints = points.map((p) => matrixMultiply(viewRotationMatrix, p));
      const translatedPoints = rotatedPoints.map((p) => p.map((v) => v + 0));
      const projectedPoints = translatedPoints.map((p) => matrixMultiply(intrinsics, p));
      const vertices = projectedPoints.map((p) => [p[0] / p[2], p[1] / p[2]]);

      const topVertices = vertices.slice(0, 4);
      const bottomVertices = vertices.slice(4, 8);

      // Generate lines for the box
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

      // Add label with position
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
      const textPos = [textPoint[0] / textPoint[2], textPoint[1] / textPoint[2]];
      allLabels.push({ label: box.label, pos: textPos });
    }
    return [allLines, allLabels] as [typeof allLines, typeof allLabels];
  }, [boundingBoxes3D, boundingBoxContainer, fov]);

  // Handle video initialization
  useEffect(() => {
    if (videoInitTimeoutRef.current) {
      clearTimeout(videoInitTimeoutRef.current);
      videoInitTimeoutRef.current = null;
    }
    
    setVideoReady(false);
    
    if (stream && videoRef.current) {
      const video = videoRef.current;
      
      // Ensure video is ready to play
      const checkVideoReady = () => {
        if (!video) return;
        
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          setVideoReady(true);
          if (videoInitTimeoutRef.current) {
            clearTimeout(videoInitTimeoutRef.current);
            videoInitTimeoutRef.current = null;
          }
        } else {
          videoInitTimeoutRef.current = window.setTimeout(checkVideoReady, 100);
        }
      };
      
      // Start checking video readiness
      videoInitTimeoutRef.current = window.setTimeout(checkVideoReady, 100);
      
      const handleLoadedMetadata = () => {
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          setVideoReady(true);
        }
      };
      
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      
      return () => {
        if (videoInitTimeoutRef.current) {
          clearTimeout(videoInitTimeoutRef.current);
        }
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      };
    }
  }, [stream, videoRef]);

  return (
    <div ref={containerRef} className="w-full grow relative">
      <MediaDisplay 
        stream={stream}
        imageSrc={imageSrc}
        videoRef={videoRef}
        onMediaLoad={(width, height) => {
          setActiveMediaDimensions({ width, height });
        }}
      />
      
      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />
      
      <div
        className="absolute w-full h-full left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2"
        ref={boundingBoxContainerRef}
        style={{
          width: boundingBoxContainer?.width,
          height: boundingBoxContainer?.height,
        }}
      >
        <VisualizationOverlay
          detectType={detectType}
          boundingBoxes2D={boundingBoxes2D}
          points={points}
          linesAndLabels3D={linesAndLabels3D}
          isNavigating={isNavigating}
          processingError={processingError}
          videoReady={videoReady}
        />
      </div>
    </div>
  );
}
