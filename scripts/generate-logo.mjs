#!/usr/bin/env node
/**
 * Generate the project logo by calling OpenRouter through our own
 * `generate_image` handler. Uses the compiled dist bundle so this
 * exercises the same code path a published user would hit.
 *
 * Writes:
 *   assets/logo.png      — the raw generation (square canvas ~1024px)
 *   assets/logo-hero.png — optional hero banner if the prompt produces one
 */
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';

const { handleGenerateImage } = await import('../dist/tool-handlers/generate-image.js');

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

process.env.OPENROUTER_OUTPUT_DIR = path.resolve('assets');
await fs.mkdir(process.env.OPENROUTER_OUTPUT_DIR, { recursive: true });

// Logo prompt — designed to read well at 200px and still look sharp at 1024px.
const logoPrompt = [
  'A modern minimalist tech logo icon for an AI developer tool,',
  'abstract geometric router/hub symbol representing a central node with branching',
  'connections to text, vision (image), audio (waveform), and video (film strip) modality glyphs,',
  'each branch a different accent color (electric blue, magenta, amber, mint green)',
  'fanning out from a luminous navy-indigo core,',
  'clean vector style, flat shading with subtle gradient lighting from top-left,',
  'no text, no letters, no wordmarks, centered composition on a transparent',
  'neutral dark background, crisp anti-aliased edges, suitable for a GitHub README avatar,',
  'square 1:1 aspect ratio, high contrast, premium developer-tool aesthetic,',
  'reminiscent of Vercel / Stripe / Linear brand quality.',
].join(' ');

console.log('Generating logo via generate_image (model: google/gemini-2.5-flash-image)...');
const result = await handleGenerateImage(
  {
    params: {
      arguments: {
        prompt: logoPrompt,
        save_path: 'logo.png',
      },
    },
  },
  openai,
);

if (result.isError) {
  console.error('Logo generation failed:', JSON.stringify(result._meta, null, 2));
  console.error('Text:', result.content[0]?.text);
  process.exit(1);
}

const text = result.content?.find((c) => c.type === 'text')?.text;
console.log('✓', text);
console.log('_meta:', JSON.stringify(result._meta, null, 2));
