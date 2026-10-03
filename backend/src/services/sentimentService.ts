import { query } from '../config/database';
import logger from '../utils/logger';

// 中文情感词库（简化版）
const SENTIMENT_WORDS = {
  positive: [
    'surge', 'rally', 'boom', 'jump', 'rise', 'gain', 'profit', 'upside',
    'strong', 'bullish', 'recovery', 'growth', 'positive', 'optimistic',
    'breakthrough', 'record', 'excellent', 'outperform'
  ],
  negative: [
    'crash', 'plunge', 'collapse', 'fall', 'drop', 'loss', 'downside',
    'weak', 'bearish', 'recession', 'decline', 'negative', 'pessimistic',
    'bankruptcy', 'default', 'crisis', 'underperform', 'slump'
  ]
};

const SENTIMENT_MODIFIERS = {
  intensifier: ['extremely', 'significantly', 'sharply', 'drastically', 'severe'],
  diminisher: ['slightly', 'marginally', 'somewhat', 'modest', 'modest']
};

// 计算情感得分
export function calculateSentimentScore(text: string): { score: number; label: string; confidence: number } {
  const cleanText = text.toLowerCase();
  let positiveScore = 0;
  let negativeScore = 0;

  // 统计正面词汇
  for (const word of SENTIMENT_WORDS.positive) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = (cleanText.match(regex) || []).length;
    if (matches > 0) {
      positiveScore += matches;
    }
  }

  // 统计负面词汇
  for (const word of SENTIMENT_WORDS.negative) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = (cleanText.match(regex) || []).length;
    if (matches > 0) {
      negativeScore += matches;
    }
  }

  // 计算修饰符影响
  let modifier = 1;
  for (const word of SENTIMENT_MODIFIERS.intensifier) {
    if (cleanText.includes(word)) {
      modifier *= 1.3;
    }
  }
  for (const word of SENTIMENT_MODIFIERS.diminisher) {
    if (cleanText.includes(word)) {
      modifier *= 0.7;
    }
  }

  // 规范化情感得分到 -1 ~ 1
  const totalScore = (positiveScore - negativeScore) * modifier;
  const totalWords = positiveScore + negativeScore;

  let finalScore = 0;
  if (totalWords > 0) {
    finalScore = Math.max(-1, Math.min(1, totalScore / Math.max(totalWords, 5)));
  }

  // 确定情感标签和置信度
  const absScore = Math.abs(finalScore);
  let label = 'neutral';
  let confidence = 0;

  if (absScore > 0.3) {
    label = finalScore > 0 ? 'positive' : 'negative';
    confidence = Math.min(0.95, 0.3 + absScore * 0.7);
  } else {
    confidence = 0.5 - absScore * 0.5;
  }

  return {
    score: parseFloat(finalScore.toFixed(3)),
    label,
    confidence: parseFloat(confidence.toFixed(3))
  };
}

// 提取关键金融术语
export function extractKeyTerms(text: string): string[] {
  const financialTerms = [
    'bull', 'bear', 'volatility', 'liquidity', 'inflation', 'deflation',
    'interest rate', 'yield', 'spread', 'correlation', 'hedge', 'portfolio',
    'diversification', 'momentum', 'trend', 'support', 'resistance',
    'dividend', 'earnings', 'guidance', 'upgrade', 'downgrade'
  ];

  const foundTerms: string[] = [];
  const lowerText = text.toLowerCase();

  for (const term of financialTerms) {
    if (lowerText.includes(term)) {
      foundTerms.push(term);
    }
  }

  return foundTerms;
}

// 分析新闻情感
export async function analyzeSentiment(newsId: number, title: string, content: string = '') {
  try {
    const fullText = `${title} ${content}`;

    // 计算情感得分
    const { score, label, confidence } = calculateSentimentScore(fullText);

    // 提取关键词
    const keyTerms = extractKeyTerms(fullText);

    // 存储情感分析结果
    await query(
      `INSERT INTO sentiment_analysis 
       (news_id, sentiment_score, sentiment_label, confidence, key_terms)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (news_id) DO UPDATE SET
       sentiment_score = $2,
       sentiment_label = $3,
       confidence = $4,
       key_terms = $5`,
      [
        newsId,
        score,
        label,
        confidence,
        JSON.stringify(keyTerms)
      ]
    );

    logger.debug(`Sentiment analysis for news ${newsId}: ${label} (${score})`);
    return { score, label, confidence, keyTerms };

  } catch (error) {
    logger.error('Error analyzing sentiment:', error);
    return null;
  }
}

// 获取资产的情感统计
export async function getAssetSentimentStats(symbol: string, hours: number = 24) {
  try {
    const result = await query(
      `SELECT 
         sa.sentiment_label,
         COUNT(*) as count,
         AVG(sa.sentiment_score) as avg_score,
         MAX(sa.confidence) as max_confidence
       FROM sentiment_analysis sa
       JOIN news_asset_correlation nac ON sa.news_id = nac.news_id
       JOIN assets a ON nac.asset_id = a.id
       WHERE a.symbol = $1
         AND sa.created_at > NOW() - INTERVAL '${hours} hours'
       GROUP BY sa.sentiment_label`,
      [symbol]
    );

    return result.rows;
  } catch (error) {
    logger.error('Error getting sentiment stats:', error);
    return [];
  }
}

// 获取高情感新闻
export async function getHighSentimentNews(threshold: number = 0.6, limit: number = 20) {
  try {
    const result = await query(
      `SELECT 
         n.id,
         n.title,
         n.url,
         n.published_at,
         sa.sentiment_score,
         sa.sentiment_label,
         sa.key_terms,
         COUNT(DISTINCT nac.asset_id) as asset_count
       FROM news n
       JOIN sentiment_analysis sa ON n.id = sa.news_id
       LEFT JOIN news_asset_correlation nac ON n.id = nac.news_id
       WHERE ABS(sa.sentiment_score) > $1
       GROUP BY n.id, n.title, n.url, n.published_at, sa.sentiment_score, sa.sentiment_label, sa.key_terms
       ORDER BY n.published_at DESC
       LIMIT $2`,
      [threshold, limit]
    );

    return result.rows;
  } catch (error) {
    logger.error('Error getting high sentiment news:', error);
    return [];
  }
}

export default {
  analyzeSentiment,
  calculateSentimentScore,
  extractKeyTerms,
  getAssetSentimentStats,
  getHighSentimentNews
};
