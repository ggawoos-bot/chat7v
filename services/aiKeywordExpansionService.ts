/**
 * AI 기반 동적 키워드 확장 서비스
 * 실시간 키워드 학습 및 동적 동의어 생성
 */

import { GoogleGenAI } from '@google/genai';

export interface KeywordExpansionResult {
  originalKeyword: string;
  expandedKeywords: string[];
  semanticVariants: string[];
  domainSpecific: string[];
  confidence: number;
  source: 'ai' | 'learning' | 'hybrid';
}

export interface LearningData {
  keyword: string;
  successfulVariants: string[];
  failedVariants: string[];
  userSatisfaction: number;
  timestamp: Date;
  context: string;
}

export class AIKeywordExpansionService {
  private static instance: AIKeywordExpansionService;
  private learningDatabase: Map<string, LearningData[]> = new Map();
  private aiService: GoogleGenAI | null = null;
  private readonly MAX_LEARNING_HISTORY = 1000;
  private readonly MIN_CONFIDENCE_THRESHOLD = 0.7;

  private constructor() {
    this.initializeAI();
  }

  public static getInstance(): AIKeywordExpansionService {
    if (!AIKeywordExpansionService.instance) {
      AIKeywordExpansionService.instance = new AIKeywordExpansionService();
    }
    return AIKeywordExpansionService.instance;
  }

  private initializeAI(): void {
    try {
      const apiKey = this.getApiKey();
      if (apiKey) {
        this.aiService = new GoogleGenAI({ apiKey });
        console.log('✅ AI 키워드 확장 서비스 초기화 완료');
      }
    } catch (error) {
      console.warn('⚠️ AI 키워드 확장 서비스 초기화 실패:', error);
    }
  }

  private getApiKey(): string | null {
    // 환경변수에서 API 키 가져오기
    const apiKeys = [
      import.meta.env.VITE_GEMINI_API_KEY,
      import.meta.env.VITE_GEMINI_API_KEY_1,
      import.meta.env.VITE_GEMINI_API_KEY_2
    ].filter(key => key && key.trim() !== '');

    return apiKeys.length > 0 ? apiKeys[0] : null;
  }

  /**
   * AI 기반 키워드 확장
   */
  async expandKeywordWithAI(keyword: string, context?: string): Promise<KeywordExpansionResult> {
    if (!this.aiService) {
      return this.getFallbackExpansion(keyword);
    }

    try {
      const prompt = this.createExpansionPrompt(keyword, context);
      const chat = this.aiService.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: '당신은 한국어 키워드 확장 전문가입니다. 주어진 키워드에 대해 관련된 동의어, 유의어, 전문용어를 생성해주세요.'
        },
        history: []
      });

      const result = await chat.sendMessage({ message: prompt });
      const response = result.text;

      return this.parseAIResponse(keyword, response);
    } catch (error) {
      console.warn('AI 키워드 확장 실패:', error);
      return this.getFallbackExpansion(keyword);
    }
  }

  /**
   * 학습 기반 키워드 확장
   */
  expandKeywordWithLearning(keyword: string): KeywordExpansionResult {
    const learningData = this.learningDatabase.get(keyword);
    
    if (!learningData || learningData.length === 0) {
      return this.getFallbackExpansion(keyword);
    }

    // 성공한 변형들을 기반으로 확장
    const successfulVariants = new Set<string>();
    const domainSpecific = new Set<string>();
    
    learningData.forEach(data => {
      if (data.userSatisfaction >= 0.7) {
        data.successfulVariants.forEach(variant => successfulVariants.add(variant));
      }
    });

    return {
      originalKeyword: keyword,
      expandedKeywords: Array.from(successfulVariants),
      semanticVariants: Array.from(successfulVariants),
      domainSpecific: Array.from(domainSpecific),
      confidence: this.calculateConfidence(learningData),
      source: 'learning'
    };
  }

  /**
   * 하이브리드 키워드 확장 (AI + 학습)
   */
  async expandKeywordHybrid(keyword: string, context?: string): Promise<KeywordExpansionResult> {
    const aiResult = await this.expandKeywordWithAI(keyword, context);
    const learningResult = this.expandKeywordWithLearning(keyword);

    // AI 결과와 학습 결과 통합
    const allKeywords = new Set([
      ...aiResult.expandedKeywords,
      ...learningResult.expandedKeywords
    ]);

    return {
      originalKeyword: keyword,
      expandedKeywords: Array.from(allKeywords),
      semanticVariants: Array.from(allKeywords),
      domainSpecific: Array.from(allKeywords),
      confidence: Math.max(aiResult.confidence, learningResult.confidence),
      source: 'hybrid'
    };
  }

  /**
   * 사용자 피드백 학습
   */
  learnFromFeedback(
    keyword: string,
    searchResults: string[],
    userSatisfaction: number,
    context: string
  ): void {
    const learningData: LearningData = {
      keyword,
      successfulVariants: userSatisfaction >= 0.7 ? searchResults : [],
      failedVariants: userSatisfaction < 0.7 ? searchResults : [],
      userSatisfaction,
      timestamp: new Date(),
      context
    };

    if (!this.learningDatabase.has(keyword)) {
      this.learningDatabase.set(keyword, []);
    }

    const history = this.learningDatabase.get(keyword)!;
    history.push(learningData);

    // 최대 학습 히스토리 제한
    if (history.length > this.MAX_LEARNING_HISTORY) {
      history.splice(0, history.length - this.MAX_LEARNING_HISTORY);
    }

    console.log(`📚 키워드 학습 완료: ${keyword} (만족도: ${userSatisfaction})`);
  }

  /**
   * 키워드 확장 프롬프트 생성
   */
  private createExpansionPrompt(keyword: string, context?: string): string {
    return `
다음 키워드를 분석하여 관련된 동의어, 유의어, 전문용어를 생성해주세요.

키워드: "${keyword}"
${context ? `컨텍스트: "${context}"` : ''}

다음 형식으로 JSON 응답해주세요:
{
  "expandedKeywords": ["동의어1", "동의어2", "유의어1", "유의어2"],
  "semanticVariants": ["의미적변형1", "의미적변형2"],
  "domainSpecific": ["전문용어1", "전문용어2"],
  "confidence": 0.85
}

특히 다음 영역에서 관련 키워드를 찾아주세요:
- 금연정책 관련 시설 (체육시설, 어린이집, 학교, 병원 등)
- 법령 및 규정 관련 용어
- 행정 절차 및 신청 관련 용어
- 건강 및 의료 관련 용어
- 교육 및 보육 관련 용어
`;
  }

  /**
   * AI 응답 파싱
   */
  private parseAIResponse(keyword: string, response: string): KeywordExpansionResult {
    try {
      // JSON 파싱 시도
      const cleanResponse = response.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanResponse);
      
      return {
        originalKeyword: keyword,
        expandedKeywords: parsed.expandedKeywords || [],
        semanticVariants: parsed.semanticVariants || [],
        domainSpecific: parsed.domainSpecific || [],
        confidence: parsed.confidence || 0.8,
        source: 'ai'
      };
    } catch (error) {
      console.warn('AI 응답 파싱 실패:', error);
      return this.getFallbackExpansion(keyword);
    }
  }

  /**
   * 폴백 확장 (AI 실패 시)
   */
  private getFallbackExpansion(keyword: string): KeywordExpansionResult {
    // 기본적인 동의어 확장
    const basicSynonyms: { [key: string]: string[] } = {
      '체육시설': ['운동시설', '스포츠시설', '체육관', '운동장'],
      '어린이집': ['보육시설', '유치원', '어린이보호시설', '보육원'],
      '금연구역': ['흡연금지', '담배금지', '니코틴금지', '금연장소'],
      '법령': ['법규', '규정', '조항', '법률', '시행령'],
      '학교': ['교육시설', '학원', '교실', '교육기관'],
      '병원': ['의료시설', '클리닉', '의원', '보건소']
    };

    const synonyms = basicSynonyms[keyword] || [keyword];
    
    return {
      originalKeyword: keyword,
      expandedKeywords: synonyms,
      semanticVariants: synonyms,
      domainSpecific: synonyms,
      confidence: 0.5,
      source: 'ai'
    };
  }

  /**
   * 학습 데이터 기반 신뢰도 계산
   */
  private calculateConfidence(learningData: LearningData[]): number {
    if (learningData.length === 0) return 0;

    const avgSatisfaction = learningData.reduce((sum, data) => sum + data.userSatisfaction, 0) / learningData.length;
    const dataCount = Math.min(learningData.length / 10, 1); // 데이터 양에 따른 가중치
    
    return Math.min(avgSatisfaction * dataCount, 1);
  }

  /**
   * 학습 통계 조회
   */
  getLearningStats(): { totalKeywords: number; avgConfidence: number; recentLearning: number } {
    const totalKeywords = this.learningDatabase.size;
    let totalConfidence = 0;
    let recentLearning = 0;
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    this.learningDatabase.forEach(history => {
      const confidence = this.calculateConfidence(history);
      totalConfidence += confidence;
      
      const recentData = history.filter(data => data.timestamp > oneWeekAgo);
      recentLearning += recentData.length;
    });

    return {
      totalKeywords,
      avgConfidence: totalKeywords > 0 ? totalConfidence / totalKeywords : 0,
      recentLearning
    };
  }

  /**
   * 학습 데이터 초기화
   */
  clearLearningData(): void {
    this.learningDatabase.clear();
    console.log('🗑️ 학습 데이터 초기화 완료');
  }
}
