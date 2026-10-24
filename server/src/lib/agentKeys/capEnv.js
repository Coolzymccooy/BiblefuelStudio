/**
 * The environment variables that set each daily agent cap's ceiling. Pure (no
 * env read, no file access), so MCP tool modules can name them in messages
 * without importing caps.js, which reads DATA_DIR at import time.
 */
export const CAP_ENV_NAMES = Object.freeze({
  renders: "MCP_DAILY_RENDERS",
  aiVideoUsd: "MCP_DAILY_AI_VIDEO_USD",
  images: "MCP_DAILY_IMAGES",
  tts: "MCP_DAILY_TTS",
  publishes: "MCP_DAILY_PUBLISHES",
  imports: "MCP_DAILY_IMPORTS",
});
