import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { MediaDTO } from '@yeyu/shared'
import { buildApp } from '../app.js'
import { prisma } from './prisma.js'
import { signToken } from '../plugins/auth.js'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-secret'
process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'yeyu-media-test-'))

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('test-md')) {
  throw new Error('测试必须使用独立测试库，请用 DATABASE_URL="file:./test-md.db" 运行')
}

let app: FastifyInstance
let token = ''

function multipart(filename: string, contentType: string, buffer: Buffer): { body: Buffer; contentType: string } {
  const boundary = '----yeyu-media-test-' + Date.now()
  const chunks: Buffer[] = []
  chunks.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="usage"\r\n\r\nREPORT\r\n'))
  chunks.push(
    Buffer.from(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename +
        '"\r\nContent-Type: ' + contentType + '\r\n\r\n'
    )
  )
  chunks.push(buffer)
  chunks.push(Buffer.from('\r\n--' + boundary + '--\r\n'))
  return { body: Buffer.concat(chunks), contentType: 'multipart/form-data; boundary=' + boundary }
}

/** 44 字节的极简 WAV 头 + 一段静音，够测上传与 Range */
function tinyWav(): Buffer {
  const dataLength = 2000
  const buffer = Buffer.alloc(44 + dataLength)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataLength, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(8000, 24)
  buffer.writeUInt32LE(8000, 28)
  buffer.writeUInt16LE(1, 32)
  buffer.writeUInt16LE(8, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataLength, 40)
  return buffer
}

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
  const user = await prisma.user.create({
    data: { phone: '13500009000', name: '音频测试', role: 'MEMBER', status: 'ACTIVE', passwordHash: 'x' }
  })
  token = signToken({ id: user.id, phone: user.phone, name: user.name, role: 'MEMBER' })
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.media.deleteMany({})
})

describe('媒体上传（音视频）', () => {
  it('音频可以上传，返回的 mime 与大小正确', async () => {
    const wav = tinyWav()
    const form = multipart('测试音频.wav', 'audio/wav', wav)
    const res = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: { authorization: 'Bearer ' + token, 'content-type': form.contentType },
      payload: form.body
    })
    expect(res.statusCode).toBe(201)
    const dto = res.json() as MediaDTO
    expect(dto.mime).toBe('audio/wav')
    expect(dto.size).toBe(wav.byteLength)
  })

  it('视频 MIME 不再被拒绝', async () => {
    const form = multipart('clip.mp4', 'video/mp4', Buffer.from('00000020667479706d703432', 'hex'))
    const res = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: { authorization: 'Bearer ' + token, 'content-type': form.contentType },
      payload: form.body
    })
    expect(res.statusCode).toBe(201)
    expect((res.json() as MediaDTO).mime).toBe('video/mp4')
  })

  it('Range 请求返回 206 与片段，便于拖动进度条', async () => {
    const form = multipart('a.wav', 'audio/wav', tinyWav())
    const created = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: { authorization: 'Bearer ' + token, 'content-type': form.contentType },
      payload: form.body
    })
    const dto = created.json() as MediaDTO

    const rangeRes = await app.inject({
      method: 'GET',
      url: '/api/media/' + dto.id + '?token=' + token,
      headers: { range: 'bytes=0-9' }
    })
    expect(rangeRes.statusCode).toBe(206)
    expect(rangeRes.headers['content-range']).toBe('bytes 0-9/' + dto.size)
    expect(rangeRes.headers['accept-ranges']).toBe('bytes')
    expect(rangeRes.rawPayload.byteLength).toBe(10)
  })

  it('可执行文件仍然被拒绝', async () => {
    const form = multipart('bad.exe', 'application/x-msdownload', Buffer.from('MZ'))
    const res = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: { authorization: 'Bearer ' + token, 'content-type': form.contentType },
      payload: form.body
    })
    expect(res.statusCode).toBe(422)
  })
})
