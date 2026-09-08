import type { AppContext } from '../../context.js'
import { installRouter } from '../router.js'
import { registerVaultHandlers } from './vault.js'
import { registerRecordHandlers } from './records.js'
import { registerDashboardHandlers } from './dashboards.js'
import { registerExtraHandlers } from './extras.js'

/**
 * Register every message handler, once, at startup.
 *
 * Registration is deliberately eager and duplicate-checked: a channel declared
 * in the contract but never registered fails loudly the first time the
 * interface calls it, rather than becoming a dead button.
 */
export function registerAllHandlers(ctx: AppContext): void {
  registerVaultHandlers(ctx)
  registerRecordHandlers(ctx)
  registerDashboardHandlers(ctx)
  registerExtraHandlers(ctx)
  installRouter()
}
