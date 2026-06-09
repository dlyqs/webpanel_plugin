export interface SampleCase {
  id: string;
  label: string;
  description: string;
  data: unknown;
}

export const SAMPLE_CASES: SampleCase[] = [
  {
    id: 'generic-card',
    label: 'Generic Card',
    description: 'A normal content tile with title, URL, and extracted text.',
    data: {
      url: 'https://example.com/research/local-plugin-preview',
      title: 'Local Plugin Preview',
      siteName: 'Example',
      text:
        'This sample represents a compact tile payload. Use it to test typography, spacing, and state rendering without depending on a live page.',
      metrics: {
        updatedAt: '2026-06-09T10:00:00.000Z',
        confidence: 0.92,
      },
    },
  },
  {
    id: 'market',
    label: 'Market Widget',
    description: 'A market-like payload with prices, probabilities, and status.',
    data: {
      url: 'https://example.com/markets/product-launch',
      title: 'Product Launch Before Q4',
      status: 'active',
      probability: 64,
      liquidity: '$42.8K',
      outcomes: [
        { label: 'Yes', price: 0.64, volume: '$28.1K' },
        { label: 'No', price: 0.36, volume: '$14.7K' },
      ],
    },
  },
  {
    id: 'timeline',
    label: 'Timeline',
    description: 'A social timeline payload with compact repeated items.',
    data: {
      url: 'https://example.com/timeline',
      title: 'Timeline Preview',
      tab: 'home',
      items: [
        {
          id: 'post-1',
          author: 'WebPanel',
          handle: '@webpanel',
          text: 'Local WPP development should feel close to the real tile surface.',
          timestamp: '09:10',
        },
        {
          id: 'post-2',
          author: 'Plugin Dev',
          handle: '@plugins',
          text: 'Renderer modules can log to the host console and update status text.',
          timestamp: '09:18',
        },
      ],
    },
  },
  {
    id: 'weibo-hot-rank',
    label: 'Weibo Hot Rank',
    description: 'A ranked hot-search payload shaped like the Weibo plugin main output.',
    data: {
      url: 'https://s.weibo.com/top/summary?cate=realtimehot',
      title: '微博热搜榜',
      updatedAt: '2026-06-09T14:30:00+08:00',
      items: [
        {
          rank: 1,
          title: '高考志愿填报',
          hot: 2489134,
          label: '热',
          url: 'https://s.weibo.com/weibo?q=%23%E9%AB%98%E8%80%83%E5%BF%97%E6%84%BF%E5%A1%AB%E6%8A%A5%23',
        },
        {
          rank: 2,
          title: '端午假期消费观察',
          hot: 1862055,
          label: '新',
          url: 'https://s.weibo.com/weibo?q=%23%E7%AB%AF%E5%8D%88%E5%81%87%E6%9C%9F%E6%B6%88%E8%B4%B9%E8%A7%82%E5%AF%9F%23',
        },
        {
          rank: 3,
          title: '毕业季租房攻略',
          hot: 1268098,
          label: '沸',
          url: 'https://s.weibo.com/weibo?q=%23%E6%AF%95%E4%B8%9A%E5%AD%A3%E7%A7%9F%E6%88%BF%E6%94%BB%E7%95%A5%23',
        },
      ],
    },
  },
];

export function getDefaultSampleCase(): SampleCase {
  return SAMPLE_CASES[0];
}
