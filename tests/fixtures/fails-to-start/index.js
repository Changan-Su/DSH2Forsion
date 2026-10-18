// 激活时抛错：DSH 照样起来，但会报这一条没激活（M0 里「黄」档的样子）
export const name = 'dsh2forsion-fixture-fails-to-start'
export function apply() {
  throw new Error('fixture refuses to start')
}
