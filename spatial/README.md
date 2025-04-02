# Visual Navigator for the Blind

An AI-powered application that helps visually impaired individuals navigate their environment by detecting obstacles and providing audio guidance.

![Visual Navigator for the Blind](./docs/app_preview.png)

## Features

- **Real-time object detection** - Identifies objects, obstacles, and potential hazards in the user's path
- **Audio feedback** - Provides spoken descriptions of detected objects and their positions
- **Spatial audio** - (In advanced mode) Creates directional audio cues to indicate the location of objects
- **Multiple detection modes**:
  - Standard Detection (2D bounding boxes)
  - Distance Estimation (3D bounding boxes)
  - Critical Points detection
- **Navigation modes**:
  - Basic - Simple voice guidance about obstacles
  - Detailed - Enhanced descriptions with distance estimation
  - Advanced - Full spatial audio with 3D positional cues

## Technology Stack

- React with TypeScript
- Google's Gemini API for computer vision and object detection
- Web Speech API for audio feedback
- Web Audio API for spatial audio cues
- TailwindCSS for styling

## Prerequisites

- Node.js (v16.0 or higher)
- A Google Gemini API key

## Setup

1. Clone the repository:
```bash
git clone https://github.com/Mensorpro/spatial_navigator.git
cd spatial_navigator/spatial
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with your Gemini API key:
```
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

4. Start the development server:
```bash
npm run dev
```

## Usage

1. Open the application in a browser at http://localhost:8000
2. Click "Start Camera Navigation" to begin using the camera
3. Select the detection mode based on your needs:
   - Standard Detection: Best for general obstacle identification
   - Distance Estimation: Better for understanding obstacle proximity
   - Critical Points: Highlights specific important features
4. Choose your navigation mode:
   - Basic: Simple voice announcements
   - Detailed: More comprehensive descriptions with audio cues
   - Advanced: Full spatial audio experience

## Important Notes

- The application requires camera permissions to function
- Best performance is achieved with the device in portrait orientation
- Audio feedback works best with headphones
- The Gemini API has rate limits (approximately 15 requests per minute)

## Deployment

To build for production:

```bash
npm run build
```

The build artifacts will be stored in the `dist/` directory.

## License

Licensed under the Apache License, Version 2.0 - see LICENSE file for details.

## Acknowledgments

- Google Gemini API for providing the vision intelligence
- Contributors to the project during the University Hackathon