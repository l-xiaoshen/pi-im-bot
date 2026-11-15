import { z } from 'zod'

export const PluginUrlSchema = z
  .url()
  .max(4096)
  .refine((value) => {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  }, '发布来源须为 HTTP(S) 地址')

export const PluginInstallUrlSchema = z
  .string()
  .trim()
  .max(4096)
  .transform((input) => {
    const ssh = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/?#]+)\/?$/iu.exec(input)
    if (ssh) {
      return 'https://github.com/' + ssh[1] + '/' + ssh[2]
    }
    if (/^(?:www\.)?github\.com\//iu.test(input)) {
      return 'https://' + input
    }
    if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/u.test(input)) {
      return 'https://github.com/' + input
    }
    return input
  })
  .pipe(PluginUrlSchema)
