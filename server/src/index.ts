import { buildApp } from './app'
import { disconnectPrisma } from './lib/prisma'

const port = Number(process.env.PORT ?? 4000)
const host = process.env.HOST ?? '0.0.0.0'

const app = await buildApp()

async function shutdown(signal: string): Promise<void> {
  app.log.info('收到 ' + signal + '，正在关闭服务')
  await app.close()
  await disconnectPrisma()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ port, host })
  app.log.info('lab-asset-hub server listening on http://' + host + ':' + String(port))
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
