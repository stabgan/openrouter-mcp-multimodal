/** MCP tool icons — inline SVG data URIs; ignored by clients that don't support them. */
function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`;
}

const ICONS = {
  chat: svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  ),
  chatAsync: svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="17" cy="7" r="3" fill="#8b5cf6"/></svg>`,
  ),
  image: svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`,
  ),
  audio: svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  ),
  mic: svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`,
  ),
  video: svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>`,
  ),
  search: svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  ),
  info: svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  ),
  check: svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>`,
  ),
  rerank: svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`,
  ),
  health: svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
  ),
  speaker: svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
  ),
  poll: svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/></svg>`,
  ),
} as const;

export type ToolIcon = Array<{ src: string; mimeType: string; sizes: string[] }>;

function icon(src: string): ToolIcon {
  return [{ src, mimeType: 'image/svg+xml', sizes: ['24x24'] }];
}

/** Map of tool name → icons array for use in tool definitions. */
export const TOOL_ICONS: Record<string, ToolIcon> = {
  chat_completion: icon(ICONS.chat),
  start_chat_completion: icon(ICONS.chatAsync),
  get_chat_completion_status: icon(ICONS.poll),
  analyze_image: icon(ICONS.image),
  analyze_audio: icon(ICONS.audio),
  analyze_video: icon(ICONS.video),
  search_models: icon(ICONS.search),
  get_model_info: icon(ICONS.info),
  validate_model: icon(ICONS.check),
  generate_image: icon(ICONS.image),
  generate_image_dedicated: icon(ICONS.image),
  generate_audio: icon(ICONS.audio),
  text_to_speech: icon(ICONS.speaker),
  speech_to_text: icon(ICONS.mic),
  generate_video: icon(ICONS.video),
  generate_video_from_image: icon(ICONS.video),
  get_video_status: icon(ICONS.poll),
  rerank_documents: icon(ICONS.rerank),
  health_check: icon(ICONS.health),
};

/** Server icon for use in the Server initialization metadata. */
export const SERVER_ICON: ToolIcon = [
  {
    src: svgDataUri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#1a1a2e"/><path d="M14 24h20M24 14v20" stroke="#6366f1" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="24" r="8" stroke="#22c55e" stroke-width="2"/><circle cx="24" cy="24" r="3" fill="#6366f1"/></svg>`,
    ),
    mimeType: 'image/svg+xml',
    sizes: ['48x48'],
  },
];
