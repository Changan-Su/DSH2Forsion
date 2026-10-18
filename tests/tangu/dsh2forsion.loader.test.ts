/**
 * DSH2Forsion v0.1 · 真加载器：把构建好的整包 plugin/ 当 Forsion 插件捆绑包放进共享域 plugins/，
 * 让 tangu-agent 自己发现、激活内嵌的引擎半身，再经真的 /extensions/<目录名>/<引擎 id>/ 路由走用户路径：
 * sidecar 自己起来 → 装 fixture 插件（试启动）→ 工具进本机 host 档工具表、每次都问 → 带会话工作目录执行 →
 * 提示词分节进来 → 停用后工具消失。
 *
 * 不是 Genesis 的测试，跑法见 tests/tangu/README.md：拷进 tangu-agent/src/plugins/ 后
 *   DSH2FORSION_BUNDLE=<本仓>/plugin DSH2FORSION_ROOT=<已装好运行时的根目录> \
 *   DSH2FORSION_FIXTURE=<本仓>/tests/fixtures/fixture-tool npx vitest run src/plugins/dsh2forsion.loader.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const BUNDLE = process.env.DSH2FORSION_BUNDLE ?? '';
const ROOT = process.env.DSH2FORSION_ROOT ?? '';
const FIXTURE = process.env.DSH2FORSION_FIXTURE ?? '';
const ready = Boolean(BUNDLE && ROOT && FIXTURE);
vi.setConfig({ testTimeout: 240_000, hookTimeout: 60_000 });

let tmp: string;

describe.skipIf(!ready)('DSH2Forsion v0.1 through the real Tangu plugin loader', () => {
  beforeAll(() => {
    delete process.env.TANGU_PLUGINS_DIR; // 设了它捆绑包整体停用
    delete process.env.TANGU_BUNDLE_DIRS;
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'dsh2forsion-loader-')));
    process.env.TANGU_HOME = path.join(tmp, 'tangu');
    mkdirSync(process.env.TANGU_HOME, { recursive: true });
    // 目录名故意和包 id 不同：路由前缀必须跟目录名走（商店按 install_slug 落目录）
    cpSync(BUNDLE, path.join(tmp, 'plugins', 'dsh2forsion-store'), { recursive: true });
    // 省掉 1.1 GB 下载：数据目录里软链已装好的 Node 与 DSH 运行时，其余（home、快照）全新
    const data = path.join(process.env.TANGU_HOME, 'plugin-data', 'dsh2forsion');
    mkdirSync(data, { recursive: true });
    for (const sub of ['node', 'runtime']) symlinkSync(path.join(ROOT, sub), path.join(data, sub), 'dir');
  });
  afterAll(async () => {
    const boot = await import('./bootstrap.js');
    await boot.setPluginEnabledLive('dsh2forsion', false).catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
  });

  it('activates from the bundle, serves its routes, and bridges a DSH tool into Tangu', async () => {
    const boot = await import('./bootstrap.js');
    const tools = await import('../tools/toolRegistry.js');
    const { toolNeedsApproval } = await import('../services/approvals.js');
    const { configureTangu } = await import('../seams/runtime.js');
    const { createTanguProfile } = await import('../profiles/index.js');
    const profile = createTanguProfile({ sandboxMode: 'none' });
    const stub: any = new Proxy({}, { get: () => () => { throw new Error('stub'); } });
    const hostStub: any = new Proxy(
      { authMiddleware: (req: any, _res: any, next: () => void) => { req.user = { userId: 'u1' }; next(); } },
      { get: (t: any, k) => t[k] ?? (() => { throw new Error('stub'); }) },
    );
    configureTangu({ host: hostStub, brain: stub, billing: stub, profile });

    const t0 = Date.now();
    const mount = await boot.activateAllPlugins();
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(boot.pluginStatus('dsh2forsion')).toMatchObject({ active: true });

    const express = (await import('express')).default;
    const routers = { userRouter: express.Router(), dataRouter: express.Router(), adminRouter: express.Router() };
    mount(routers);
    const app = express();
    app.use(express.json());
    app.use('/', routers.userRouter);
    const server: Server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/extensions/dsh2forsion-store/dsh2forsion`;
    const api = async (p: string, body?: unknown) => {
      const res = await fetch(base + p, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json: any = await res.json();
      if (!res.ok) throw new Error(`${p} → ${res.status} ${JSON.stringify(json)}`);
      return json;
    };
    try {
      // 装好了且开着自动启动：激活后在后台起 sidecar
      let status: any;
      for (let i = 0; i < 240; i++) {
        status = await api('/status');
        if (status.sidecar.state === 'running' || status.sidecar.state === 'failed') break;
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(status.sidecar.state).toBe('running');
      expect(status.runtime.installed).toBe(true);

      const installed = await api('/plugins/install', { spec: `file:${FIXTURE}` });
      expect(installed).toMatchObject({ status: 'installed', verdict: 'ok' });

      // 本机 host 档工具表；DSH 自带的 working_directory 不进来
      const ctx: any = { userId: 'u1', sessionId: 's1', appId: profile.appId, profile, execMode: 'host', cwd: tmp };
      const visible = [...tools.resolveTools(profile, ctx).keys()].filter((n) => n.startsWith('dsh__'));
      expect(visible).toEqual(['dsh__fixture_echo']);
      expect(toolNeedsApproval('dsh__fixture_echo', 'full-auto')).toBe(true);
      expect(toolNeedsApproval('dsh__fixture_echo', undefined)).toBe(true);

      const proj = path.join(tmp, 'project-b');
      mkdirSync(proj);
      const tool = tools.listToolProviders().flatMap((p) => p.tools()).find((t) => t.name === 'dsh__fixture_echo')!;
      expect(await tool.execute({ text: 'pong' }, { sessionId: 's1', cwd: proj, signal: new AbortController().signal } as any)).toBe(`echo: pong (cwd ${proj})`);

      const { getPluginMeta } = await import('./registry.js');
      const section = await getPluginMeta('dsh2forsion')?.promptSection?.({} as any);
      expect(String(section)).toMatch(/fixture ping/);

      // 负对照：停用后工具和路由一起没了，sidecar 也停了
      const pid = (await api('/status')).sidecar.pid;
      await boot.setPluginEnabledLive('dsh2forsion', false);
      expect([...tools.resolveTools(profile, ctx).keys()].filter((n) => n.startsWith('dsh__'))).toEqual([]);
      expect((await fetch(base + '/status')).status).toBe(404);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
