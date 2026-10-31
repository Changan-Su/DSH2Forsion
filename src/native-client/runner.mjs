// Public JSON v1 adapter. References are external handles, never DSH sessions.
export const REF_PREFIX = 'forsion-task:'
export function executionRef(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid execution id')
  return REF_PREFIX + id
}
export function referencePayload(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(REF_PREFIX)) throw new Error('This is not a native task execution reference')
  const executionId = ref.slice(REF_PREFIX.length)
  executionRef(executionId)
  return { executionId }
}
export class NativeTaskBoardRunner {
  constructor(invoke, { promptText }) { this.invoke = invoke; this.promptText = promptText }
  async launch(task, options = {}) {
    const ref = executionRef(options.executionId)
    const context = await this.invoke('context', {})
    const target = task.handover?.workspaceId ?? task.workspaceId
    const workspace = target ? context.workspaces?.find(w => w.id === target || w.dshWorkspaceId === target) : context.workspace ?? context.workspaces?.find(w => w.path === context.cwd)
    if (target && !workspace) throw new Error('Native workspace is not registered')
    const cwd = workspace?.path ?? context.cwd
    if (!cwd) throw new Error('Open a Forsion project before running this task')
    const mode = task.handover?.mode ?? task.mode
    if (mode && mode !== 'tangu') throw new Error('This DSH Agent preset is not a native Tangu execution mode')
    if (options.goalEnabled) throw new Error('DSH native /goal is not a Tangu execution capability')
    // Attach before dispatch. A lost response can then be recovered by executionId.
    options.onSession?.(ref)
    options.onGoalArmed?.(false)
    const result = await this.invoke('launch', {
      taskId: task.id, executionId: options.executionId,
      prompt: this.promptText(task, options.promptContext), title: task.title, cwd,
      ...(target ? { workspaceId: workspace.id } : {}),
      ...(task.model ? { modelId: task.model } : {}),
      mode: 'tangu',
      ...((task.handover?.permission ?? task.permission) ? { permission: task.handover?.permission ?? task.permission } : {}),
      ...(task.reasoningEffort ? { reasoningEffort: task.reasoningEffort } : {}),
      ...(options.reuseSessionId ? { resumeExecutionId: referencePayload(options.reuseSessionId).executionId } : {}),
    })
    if (!result?.sessionId || !result.runId) throw new Error('Native launch returned no owned Tangu run')
    return ref
  }
  async listRunning() {
    const result = await this.invoke('list', {})
    if (result?.known !== true || !Array.isArray(result.items)) return { known: false }
    const items = result.items.map(item => ({ sessionId: executionRef(item.executionId), running: ['queued', 'running', 'waiting'].includes(item.state), title: item.title ?? '', updatedAt: item.updatedAt ?? 0 }))
    return { known: true, items, count: items.filter(item => item.running).length }
  }
  async inspect(ref) {
    const result = await this.invoke('status', referencePayload(ref))
    if (result.state === 'succeeded') return { outcome: 'succeeded' }
    if (result.state === 'failed') return { outcome: 'failed', error: result.error || 'Tangu execution failed' }
    if (result.state === 'cancelled') return { outcome: 'cancelled', error: result.error || 'Cancelled in Tangu' }
    if (['queued', 'running', 'waiting'].includes(result.state)) return { outcome: 'pending' }
    return { outcome: 'pending', unreadable: true, reason: result.error || 'Native execution state is unknown' }
  }
  async modelCatalog() {
    const context = await this.invoke('context', {})
    return { groups: [{ id: 'tangu', models: (context.models || []).map(m => ({ ...m, reasoning: undefined })) }] }
  }
}
