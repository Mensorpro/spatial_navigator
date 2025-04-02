import { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { ModelSelectedAtom } from '../atoms';

interface LogMessage {
  type: 'error' | 'info' | 'warning';
  message: string;
  timestamp: number;
}

interface RateLimitInfo {
  requestsRemaining: number;
  requestsConsumed: number;
  resetTimestamp: number | null;
  lastUpdated: number;
  quotaExceeded: boolean;
}

export function ConsoleCard() {
  const [messages, setMessages] = useState<LogMessage[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [modelSelected] = useAtom(ModelSelectedAtom);
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo>({
    requestsRemaining: 15, // Default Gemini rate limit per minute
    requestsConsumed: 0,
    resetTimestamp: null,
    lastUpdated: Date.now(),
    quotaExceeded: false
  });

  // Override console methods to capture logs
  useEffect(() => {
    const originalConsole = {
      error: console.error,
      log: console.log,
      warn: console.warn
    };

    console.error = (...args) => {
      originalConsole.error(...args);
      const message = args.join(' ');
      addMessage('error', message);
      
      // Check for rate limit related errors
      if (message.includes('429') || 
          message.includes('rate limit') || 
          message.includes('quota') ||
          message.includes('retryDelay')) {
        
        updateRateLimitInfo({
          quotaExceeded: true,
          requestsRemaining: 0
        });
        
        // Extract retry delay if available
        const retryDelayMatch = message.match(/retryDelay":"(\d+)s"/);
        if (retryDelayMatch && retryDelayMatch[1]) {
          const delaySeconds = parseInt(retryDelayMatch[1]);
          const resetTime = Date.now() + (delaySeconds * 1000);
          updateRateLimitInfo({ resetTimestamp: resetTime });
        } else {
          // Default 60 second reset if not specified
          updateRateLimitInfo({ resetTimestamp: Date.now() + 60000 });
        }
      }
    };

    console.log = (...args) => {
      originalConsole.log(...args);
      const message = args.join(' ');
      addMessage('info', message);
      
      // Check for successful API calls
      if (message.includes('successfully') || 
          message.includes('response') || 
          message.includes('generateContent')) {
        updateRateLimitInfo({
          requestsConsumed: rateLimitInfo.requestsConsumed + 1,
          requestsRemaining: Math.max(0, rateLimitInfo.requestsRemaining - 1)
        });
      }
    };

    console.warn = (...args) => {
      originalConsole.warn(...args);
      addMessage('warning', args.join(' '));
    };

    return () => {
      console.error = originalConsole.error;
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
    };
  }, [rateLimitInfo]);

  // Reset rate limits after 60 seconds
  useEffect(() => {
    const checkRateLimit = setInterval(() => {
      const now = Date.now();
      
      // If reset timestamp is set and reached
      if (rateLimitInfo.resetTimestamp && now >= rateLimitInfo.resetTimestamp) {
        updateRateLimitInfo({
          requestsRemaining: 15, // Reset to default limit
          quotaExceeded: false,
          resetTimestamp: null
        });
        addMessage('info', 'API rate limit has reset. You can make new requests now.');
      }
      
      // Reset requests consumed every minute
      if (now - rateLimitInfo.lastUpdated > 60000) {
        // Only reset if not in quota exceeded state
        if (!rateLimitInfo.quotaExceeded) {
          updateRateLimitInfo({
            requestsRemaining: 15,
            requestsConsumed: 0,
            lastUpdated: now
          });
        }
      }
    }, 1000);
    
    return () => {
      clearInterval(checkRateLimit);
    };
  }, [rateLimitInfo]);

  const updateRateLimitInfo = (updates: Partial<RateLimitInfo>) => {
    setRateLimitInfo(prev => ({
      ...prev,
      ...updates
    }));
  };

  const addMessage = (type: 'error' | 'info' | 'warning', message: string) => {
    setMessages(prev => {
      // Keep only last 50 messages
      const newMessages = [...prev, { type, message, timestamp: Date.now() }];
      if (newMessages.length > 50) {
        return newMessages.slice(-50);
      }
      return newMessages;
    });
  };

  const getResetTimeString = () => {
    if (!rateLimitInfo.resetTimestamp) return 'N/A';
    
    const seconds = Math.max(0, Math.floor((rateLimitInfo.resetTimestamp - Date.now()) / 1000));
    return seconds > 0 ? `${seconds}s` : 'Now';
  };

  if (isMinimized) {
    return (
      <button 
        onClick={() => setIsMinimized(false)}
        className="fixed bottom-4 right-4 bg-gray-800 text-white p-2 rounded-full shadow-lg z-50 hover:bg-gray-700"
      >
        {rateLimitInfo.quotaExceeded ? '⚠️' : '🔍'}
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-gray-800 text-white rounded-lg shadow-lg z-50 max-h-[80vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔍</span>
          <h3 className="font-medium">Debug Console</h3>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="hover:bg-gray-700 p-1 rounded"
          >
            {isExpanded ? '▼' : '▲'}
          </button>
          <button 
            onClick={() => setIsMinimized(true)}
            className="hover:bg-gray-700 p-1 rounded"
          >
            _
          </button>
          <button 
            onClick={() => setMessages([])}
            className="hover:bg-gray-700 p-1 rounded text-sm"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Rate Limits Info */}
      <div className="p-3 border-b border-gray-700">
        <div className="flex justify-between items-center text-sm">
          <span>API Status:</span>
          <span className={rateLimitInfo.quotaExceeded ? "text-red-400" : "text-green-400"}>
            {rateLimitInfo.quotaExceeded ? 'Rate Limited' : 'Ready'}
          </span>
        </div>
        
        <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-sm">
          <div>Requests Remaining:</div>
          <div className={rateLimitInfo.requestsRemaining < 3 ? "text-yellow-400" : "text-white"}>
            {rateLimitInfo.requestsRemaining}/15 per min
          </div>
          
          <div>Requests Consumed:</div>
          <div>{rateLimitInfo.requestsConsumed} this minute</div>
          
          <div>Reset In:</div>
          <div>{getResetTimeString()}</div>
          
          <div>Model:</div>
          <div className="truncate">{modelSelected || 'gemini-1.5-flash'}</div>
        </div>
        
        {rateLimitInfo.quotaExceeded && (
          <div className="mt-2 text-xs bg-red-900/30 p-2 rounded">
            Rate limit exceeded. The app will automatically retry when the quota resets.
          </div>
        )}
      </div>

      {/* Messages */}
      {isExpanded && (
        <div className="overflow-y-auto p-3 space-y-2 max-h-[40vh]">
          {messages.length === 0 ? (
            <div className="text-gray-500 text-center py-4">
              No messages yet
            </div>
          ) : (
            messages.map((msg, i) => (
              <div 
                key={i} 
                className={`p-2 rounded text-sm font-mono break-all ${
                  msg.type === 'error' ? 'bg-red-900/50' :
                  msg.type === 'warning' ? 'bg-yellow-900/50' :
                  'bg-gray-700/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>
                    {msg.type === 'error' ? '❌' :
                     msg.type === 'warning' ? '⚠️' : 'ℹ️'}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="mt-1">
                  {msg.message}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}