import {
  LogLevel,
  Univer,
  type IUniverConfig,
  type Plugin,
  type PluginCtor
} from '@univerjs/core'
import { FUniver } from '@univerjs/core/lib/facade'

type PluginRegistration = PluginCtor<Plugin> | [
  PluginCtor<Plugin>,
  ConstructorParameters<PluginCtor<Plugin>>[0]
]

interface UniverPreset {
  plugins: PluginRegistration[]
}

export function createLocalUniver(
  options: Partial<IUniverConfig> & { presets: UniverPreset[] }
): { univer: Univer; univerAPI: FUniver } {
  const { presets, ...config } = options
  const univer = new Univer({ logLevel: LogLevel.WARN, ...config })
  const registrations = new Map<string, {
    plugin: PluginCtor<Plugin>
    options?: ConstructorParameters<PluginCtor<Plugin>>[0]
  }>()

  for (const preset of presets) {
    for (const registration of preset.plugins) {
      const [plugin, pluginOptions] = Array.isArray(registration)
        ? registration
        : [registration, undefined]
      registrations.delete(plugin.pluginName)
      registrations.set(plugin.pluginName, { plugin, options: pluginOptions })
    }
  }
  for (const { plugin, options: pluginOptions } of registrations.values()) {
    univer.registerPlugin(plugin, pluginOptions)
  }
  return { univer, univerAPI: FUniver.newAPI(univer) }
}
