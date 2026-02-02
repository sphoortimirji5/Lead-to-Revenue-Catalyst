import {
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

export const LEADS_PROCESSED_TOTAL = 'leads_processed_total';
export const AI_ANALYSIS_DURATION = 'ai_analysis_duration_seconds';

export const metricsProviders = [
  makeCounterProvider({
    name: LEADS_PROCESSED_TOTAL,
    help: 'Total number of leads processed',
    labelNames: ['status'],
  }),
  makeHistogramProvider({
    name: AI_ANALYSIS_DURATION,
    help: 'Duration of AI analysis in seconds',
    buckets: [0.1, 0.5, 1, 2, 5, 10],
  }),
];
