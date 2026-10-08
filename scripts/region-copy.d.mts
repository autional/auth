export interface RegionCopy {
  locale: string;
  title: string;
  description: string;
  robotsComment: string[];
}

export const REGION_COPY: Record<'zh' | 'en', RegionCopy>;
