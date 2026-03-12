import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';

// Maximum context tokens
const MAX_CONTEXT_TOKENS = 200000;

export interface ChatCompletionToolRequest {
  model?: string;
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  max_tokens?: number;
}

// Utility function to estimate token count (simplified)
function estimateTokenCount(text: string): number {
  // Rough approximation: 4 characters per token
  return Math.ceil(text.length / 4);
}

// Truncate messages to fit within the context window
function truncateMessagesToFit(
  messages: ChatCompletionMessageParam[], 
  maxTokens: number
): ChatCompletionMessageParam[] {
  const truncated: ChatCompletionMessageParam[] = [];
  let currentTokenCount = 0;

  // Always include system message first if present
  if (messages[0]?.role === 'system') {
    truncated.push(messages[0]);
    currentTokenCount += estimateTokenCount(messages[0].content as string);
  }

  // Add messages from the end, respecting the token limit
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    
    // Skip if it's the system message we've already added
    if (i === 0 && message.role === 'system') continue;
    
    // For string content, estimate tokens directly
    if (typeof message.content === 'string') {
      const messageTokens = estimateTokenCount(message.content);
      if (currentTokenCount + messageTokens > maxTokens) break;
      truncated.unshift(message);
      currentTokenCount += messageTokens;
    } 
    // For multimodal content (array), estimate tokens for text content
    else if (Array.isArray(message.content)) {
      let messageTokens = 0;
      for (const part of message.content) {
        if (part.type === 'text' && part.text) {
          messageTokens += estimateTokenCount(part.text);
        } else if (part.type === 'image_url') {
          // Add a token cost estimate for images - this is a simplification
          // Actual image token costs depend on resolution and model
          messageTokens += 1000; 
        }
      }
      
      if (currentTokenCount + messageTokens > maxTokens) break;
      truncated.unshift(message);
      currentTokenCount += messageTokens;
    }
  }

  return truncated;
}

// Find a suitable free model with the largest context window
async function findSuitableFreeModel(openai: OpenAI): Promise<string> {
  try {
    // Query available models with 'free' in their name
    const modelsResponse = await openai.models.list();
    if (!modelsResponse || !modelsResponse.data || modelsResponse.data.length === 0) {
      return 'deepseek/deepseek-chat-v3-0324:free'; // Fallback to a known model
    }
    
    // Filter models with 'free' in ID
    const freeModels = modelsResponse.data
      .filter(model => model.id.includes('free'))
      .map(model => {
        // Try to extract context length from the model object
        let contextLength = 0;
        try {
          const modelAny = model as any; // Cast to any to access non-standard properties
          if (typeof modelAny.context_length === 'number') {
            contextLength = modelAny.context_length;
          } else if (modelAny.context_window) {
            contextLength = parseInt(modelAny.context_window, 10);
          }
        } catch (e) {
          console.error(`Error parsing context length for model ${model.id}:`, e);
        }
        
        return {
          id: model.id,
          contextLength: contextLength || 0
        };
      });
    
    if (freeModels.length === 0) {
      return 'deepseek/deepseek-chat-v3-0324:free'; // Fallback if no free models found
    }
    
    // Sort by context length and pick the one with the largest context window
    freeModels.sort((a, b) => b.contextLength - a.contextLength);
    console.error(`Selected free model: ${freeModels[0].id} with context length: ${freeModels[0].contextLength}`);
    
    return freeModels[0].id;
  } catch (error) {
    console.error('Error finding suitable free model:', error);
    return 'deepseek/deepseek-chat-v3-0324:free'; // Fallback to a known model
  }
}

export async function handleChatCompletion(
  request: { params: { arguments: ChatCompletionToolRequest } },
  openai: OpenAI,
  defaultModel?: string
) {
  const args = request.params.arguments;
  
  // Validate message array
  if (args.messages.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'Messages array cannot be empty. At least one message is required.',
        },
      ],
      isError: true,
    };
  }

  try {
    // Select model with priority:
    // 1. User-specified model
    // 2. Default model from environment
    // 3. Free model with the largest context window (selected automatically)
    let model = args.model || defaultModel;
    
    if (!model) {
      model = await findSuitableFreeModel(openai);
      console.error(`Using auto-selected model: ${model}`);
    }
    
    // Truncate messages to fit within context window
    const truncatedMessages = truncateMessagesToFit(args.messages, MAX_CONTEXT_TOKENS);
    
    console.error(`Making API call with model: ${model}`);

    const completion = await openai.chat.completions.create({
      model,
      messages: truncatedMessages,
      temperature: args.temperature ?? 1,
      ...(args.max_tokens && { max_tokens: args.max_tokens }),
    });

    return {
      content: [
        {
          type: 'text',
          text: completion.choices[0].message.content || '',
        },
      ],
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        content: [
          {
            type: 'text',
            text: `OpenRouter API error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
    throw error;
  }
}
