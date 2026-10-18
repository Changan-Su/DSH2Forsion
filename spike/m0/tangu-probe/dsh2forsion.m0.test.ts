/**
 * DSH2Forsion M0 · 工具桥：用 tangu-agent 真加载器装 spike/m0/tangu-probe/plugin，
 * 证明 sidecar 里第三方 DSH 插件注册的工具 ① 进得了 Tangu 本机 host 档的模型工具表；
 * ② 声明成「每次都问」（完全放行档也问）；③ 经桥执行能拿回 DSH 的渲染文本、参数错误原样回传；
 * ④ 插件停用后工具消失（负对照）。
 *
 * 不是 Genesis 的测试，跑法见 spike/m0/README.md：拷进 tangu-agent/src/plugins/ 后
 *   DSH2FORSION_BRIDGE=http://127.0.0.1:<port> DSH2FORSION_SECRET=<密钥> \
 *   DSH2FORSION_PLUGIN=<本仓>/spike/m0/tangu-probe/plugin npx vitest run src/plugins/dsh2forsion.m0.test.ts
 * 需要一个已装好 dsh-bridge 与 fixture-tool 的 sidecar 在跑。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN = process.env.DSH2FORSION_PLUGIN ?? '';
const ready = Boolean(PLUGIN && process.env.DSH2FORSION_BRIDGE && process.env.DSH2FORSION_SECRET);
vi.setConfig({ testTimeout: 60_000 });

let tmp: string;

describe.skipIf(!ready)('DSH2Forsion M0 tool bridge', () => {
  beforeAll(() => {
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'dsh2forsion-m0-')));
    mkdirSync(path.join(tmp, 'home'), { recursive: true });
    process.env.TANGU_HOME = path.join(tmp, 'home');
    process.env.TANGU_PLUGINS_DIR = path.join(tmp, 'plugins');
    cpSync(PLUGIN, path.join(tmp, 'plugins', 'dsh2forsion'), { recursive: true });
  });
  afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('bridges a third-party DSH tool into Tangu end to end', async () => {
    const boot = await import('./bootstrap.js');
    const tools = await import('../tools/toolRegistry.js');
    const { toolNeedsApproval } = await import('../services/approvals.js');
    await boot.activateAllPlugins();

    // ① 本机 host 档的模型工具表里能看到
    const { configureTangu } = await import('../seams/runtime.js');
    const { createTanguProfile } = await import('../profiles/index.js');
    const profile = createTanguProfile({ sandboxMode: 'none' });
    const stub: any = new Proxy({}, { get: () => () => { throw new Error('stub'); } });
    configureTangu({ host: stub, brain: stub, billing: stub, profile });
    const ctx: any = { userId: 'u1', sessionId: 's1', appId: profile.appId, profile, execMode: 'host', cwd: tmp };
    const visible = [...tools.resolveTools(profile, ctx).keys()].filter((n) => n.startsWith('dsh__'));
    expect(visible).toContain('dsh__fixture_echo');
    expect(visible).not.toContain('dsh__working_directory');

    // ② 每次都问：完全放行档、空档也问
    expect(toolNeedsApproval('dsh__fixture_echo', 'full-auto')).toBe(true);
    expect(toolNeedsApproval('dsh__fixture_echo', undefined)).toBe(true);

    // ③ 执行：拿回 DSH output.render 的文本；参数错误原样回成 Error:
    const tool = tools.listToolProviders().flatMap((p) => p.tools()).find((t) => t.name === 'dsh__fixture_echo')!;
    expect(tool.definition.function.parameters).toMatchObject({ required: ['text'] });
    const ok = await tool.execute({ text: 'pong' }, {} as any);
    expect(ok).toMatch(/^echo: pong \(cwd /);
    const bad = await tool.execute({}, {} as any);
    expect(bad).toMatch(/^Error: invalid arguments: missing required property "text"/);

    // ④ 负对照：停用后工具消失
    await boot.setPluginEnabledLive('dsh2forsion', false);
    const after = [...tools.resolveTools(profile, ctx).keys()].filter((n) => n.startsWith('dsh__'));
    expect(after).toEqual([]);
    console.log(JSON.stringify({ visible, ok, bad: bad.slice(0, 80) }));
  });
});
