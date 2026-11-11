import type { FastifyInstance } from 'fastify'
import type { ApiErrorCode } from '@lab/shared'

const STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  REPORT_LOCKED: 409,
  INTERNAL: 500
}

export class AppError extends Error {
  code: ApiErrorCode
  status: number
  details?: unknown

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message)
    this.code = code
    this.status = STATUS[code] ?? 500
    this.details = details
  }

  static unauthenticated(message = '请先登录') { return new AppError('UNAUTHENTICATED', message) }
  static forbidden(message = '没有权限执行该操作') { return new AppError('FORBIDDEN', message) }
  static notFound(message = '数据不存在') { return new AppError('NOT_FOUND', message) }
  static validation(message = '参数校验失败', details?: unknown) { return new AppError('VALIDATION', message, details) }
  static conflict(message: string) { return new AppError('CONFLICT', message) }
  static locked(message: string) { return new AppError('REPORT_LOCKED', message) }
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } })
    }
    const anyErr = err as { statusCode?: number; validation?: unknown; message?: string }
    if (anyErr.validation) {
      return reply.status(422).send({ error: { code: 'VALIDATION', message: anyErr.message ?? '参数校验失败', details: anyErr.validation } })
    }
    const status = anyErr.statusCode && anyErr.statusCode >= 400 && anyErr.statusCode < 500 ? anyErr.statusCode : 500
    request.log.error({ err }, 'unhandled error')
    return reply.status(status).send({
      error: { code: status === 500 ? 'INTERNAL' : 'VALIDATION', message: status === 500 ? '服务器内部错误' : (anyErr.message ?? '请求有误') }
    })
  })

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在: ' + request.method + ' ' + request.url } })
  })
}
