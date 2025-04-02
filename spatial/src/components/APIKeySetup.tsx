import { useState, useEffect } from 'react';

export function APIKeySetup() {
  const [apiKey, setApiKey] = useState<string>('');
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  
  // Check if API key exists in environment variables
  useEffect(() => {
    const envApiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (envApiKey) {
      setHasApiKey(true);
      setApiKey('');
    } else {
      // Try to retrieve from localStorage as fallback
      const savedApiKey = localStorage.getItem('gemini_api_key');
      if (savedApiKey) {
        setHasApiKey(true);
        setApiKey(savedApiKey);
        // Show success message
        setSuccessMessage('Using saved API key from browser storage');
        // Clear message after 3 seconds
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        setHasApiKey(false);
        setIsVisible(true); // Show the API key setup if no key is found
      }
    }
  }, []);
  
  const handleSaveApiKey = () => {
    if (!apiKey.trim()) return;
    
    setIsSaving(true);
    
    try {
      // Save to localStorage as fallback
      localStorage.setItem('gemini_api_key', apiKey);
      
      // Set success message
      setSuccessMessage('API key saved successfully! Refresh the page to apply.');
      
      // Hide form after successful save
      setTimeout(() => {
        setHasApiKey(true);
        setIsVisible(false);
        setIsSaving(false);
      }, 1000);
    } catch (err) {
      console.error('Error saving API key:', err);
      setSuccessMessage('Error saving API key. Please try again.');
      setIsSaving(false);
    }
  };
  
  if (!isVisible) {
    return (
      <div className="fixed bottom-20 left-4 z-10">
        {!hasApiKey && (
          <button 
            onClick={() => setIsVisible(true)}
            className="bg-blue-600 text-white px-3 py-2 rounded shadow-lg hover:bg-blue-700"
          >
            Set API Key
          </button>
        )}
      </div>
    );
  }
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
          Gemini API Key Setup
        </h2>
        
        <p className="mb-4 text-gray-700 dark:text-gray-300">
          You need a Gemini API key for object detection to work. 
          You can get one for free from <a href="https://aistudio.google.com/app/apikey" 
            target="_blank" rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 underline">
            Google AI Studio
          </a>.
        </p>
        
        <div className="space-y-4">
          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Your Gemini API Key
            </label>
            <input
              type="password"
              id="apiKey"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
          
          {successMessage && (
            <div className="bg-green-100 dark:bg-green-900 border-l-4 border-green-500 text-green-700 dark:text-green-300 p-3 rounded">
              {successMessage}
            </div>
          )}
          
          <div className="flex justify-between">
            <button
              onClick={() => setIsVisible(false)}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveApiKey}
              disabled={!apiKey.trim() || isSaving}
              className={`px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center ${
                !apiKey.trim() || isSaving ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {isSaving ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block animate-spin mr-2"></span>
                  Saving...
                </>
              ) : (
                'Save API Key'
              )}
            </button>
          </div>
          
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Your API key will be stored securely in your browser and never sent to our servers.
          </p>
        </div>
      </div>
    </div>
  );
}