import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { join } from 'node:path'
import Express from 'express'
import { createTranscribeRouter } from '../../src/routes/transcribe.js'

// Helper to create test app with context middleware and optional mock dependencies
function makeApp(mockDeps = {}) {
  const app = Express()
  app.use(Express.json())

  // Context middleware
  app.use((req, res, next) => {
    req.ctx = {
      outputDir: join(import.meta.dirname, '..', 'fixtures', 'output'),
      dataDir: join(import.meta.dirname, '..', 'fixtures', 'data')
    }
    next()
  })

  // Create router with injected dependencies for testing
  const router = createTranscribeRouter(mockDeps)
  app.use('/api/transcribe', router)
  return app
}

describe('POST /api/transcribe', () => {
  test('returns 400 when mediaPath is missing', async (t) => {
    const app = makeApp()
    const res = await request(app).post('/api/transcribe').send({})

    assert.equal(res.status, 400)
    assert(res.body.error)
    assert.match(res.body.error, /mediaPath/i)
  })

  test('returns 400 when mediaPath file does not exist', async (t) => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/transcribe')
      .send({ mediaPath: '/nonexistent/file.mp4' })

    assert.equal(res.status, 400)
    assert(res.body.error)
    assert.match(res.body.error, /does not exist/i)
  })

  test('returns { ok: true, words: [...] } on successful transcription', async (t) => {
    // Create mock implementations to pass as dependencies
    const mockDeps = {
      chunkAudioForTranscription: async () => {
        return [{ path: '/fake/chunk.wav', offsetMs: 0 }]
      },
      transcribeAudio: async () => {
        return {
          words: [
            { text: 'hello', startMs: 0, endMs: 500 },
            { text: 'world', startMs: 500, endMs: 1000 }
          ]
        }
      },
      stitchTranscriptions: () => {
        return {
          words: [
            { text: 'hello', startMs: 0, endMs: 500 },
            { text: 'world', startMs: 500, endMs: 1000 }
          ]
        }
      },
      stat: async () => {
        return { size: 1024 }
      },
      spawn: (cmd, args) => {
        if (cmd === 'ffprobe') {
          return {
            stdout: {
              on: (event, cb) => {
                if (event === 'data') {
                  cb('120.5')
                }
              }
            },
            on: (event, cb) => {
              if (event === 'close') {
                cb(0)
              }
            }
          }
        }
        return null
      },
      extractAudioToMp3: async (mediaPath) => {
        return mediaPath
      }
    }

    const app = makeApp(mockDeps)
    const res = await request(app)
      .post('/api/transcribe')
      .send({ mediaPath: '/fake/audio.mp3' })

    assert.equal(res.status, 200)
    assert(res.body.ok === true)
    assert(Array.isArray(res.body.words))
    assert.equal(res.body.words.length, 2)
    assert.equal(res.body.words[0].text, 'hello')
  })

  test('returns 502 when transcription fails for a chunk', async (t) => {
    const mockDeps = {
      chunkAudioForTranscription: async () => {
        return [
          { path: '/fake/chunk1.wav', offsetMs: 0 },
          { path: '/fake/chunk2.wav', offsetMs: 60000 }
        ]
      },
      transcribeAudio: async (path) => {
        // Simulate failure on second chunk
        if (path === '/fake/chunk2.wav') {
          return null
        }
        return {
          words: [{ text: 'hello', startMs: 0, endMs: 500 }]
        }
      },
      stitchTranscriptions: () => null,
      stat: async () => {
        return { size: 1024 }
      },
      spawn: (cmd) => {
        if (cmd === 'ffprobe') {
          return {
            stdout: {
              on: (event, cb) => {
                if (event === 'data') {
                  cb('120.5')
                }
              }
            },
            on: (event, cb) => {
              if (event === 'close') {
                cb(0)
              }
            }
          }
        }
        return null
      },
      extractAudioToMp3: async (mediaPath) => {
        return mediaPath
      }
    }

    const app = makeApp(mockDeps)
    const res = await request(app)
      .post('/api/transcribe')
      .send({ mediaPath: '/fake/audio.mp3' })

    assert.equal(res.status, 502)
    assert(res.body.error)
    assert.match(res.body.error, /transcription failed/i)
  })

  test('returns 502 when no words extracted from transcription', async (t) => {
    const mockDeps = {
      chunkAudioForTranscription: async () => {
        return [{ path: '/fake/chunk.wav', offsetMs: 0 }]
      },
      transcribeAudio: async () => {
        return { words: [] }
      },
      stitchTranscriptions: () => {
        return { words: [] }
      },
      stat: async () => {
        return { size: 1024 }
      },
      spawn: (cmd) => {
        if (cmd === 'ffprobe') {
          return {
            stdout: {
              on: (event, cb) => {
                if (event === 'data') {
                  cb('120.5')
                }
              }
            },
            on: (event, cb) => {
              if (event === 'close') {
                cb(0)
              }
            }
          }
        }
        return null
      },
      extractAudioToMp3: async (mediaPath) => {
        return mediaPath
      }
    }

    const app = makeApp(mockDeps)
    const res = await request(app)
      .post('/api/transcribe')
      .send({ mediaPath: '/fake/audio.mp3' })

    assert.equal(res.status, 502)
    assert(res.body.error)
    assert.match(res.body.error, /no words extracted/i)
  })
})
