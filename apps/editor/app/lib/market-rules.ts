export const STOCK_MARKETS = ['A股', '美股', '韩股', '日股', '欧洲股市'] as const;

export type StockMarket = (typeof STOCK_MARKETS)[number];

interface TickerRule {
  pattern: RegExp;
  example: string;
  message: string;
}

const MARKET_ALIASES: Record<string, StockMarket> = {
  '欧洲': '欧洲股市',
  '欧股': '欧洲股市',
  '美股/台股': '美股',
};

const TICKER_RULES: Record<StockMarket, TickerRule> = {
  'A股': {
    pattern: /^\d{6}$/,
    example: '600519',
    message: 'A股代码必须是 6 位数字',
  },
  '美股': {
    pattern: /^[A-Z][A-Z.-]{0,9}$/,
    example: 'NVDA',
    message: '美股 symbol 必须使用大写字母，可包含 . 或 -，长度 1-10 位',
  },
  '韩股': {
    pattern: /^\d{6}$/,
    example: '005930',
    message: '韩股代码必须是 6 位数字',
  },
  '日股': {
    pattern: /^\d{4}$/,
    example: '7203',
    message: '日股代码必须是 4 位数字',
  },
  '欧洲股市': {
    pattern: /^[A-Z0-9][A-Z0-9.-]{0,11}$/,
    example: 'ASML',
    message: '欧洲股市代码必须使用大写字母或数字，可包含 . 或 -，长度 1-12 位',
  },
};

/**
 * 标准化市场名称。
 * @param market 原始市场名称。
 * @returns 标准市场名称，无法识别时返回空字符串。
 */
export function normalizeStockMarket(market?: string): StockMarket | '' {
  const cleanMarket = (market || '').trim();
  if (!cleanMarket) {
    return '';
  }
  if ((STOCK_MARKETS as readonly string[]).includes(cleanMarket)) {
    return cleanMarket as StockMarket;
  }
  return MARKET_ALIASES[cleanMarket] || '';
}

/**
 * 按市场标准化证券代码。
 * @param market 市场名称。
 * @param ticker 原始证券代码。
 * @returns 标准化后的证券代码。
 */
export function normalizeTickerForMarket(market: string | undefined, ticker?: string): string {
  const cleanTicker = (ticker || '').trim();
  const cleanMarket = normalizeStockMarket(market);
  if (cleanMarket === '美股' || cleanMarket === '欧洲股市') {
    return cleanTicker.toUpperCase();
  }
  return cleanTicker;
}

/**
 * 获取证券代码输入占位示例。
 * @param market 市场名称。
 * @returns 代码示例。
 */
export function getTickerPlaceholder(market?: string): string {
  const cleanMarket = normalizeStockMarket(market);
  return cleanMarket ? TICKER_RULES[cleanMarket].example : '先选择市场';
}

/**
 * 校验证券代码。
 * @param market 市场名称。
 * @param ticker 证券代码。
 * @returns 校验结果和错误信息。
 */
export function validateStockTicker(market: string | undefined, ticker?: string): {
  isValid: boolean;
  market: StockMarket | '';
  ticker: string;
  message: string;
} {
  const cleanMarket = normalizeStockMarket(market);
  const cleanTicker = normalizeTickerForMarket(cleanMarket, ticker);
  if (!cleanMarket) {
    return {
      isValid: false,
      market: '',
      ticker: cleanTicker,
      message: '市场必须从固定选项中选择',
    };
  }

  const rule = TICKER_RULES[cleanMarket];
  if (!rule.pattern.test(cleanTicker)) {
    return {
      isValid: false,
      market: cleanMarket,
      ticker: cleanTicker,
      message: rule.message,
    };
  }

  return {
    isValid: true,
    market: cleanMarket,
    ticker: cleanTicker,
    message: '',
  };
}
