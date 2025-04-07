import React from 'react';
import { BoundingBox2DType } from '../Types';
import { PointingType } from '../atoms';

interface VisualizationOverlayProps {
  detectType: string;
  boundingBoxes2D: BoundingBox2DType[];
  points: PointingType[];
  linesAndLabels3D: [any[], any[]] | null;
  isNavigating: boolean;
  processingError: string | null;
  videoReady: boolean;
}

export function VisualizationOverlay({
  detectType,
  boundingBoxes2D,
  points,
  linesAndLabels3D,
  isNavigating,
  processingError,
  videoReady
}: VisualizationOverlayProps) {
  
  const hasDetections = 
    (detectType === '2D bounding boxes' && boundingBoxes2D.length > 0) ||
    (detectType === 'Points' && points.length > 0) ||
    (detectType === '3D bounding boxes' && linesAndLabels3D && linesAndLabels3D[0].length > 0);

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Status indicators */}
      <div className="absolute top-4 left-4 z-10">
        {isNavigating && (
          <div className="flex flex-col gap-2">
            {!videoReady && (
              <div className="bg-yellow-600 text-white px-3 py-1 rounded shadow text-sm flex items-center">
                <span className="animate-pulse w-2 h-2 bg-white rounded-full mr-2"></span>
                Initializing camera...
              </div>
            )}
            
            {videoReady && !hasDetections && !processingError && (
              <div className="bg-blue-600 text-white px-3 py-1 rounded shadow text-sm flex items-center">
                <span className="animate-pulse w-2 h-2 bg-white rounded-full mr-2"></span>
                Looking for objects...
              </div>
            )}
            
            {processingError && (
              <div className="bg-red-600 text-white px-3 py-1 rounded shadow text-sm flex items-center">
                <span className="mr-2">⚠️</span>
                {processingError}
              </div>
            )}
            
            {videoReady && hasDetections && (
              <div className="bg-green-600 text-white px-3 py-1 rounded shadow text-sm flex items-center">
                <span className="mr-2">✓</span>
                Objects detected
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* 2D Bounding Boxes */}
      {detectType === '2D bounding boxes' && (
        <svg className="absolute inset-0 w-full h-full">
          {boundingBoxes2D.map((box, i) => {
            const isFading = box.label?.includes('(fading)');
            return (
              <g key={`box-${i}`}>
                <rect
                  x={`${box.x * 100}%`}
                  y={`${box.y * 100}%`}
                  width={`${box.width * 100}%`}
                  height={`${box.height * 100}%`}
                  className={`bbox ${isFading ? 'opacity-30' : 'opacity-100'}`}
                  fill="none"
                  strokeWidth="2"
                  stroke="#3B68FF"
                  stroke-dasharray={isFading ? "5,5" : "none"}
                />
                <foreignObject
                  x={`${box.x * 100}%`}
                  y={`${(box.y - 0.04) * 100}%`}
                  width={`${box.width * 100}%`}
                  height="30px"
                >
                  <div
                    className={`bg-[#3B68FF] text-white text-xs px-1 py-0.5 rounded truncate ${
                      isFading ? 'opacity-30' : 'opacity-100'
                    }`}
                  >
                    {box.label}
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      )}

      {/* Points */}
      {detectType === 'Points' && (
        <svg className="absolute inset-0 w-full h-full">
          {points.map((point, i) => (
            <g key={`point-${i}`}>
              <circle
                cx={`${point.point.x * 100}%`}
                cy={`${point.point.y * 100}%`}
                r="5"
                fill="#3B68FF"
                stroke="white"
                strokeWidth="2"
              />
              <foreignObject
                x={`${(point.point.x + 0.01) * 100}%`}
                y={`${(point.point.y - 0.02) * 100}%`}
                width="200px"
                height="30px"
              >
                <div className="bg-[#3B68FF] text-white text-xs px-1 py-0.5 rounded whitespace-nowrap">
                  {point.label}
                </div>
              </foreignObject>
            </g>
          ))}
        </svg>
      )}

      {/* 3D Boxes */}
      {detectType === '3D bounding boxes' && linesAndLabels3D && (
        <svg className="absolute inset-0 w-full h-full">
          {linesAndLabels3D[0].map((line, i) => (
            <line
              key={`line-${i}`}
              x1={line.start[0]}
              y1={line.start[1]}
              x2={line.end[0]}
              y2={line.end[1]}
              stroke="#3B68FF"
              strokeWidth="1.5"
            />
          ))}
          {linesAndLabels3D[1].map((label, i) => (
            <foreignObject
              key={`label-${i}`}
              x={label.pos[0]}
              y={label.pos[1]}
              width="200px"
              height="30px"
            >
              <div className="bg-[#3B68FF] text-white text-xs px-1 py-0.5 rounded whitespace-nowrap max-w-[150px] truncate">
                {label.label}
              </div>
            </foreignObject>
          ))}
        </svg>
      )}
      
      {/* No camera message */}
      {!isNavigating && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center bg-black bg-opacity-60 text-white p-4 rounded-lg">
            <div className="text-4xl mb-3">🎥</div>
            <div className="text-xl font-medium">Start Camera Navigation</div>
            <div className="text-sm mt-2 max-w-xs opacity-80">
              Click the button below to start detecting objects with your camera
            </div>
          </div>
        </div>
      )}
    </div>
  );
}