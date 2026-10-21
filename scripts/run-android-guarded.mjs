import { spawn, execFileSync } from 'node:child_process'

// One foreground task; no scheduled job or restart. Only this child's tree can
// be stopped. All helper windows are hidden, including resource checks.
const taskArgs = process.argv.slice(2)
// Standing no-game authorization is not a game-running exception. Titles in
// QQ, browsers or editors never identify the game (2026-10-15 user rule).
const prioritize = taskArgs[0] === '-PrioritizeBuildWhenNoGame'
if (prioritize) taskArgs.shift()
const [command, ...args] = taskArgs
if (!command) throw new Error('Missing command')
const inspect = () => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "$ErrorActionPreference='Stop'; $games=@(Get-Process | Where-Object {$_.ProcessName -eq 'NRC-Win64-Shipping'}); $memory=Get-CimInstance Win32_OperatingSystem; @{game=($games.Count -gt 0);freeMiB=[math]::Floor($memory.FreePhysicalMemory/1024)} | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true, timeout: 10_000 }).trim())
const before = inspect()
if (before.game || before.freeMiB < 1536) {
  console.error('Task not started: game running or insufficient available memory')
  process.exit(75)
}
console.log(`Resource guard active; free memory ${before.freeMiB} MiB`)
const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, shell: false })
const readRootIdentity = () => {
  if (!Number.isInteger(child.pid)) return null
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter "ProcessId=${child.pid}"; if($p){@{ticks=[string]$p.CreationDate.ToUniversalTime().Ticks;command=$p.CommandLine} | ConvertTo-Json -Compress}else{'null'}`],
    { encoding: 'utf8', windowsHide: true, timeout: 10_000 }).trim()
  return JSON.parse(output)
}
let rootIdentity = null
try { rootIdentity = readRootIdentity() } catch { child.kill() }
let finished = false
let stopped = false
const stopOwned = () => {
  if (finished || stopped) return
  stopped = true
  // Recheck creation time and exact command so PID reuse cannot target a user
  // application that happened to inherit an already-completed child's PID.
  try {
    const current = readRootIdentity()
    if (rootIdentity && current?.ticks === rootIdentity.ticks && current.command === rootIdentity.command) {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10_000 })
    } else child.kill() // libuv retains the original process handle.
  }
  catch { child.kill() }
  console.error('Stopped this task only: game/resource guard. No automatic retry.')
}
const timer = setInterval(() => {
  if (finished) return
  try { const state = inspect(); if (state.game || state.freeMiB < 1536) stopOwned() }
  catch { stopOwned() }
}, 3_000)
child.on('error', () => { finished = true; clearInterval(timer); process.exitCode = 1 })
child.on('exit', code => { finished = true; clearInterval(timer); process.exitCode = stopped ? 75 : code ?? 1 })
process.on('SIGINT', stopOwned)
process.on('SIGTERM', stopOwned)
