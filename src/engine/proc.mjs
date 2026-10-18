// 子进程小工具：跑一条命令、按行收输出、超时杀掉。不用 shell。
import { spawn } from 'node:child_process'

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string,string>, timeoutMs?: number, onLine?: (line: string) => void, signal?: AbortSignal }} opts
 * @returns {Promise<{ code: number|null, out: string, timedOut: boolean }>}
 */
export function run(cmd, args, { cwd, env, timeoutMs = 600_000, onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      reject(error)
      return
    }
    let out = ''
    let pending = ''
    let timedOut = false
    const take = chunk => {
      const text = chunk.toString('utf8')
      out += text
      if (out.length > 4 << 20) out = out.slice(-(2 << 20))
      if (!onLine) return
      pending += text
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) onLine(line)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    const kill = () => { try { child.kill('SIGKILL') } catch { /* 已退出 */ } }
    const timer = setTimeout(() => { timedOut = true; kill() }, timeoutMs)
    const onAbort = () => kill()
    signal?.addEventListener('abort', onAbort, { once: true })
    child.once('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(error) })
    child.once('close', code => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (pending.trim() && onLine) onLine(pending)
      resolve({ code, out, timedOut })
    })
  })
}

/** 取输出最后 n 行（给界面看）。 */
export function tail(text, n = 20) {
  return text.split(/\r?\n/).filter(l => l.trim()).slice(-n).join('\n')
}
