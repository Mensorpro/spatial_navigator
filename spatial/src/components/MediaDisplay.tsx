interface MediaDisplayProps {
  stream: MediaStream | null;
  imageSrc: string | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  onMediaLoad: (width: number, height: number) => void;
}

export function MediaDisplay({ stream, imageSrc, videoRef, onMediaLoad }: MediaDisplayProps) {
  if (stream) {
    return (
      <video
        className="absolute top-0 left-0 w-full h-full object-contain"
        autoPlay
        playsInline
        muted
        ref={video => {
          // Update the external ref
          if (videoRef) {
            (videoRef as any).current = video;
          }
          
          // Only update srcObject if we have a valid video element and the stream changed
          if (video && video.srcObject !== stream) {
            video.srcObject = stream;
            // Ensure video plays after setting srcObject
            video.play().catch(console.error);
          }
        }}
        onLoadedMetadata={(e) => {
          const video = e.currentTarget;
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            onMediaLoad(video.videoWidth, video.videoHeight);
          }
        }}
      />
    );
  }
  
  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        className="absolute top-0 left-0 w-full h-full object-contain"
        alt="Uploaded image"
        onLoad={(e) => {
          onMediaLoad(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
        }}
      />
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-white">
      <div className="text-center p-4">
        <div className="text-4xl mb-4">🔍</div>
        <div className="text-xl">Start navigation to use the camera</div>
      </div>
    </div>
  );
}