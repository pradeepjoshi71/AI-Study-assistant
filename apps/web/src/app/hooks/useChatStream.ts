import { useState, useCallback } from 'react';

export interface CitationEvent {
  chunk_id: string;
  document_id: string;
  page: number;
  text_preview: string;
}

export interface DoneEvent {
  message_id: string;
  total_tokens: number;
}

export function useChatStream(token: string | null) {
  const [streamingText, setStreamingText] = useState('');
  const [citations, setCitations] = useState<CitationEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendStreamRequest = useCallback(
    async (
      message: string,
      conversationId?: string,
      documentIds?: string[],
      mode = 'study',
      enabledPluginKeys?: string[],
    ): Promise<string | null> => {
      if (!token) {
        setError('Authentication token is missing.');
        return null;
      }

      setIsStreaming(true);
      setStreamingText('');
      setCitations([]);
      setError(null);

      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
        const response = await fetch(`${apiUrl}/chat/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            conversationId,
            message,
            documentIds,
            mode,
            enabledPluginKeys,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to initialize SSE stream: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalConvId: string | null = null;
        let finalOutputText = '';

        if (!reader) {
          throw new Error('ReadableStream is not supported by this browser.');
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            if (line.startsWith('event: ')) {
              const eventName = line.replace('event: ', '').trim();
              const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';

              if (nextLine && nextLine.startsWith('data: ')) {
                const dataStr = nextLine.replace('data: ', '').trim();
                i++; // Skip the data line since we processed it

                if (eventName === 'conversationId') {
                  finalConvId = dataStr;
                } else if (eventName === 'citation') {
                  try {
                    const citeObj = JSON.parse(dataStr);
                    setCitations((prev) => [...prev, citeObj]);
                  } catch {
                    console.warn('Failed to parse citation event data:', dataStr);
                  }
                } else if (eventName === 'token') {
                  finalOutputText += dataStr;
                  setStreamingText((prev) => prev + dataStr);
                } else if (eventName === 'done') {
                  // Stream finished successfully
                } else if (eventName === 'error') {
                  setError(dataStr);
                }
              }
            }
          }
        }

        return finalConvId;

      } catch (err: any) {
        setError(err.message || 'Stream processing failed.');
        return null;
      } finally {
        setIsStreaming(false);
      }
    },
    [token],
  );

  return {
    streamingText,
    citations,
    isStreaming,
    error,
    sendStreamRequest,
  };
}
