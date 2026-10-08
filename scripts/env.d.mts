export type Region = 'cn' | 'com';
export type Lang = 'zh' | 'en';

export interface BuildEnv {
  region: Region;
  siteUrl: string;
  defaultLang: Lang;
  fallbackLang: Lang;
  cdnHost: string;
  siteHost: string;
  rootDomain: string;
}

export const CDN_PIN: string;
export function readBuildEnv(env?: Record<string, string | undefined>): BuildEnv;
