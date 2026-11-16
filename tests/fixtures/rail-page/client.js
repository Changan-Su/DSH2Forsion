// 测试用的第三方 DSH 插件：经 DSH 右侧栏的公开接口登记一页（同社区插件的做法），页面里一行可辨认的字。
window.__ModuleLoader__.load({ id: 'dsh2forsion-fixture-rail-page', factory(require) {
  const React = require('react')
  const ID = 'dsh2forsion-fixture-rail-page/page'
  function Body() {
    return React.createElement('div', { 'data-d2f-fixture-page': '', style: { padding: 16, fontSize: 14 } }, 'D2F-FIXTURE-PAGE: a plugin page in the right sidebar')
  }
  return {
    inject: ['slots', 'sidebarRightTabs'],
    apply(ctx) {
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: ID, kind: 'd2f-fixture', title: () => 'Fixture page',
        guide: [{ id: 'fixture', order: 90, title: () => 'Fixture page', description: () => 'A test plugin page' }],
      }), 'fixture: page type')
      ctx.effect(() => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID }, Body), 'fixture: page body')
    },
  }
} })
