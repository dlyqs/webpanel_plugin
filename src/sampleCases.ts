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
];

export function getDefaultSampleCase(): SampleCase {
  return SAMPLE_CASES[0];
}
