import axios from "axios";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

export interface GenerateImageToolRequest {
  prompt: string;
  model?: string;
  save_path?: string;
}

const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image";

function saveBase64Image(base64Data: string, mimeType: string, savePath: string): string {
  try {
    // Ensure directory exists
    const dir = dirname(savePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Decode base64 and write to file
    const buffer = Buffer.from(base64Data, "base64");
    writeFileSync(savePath, buffer);
    return savePath;
  } catch (error) {
    throw new Error(`Failed to save image to ${savePath}: ${error}`);
  }
}

export async function handleGenerateImage(
  request: { params: { arguments: GenerateImageToolRequest } },
  apiKey: string
): Promise<{
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}> {
  const args = request.params.arguments;

  if (!args.prompt || args.prompt.trim().length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "Prompt is required for image generation.",
        },
      ],
      isError: true,
    };
  }

  const model = args.model || DEFAULT_IMAGE_MODEL;

  try {
    console.error(`Generating image with model: ${model}`);
    console.error(`Prompt: ${args.prompt.substring(0, 100)}...`);

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model,
        messages: [
          {
            role: "user",
            content: `Generate an image: ${args.prompt}`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/stabgan/openrouter-mcp-multimodal",
          "X-Title": "OpenRouter MCP Multimodal Server",
        },
        timeout: 120000, // 2 minutes for image generation
      }
    );

    const data = response.data;
    console.error("Response received:", JSON.stringify(data).substring(0, 500));

    // Check if the response contains choices
    if (!data.choices || data.choices.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No response from model. Raw response: ${JSON.stringify(data).substring(0, 500)}`,
          },
        ],
        isError: true,
      };
    }

    const message = data.choices[0].message;
    const content = message.content;
    const images = message.images; // OpenRouter returns images in a separate array!

    // DEBUG: Log the full message structure
    console.error("Full message structure:", JSON.stringify(message, null, 2).substring(0, 2000));

    // Helper function to process results with optional save
    const processResult = (base64Data: string, mimeType: string): Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }> => {
      if (args.save_path) {
        const savedPath = saveBase64Image(base64Data, mimeType, args.save_path);
        return [
          {
            type: "text",
            text: `Image saved to: ${savedPath}`,
          },
          {
            type: "image",
            mimeType,
            data: base64Data,
          },
        ];
      }
      return [
        {
          type: "image",
          mimeType,
          data: base64Data,
        },
      ];
    };

    // Handle different response formats
    
    // 0. Check for images array (OpenRouter/Gemini style)
    if (images && Array.isArray(images) && images.length > 0) {
      console.error("Found images array with", images.length, "images");
      const results: Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
      }> = [];

      // Add text content first if present
      if (typeof content === "string" && content.trim()) {
        results.push({
          type: "text",
          text: content,
        });
      }

      // Process each image
      for (const img of images) {
        if (img.type === "image_url" && img.image_url?.url) {
          const url = img.image_url.url;
          if (url.startsWith("data:")) {
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              console.error("Processing base64 image, mime:", match[1], "data length:", match[2].length);
              results.push(...processResult(match[2], match[1]));
            }
          } else {
            results.push({
              type: "text",
              text: `Generated image URL: ${url}`,
            });
          }
        }
      }

      if (results.length > 0) {
        return { content: results };
      }
    }

    // 1. Content is an array with image parts
    if (Array.isArray(content)) {
      console.error("Content is array with", content.length, "parts");
      const results: Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
      }> = [];

      for (const part of content) {
        console.error("Part type:", part.type, "keys:", Object.keys(part));
        
        // Handle image_url format (OpenAI style)
        if (part.type === "image_url" && part.image_url?.url) {
          const url = part.image_url.url;

          // If it's a base64 data URL
          if (url.startsWith("data:")) {
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              results.push(...processResult(match[2], match[1]));
            }
          } else {
            // It's a regular URL - return it
            results.push({
              type: "text",
              text: `Generated image URL: ${url}`,
            });
          }
        } 
        // Handle inline_data format (Google style) - at part level
        else if (part.type === "inline_data" || part.inline_data) {
          const inlineData = part.inline_data || part;
          if (inlineData.data && inlineData.mime_type) {
            results.push(...processResult(inlineData.data, inlineData.mime_type));
          }
        }
        // Handle image type with data directly
        else if (part.type === "image" && part.data) {
          const mimeType = part.mime_type || part.mimeType || "image/png";
          results.push(...processResult(part.data, mimeType));
        }
        // Handle text
        else if (part.type === "text" && part.text) {
          results.push({
            type: "text",
            text: part.text,
          });
        }
        // Handle base64 data in url field directly
        else if (part.url && part.url.startsWith("data:")) {
          const match = part.url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            results.push(...processResult(match[2], match[1]));
          }
        }
      }

      if (results.length > 0) {
        return { content: results };
      }
    }

    // 2. Content is a string (maybe contains base64 or URL)
    if (typeof content === "string") {
      // Check if it contains inline base64 image data
      const base64Match = content.match(
        /data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)/
      );
      if (base64Match) {
        return {
          content: processResult(base64Match[2], `image/${base64Match[1]}`),
        };
      }

      // Check for image URL in the content
      const urlMatch = content.match(
        /https?:\/\/[^\s"'<>]+\.(png|jpg|jpeg|gif|webp)/i
      );
      if (urlMatch) {
        return {
          content: [
            {
              type: "text",
              text: `Generated image URL: ${urlMatch[0]}`,
            },
          ],
        };
      }

      // Return raw content if nothing else matches
      return {
        content: [
          {
            type: "text",
            text: content,
          },
        ],
      };
    }

    // 3. Check for inline_data format (some models use this)
    if (content?.parts) {
      const results: Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
      }> = [];

      for (const part of content.parts) {
        if (part.inline_data) {
          results.push(...processResult(part.inline_data.data, part.inline_data.mime_type));
        } else if (part.text) {
          results.push({
            type: "text",
            text: part.text,
          });
        }
      }

      if (results.length > 0) {
        return { content: results };
      }
    }

    // Fallback: return raw response for debugging
    return {
      content: [
        {
          type: "text",
          text: `DEBUG: Content type=${typeof content}, isArray=${Array.isArray(content)}, keys=${content ? Object.keys(content).join(',') : 'null'}. Full message: ${JSON.stringify(message).substring(0, 2000)}`,
        },
      ],
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data ||
        error.message;
      console.error("API Error:", errorMessage);
      return {
        content: [
          {
            type: "text",
            text: `OpenRouter API error: ${JSON.stringify(errorMessage).substring(0, 500)}`,
          },
        ],
        isError: true,
      };
    }
    throw error;
  }
}

