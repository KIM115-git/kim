#!/usr/bin/env node
/**
 * image-vision-mcp
 *
 * An MCP server that gives pure-text models (like DeepSeek) the ability
 * to "see" images. It routes images through a vision-capable model
 * (GPT-4o, Claude, DeepSeek-OCR, etc.) and returns text descriptions.
 *
 * Inspired by the Douyin video concept — bridging the gap between
 * text-only LLMs and visual understanding.
 *
 * Usage (Claude Code settings.json):
 *   "image-vision-mcp": {
 *     "command": "node",
 *     "args": ["/path/to/image-vision-mcp/src/index.js"],
 *     "env": {
 *       "VISION_PROVIDER": "openai",          // openai | siliconflow | anthropic | custom
 *       "VISION_API_KEY": "sk-...",
 *       "VISION_MODEL": "gpt-4o",             // optional, defaults by provider
 *       "VISION_BASE_URL": "https://..."       // optional, for custom endpoints
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import OpenAI from "openai";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ─── Configuration ───────────────────────────────────────────
const PROVIDER = process.env.VISION_PROVIDER || "openai";
const API_KEY = process.env.VISION_API_KEY || process.env.OPENAI_API_KEY || "";
const MODEL = process.env.VISION_MODEL || null;
const BASE_URL = process.env.VISION_BASE_URL || null;

// Provider defaults
const PROVIDER_CONFIG = {
  openai: {
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o",
  },
  siliconflow: {
    baseURL: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/deepseek-vl2",
  },
  anthropic: {
    baseURL: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-6",
  },
  custom: {
    baseURL: BASE_URL || "https://api.openai.com/v1",
    model: "gpt-4o",
  },
};

const config = PROVIDER_CONFIG[PROVIDER] || PROVIDER_CONFIG.openai;
const apiKey = API_KEY;
const baseURL = BASE_URL || config.baseURL;
const model = MODEL || config.model;

// ─── Vision Client ───────────────────────────────────────────
let client = null;
function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey, baseURL });
  }
  return client;
}

// ─── Image Loading ───────────────────────────────────────────
function loadImageAsBase64(source) {
  // 1. Try as local file path
  const resolved = resolve(source);
  if (existsSync(resolved)) {
    const buffer = readFileSync(resolved);
    const ext = resolved.split(".").pop().toLowerCase();
    const mimeMap = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
    };
    const mime = mimeMap[ext] || "image/png";
    return { data: buffer.toString("base64"), mime };
  }

  // 2. Try as URL (http/https)
  if (/^https?:\/\//.test(source)) {
    return { data: source, mime: "url" };
  }

  // 3. Assume it's already base64 or a data URI
  if (source.startsWith("data:image/")) {
    const [header, data] = source.split(",");
    const mime = header.match(/data:(image\/\w+);base64/)?.[1] || "image/png";
    return { data, mime };
  }

  // 4. Raw base64
  return { data: source, mime: "image/png" };
}

// ─── Vision API Call ─────────────────────────────────────────
async function callVision(source, prompt, options = {}) {
  const { data, mime } = loadImageAsBase64(source);

  // Construct image_url based on type
  let imageUrl;
  if (mime === "url") {
    imageUrl = data; // Direct URL
  } else {
    imageUrl = `data:${mime};base64,${data}`;
  }

  const messages = [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageUrl } },
        { type: "text", text: prompt },
      ],
    },
  ];

  const response = await getClient().chat.completions.create({
    model,
    messages,
    max_tokens: options.maxTokens || 2000,
    temperature: options.temperature || 0.1,
  });

  return response.choices[0].message.content;
}

// ─── Tool Definitions ────────────────────────────────────────
const TOOLS = [
  {
    name: "analyze_image",
    description: `Analyze and describe an image in detail. Use this when you need to understand what's in a screenshot, photo, diagram, or any visual content.

Supports: local file path, image URL, or base64 data URI.
Example: analyze_image(source="/path/to/screenshot.png", question="What error message is shown in this screenshot?")`,
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Path to local image file, image URL (https://...), or base64 data URI",
        },
        question: {
          type: "string",
          description: "What do you want to know about this image? Be specific — e.g. 'What error is in this screenshot?', 'Describe this UI design', 'Read the text in this photo'",
        },
      },
      required: ["source"],
    },
  },
  {
    name: "ocr_extract",
    description: `Extract all visible text from an image (OCR). Returns text in natural reading order.
Great for screenshots of error messages, scanned documents, or any image containing text.

Supports: local file path, image URL, or base64 data URI.`,
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Path to local image file, image URL, or base64 data URI",
        },
        language: {
          type: "string",
          description: "Language of the text (e.g., 'Chinese', 'English', 'mixed'). Default: auto-detect",
        },
      },
      required: ["source"],
    },
  },
  {
    name: "ocr_precise",
    description: `Extract text from an image with precise position information. Returns structured data with text blocks and their coordinates (bounding boxes).
Use this when you need to know exactly WHERE text appears in the image.

Supports: local file path, image URL, or base64 data URI.`,
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Path to local image file, image URL, or base64 data URI",
        },
      },
      required: ["source"],
    },
  },
];

// ─── Prompt Building ─────────────────────────────────────────
function buildAnalyzePrompt(question) {
  if (question) {
    return `Please analyze this image carefully and answer the following question: "${question}"

If the image contains code, error messages, or UI elements, describe them precisely. Include exact text where relevant.`;
  }
  return `Please describe this image in thorough detail. Include:
1. What type of image is this (screenshot, photo, diagram, document, etc.)?
2. What are the main elements visible?
3. Any text content visible (quote exactly where possible)
4. Colors, layout, and visual style
5. Any problems or notable details

Be as specific and precise as possible.`;
}

function buildOCRPrompt(language) {
  return `Extract ALL visible text from this image.
${language ? `The text language is: ${language}.` : "Auto-detect the language."}

Guidelines:
- Return the text in natural reading order
- Preserve line breaks and paragraph structure
- Include numbers, symbols, and punctuation exactly as shown
- If there are code snippets, preserve the exact formatting
- Do NOT summarize or describe — only output the text content
- If no text is visible, say "No text detected in image"`;
}

function buildPreciseOCRPrompt() {
  return `Perform OCR on this image with precise position information.

For each block of text detected, return a structured object with:
- "text": the text content
- "position": approximate location (e.g., "top-left", "center", "bottom-right")
- "type": the type of text (e.g., "heading", "body", "code", "button-label", "error-message", "log-entry")

Group related text blocks together. Return as a structured list.

Example output format:
[
  {"text": "Error: Connection refused", "position": "top-center", "type": "error-message"},
  {"text": "Retry in 30s...", "position": "bottom-left", "type": "log-entry"}
]`;
}

// ─── Server Setup ────────────────────────────────────────────
const server = new Server(
  {
    name: "image-vision-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "analyze_image": {
        const prompt = buildAnalyzePrompt(args?.question);
        const result = await callVision(args?.source, prompt);
        return { content: [{ type: "text", text: result }] };
      }

      case "ocr_extract": {
        const prompt = buildOCRPrompt(args?.language);
        const result = await callVision(args?.source, prompt, { maxTokens: 4000 });
        return { content: [{ type: "text", text: result }] };
      }

      case "ocr_precise": {
        const prompt = buildPreciseOCRPrompt();
        const result = await callVision(args?.source, prompt, { maxTokens: 4000 });
        return { content: [{ type: "text", text: result }] };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error analyzing image: ${error.message}\n\nProvider: ${PROVIDER}\nModel: ${model}`,
        },
      ],
      isError: true,
    };
  }
});

// ─── Start ───────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`image-vision-mcp started — provider: ${PROVIDER}, model: ${model}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
