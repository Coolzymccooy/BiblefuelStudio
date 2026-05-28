import { Router } from 'express'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import * as alignmentModule from '../lib/voice/alignment.js'
import { extractAudioToMp3 } from '../lib/transcode.js'

/**
 * Create transcribe router with dependency injection for testing
 * @param {Object} deps - Dependencies
 * @param {Function} deps.chunkAudioForTranscription - Chunk audio function
 * @param {Function} deps.transcribeAudio - Transcribe audio function
 * @param {Function} deps.stitchTranscriptions - Stitch transcriptions function
 * @param {Function} deps.stat - File stat function (for testing)
 * @param {Function} deps.spawn - Process spawn function (for testing)
 * @param {Function} deps.extractAudioToMp3 - Extract audio function (for testing)
 * @returns {Router} Express router
 */
function createTranscribeRouter(deps = {}) {
  const {
    chunkAudioForTranscription = alignmentModule.chunkAudioForTranscription,
    transcribeAudio = alignmentModule.transcribeAudio,
    stitchTranscriptions = alignmentModule.stitchTranscriptions,
    stat: statFn = stat,
    spawn: spawnFn = spawn,
    extractAudioToMp3: extractAudioToMp3Fn = extractAudioToMp3
  } = deps

  const router = Router()

  /**
   * Probe audio duration using ffprobe
   * @param {string} filePath
   * @returns {Promise<number>} duration in milliseconds
   */
  async function probeDurationMs(filePath) {
    return new Promise((resolve, reject) => {
      const proc = spawnFn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1:csv_list=1',
        filePath
      ])

      let stdout = ''
      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`ffprobe failed with code ${code}`))
        }
        const seconds = parseFloat(stdout.trim())
        if (isNaN(seconds)) {
          return reject(new Error('Could not parse duration from ffprobe'))
        }
        resolve(Math.round(seconds * 1000))
      })

      proc.on('error', reject)
    })
  }

  /**
   * POST /api/transcribe
   * Transcribe audio from a video or audio file
   *
   * Body:
   *   - mediaPath: string (required) - path to video or audio file
   *
   * Returns:
   *   {
   *     ok: true,
   *     audioPath: string,
   *     durationMs: number,
   *     words: [{ text, startMs, endMs }, ...]
   *   }
   */
  router.post('/', async (req, res) => {
    try {
      const { mediaPath } = req.body

      // Validate mediaPath
      if (!mediaPath) {
        return res.status(400).json({ error: 'mediaPath is required' })
      }

      // Check file exists
      try {
        await statFn(mediaPath)
      } catch (e) {
        return res.status(400).json({ error: `mediaPath does not exist: ${mediaPath}` })
      }

      // Detect if video or audio based on extension
      const ext = extname(mediaPath).toLowerCase()
      const videoExts = ['.mp4', '.mov', '.webm', '.m4v', '.mkv']
      const isVideo = videoExts.includes(ext)

      // Extract audio if needed
      let audioPath = mediaPath
      if (isVideo) {
        audioPath = await extractAudioToMp3Fn(mediaPath, req.ctx.outputDir)
      }

      // Probe duration
      const durationMs = await probeDurationMs(audioPath)

      // Chunk audio if longer than 40 minutes
      const CHUNK_DURATION_MS = 40 * 60 * 1000
      const chunks = await chunkAudioForTranscription(
        audioPath,
        req.ctx.outputDir,
        durationMs > CHUNK_DURATION_MS ? CHUNK_DURATION_MS : durationMs
      )

      // Transcribe each chunk in parallel
      const transcribedChunks = await Promise.all(
        chunks.map((chunk) =>
          transcribeAudio(chunk.path, { offsetMs: chunk.offsetMs })
        )
      )

      // Check if any chunk failed to transcribe
      if (transcribedChunks.some((result) => result === null)) {
        return res.status(502).json({ error: 'Transcription failed for one or more chunks' })
      }

      // Stitch transcriptions together
      const stitched = stitchTranscriptions(transcribedChunks)

      // Verify we got words
      if (!stitched || !stitched.words || stitched.words.length === 0) {
        return res.status(502).json({ error: 'No words extracted from transcription' })
      }

      res.json({
        ok: true,
        audioPath,
        durationMs,
        words: stitched.words
      })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  return router
}

// Default export: router with real implementations
const router = createTranscribeRouter()

export { router as transcribeRouter, createTranscribeRouter }
