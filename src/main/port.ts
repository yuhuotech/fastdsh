import { createServer } from 'node:net'

/**
 * Pick a free loopback port by letting the OS assign one, then releasing it.
 * There is an inherent (tiny) race between close() and the Harness child
 * binding it, which is acceptable for a local desktop app and avoids
 * colliding with a manually started `dsh web` on the default port 3080.
 */
export function findFreePort (): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('failed to allocate a loopback port'))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })
}
