/**
 * 컨텍스트 품질 최적화 서비스
 * 관련성 점수 기반 필터링 및 컨텍스트 품질 향상
 */

import { Chunk, QuestionAnalysis } from '../types';

export interface ContextQualityMetrics {
  relevanceScore: number;
  completenessScore: number;
  accuracyScore: number;
  clarityScore: number;
  overallScore: number;
}

export interface EnhancedChunk extends Chunk {
  qualityMetrics: ContextQualityMetrics;
  contextInfo: {
    documentType: string;
    section: string;
    importance: 'high' | 'medium' | 'low';
    lastUpdated?: Date;
  };
}

export class ContextQualityOptimizer {
  // ✅ 완화: 임계값을 낮춰 더 많은 청크 포함
  private static readonly MIN_RELEVANCE_SCORE = 0.1; // 0.7 → 0.1 (완화)
  private static readonly MIN_OVERALL_SCORE = 0.1; // 0.6 → 0.1 (완화)
  private static readonly MAX_CONTEXT_LENGTH = 50000; // ✅ 개선: 20,000 → 50,000자

  /**
   * 컨텍스트 품질 최적화
   */
  static optimizeContextQuality(
    chunks: Chunk[],
    questionAnalysis: QuestionAnalysis,
    maxChunks: number = 10
  ): EnhancedChunk[] {
    console.log(`🔍 컨텍스트 품질 최적화 시작: ${chunks.length}개 청크`);
    
    // 1. 관련성 점수 계산
    const chunksWithRelevance = chunks.map(chunk => 
      this.calculateRelevanceScore(chunk, questionAnalysis)
    );

    // 2. 품질 지표 계산
    const enhancedChunks = chunksWithRelevance.map(chunk => 
      this.calculateQualityMetrics(chunk, questionAnalysis)
    );

    // ✅ 핵심 수정: 품질 기준 필터링 제거, 점수 순으로 정렬하여 상위 N개 선택
    // 3. 품질 점수 순 정렬
    const sortedChunks = enhancedChunks.sort((a, b) => 
      b.qualityMetrics.overallScore - a.qualityMetrics.overallScore
    );

    // 4. 상위 maxChunks개만 선택 (필터링 없이)
    const selectedChunks = sortedChunks.slice(0, maxChunks);

    // 5. 컨텍스트 길이 제한 적용
    const optimizedChunks = this.applyContextLengthLimit(selectedChunks, maxChunks);

    console.log(`✅ 컨텍스트 품질 최적화 완료: ${optimizedChunks.length}개 청크 선택`);
    console.log(`📊 평균 품질 점수: ${this.calculateAverageScore(optimizedChunks).toFixed(2)}`);
    
    return optimizedChunks;
  }

  /**
   * 관련성 점수 계산
   */
  private static calculateRelevanceScore(
    chunk: Chunk,
    questionAnalysis: QuestionAnalysis
  ): Chunk & { relevanceScore: number } {
    let relevanceScore = 0;
    const content = chunk.content.toLowerCase();
    // ✅ 핵심 수정: undefined 대응
    const questionKeywords = (questionAnalysis.keywords || []).map(k => k.toLowerCase());
    const expandedKeywords = (questionAnalysis.expandedKeywords || []).map(k => k.toLowerCase());

    // 1. 정확한 키워드 매칭 (가중치: 3)
    questionKeywords.forEach(keyword => {
      if (content.includes(keyword)) {
        relevanceScore += 3;
      }
    });

    // 2. 확장된 키워드 매칭 (가중치: 2)
    expandedKeywords.forEach(keyword => {
      if (content.includes(keyword)) {
        relevanceScore += 2;
      }
    });

    // 3. 문맥적 유사성 (가중치: 1)
    const contextSimilarity = this.calculateContextSimilarity(
      chunk.content,
      questionAnalysis.context
    );
    relevanceScore += contextSimilarity;

    // 4. 문서 유형 매칭
    if (this.isDocumentTypeRelevant(chunk, questionAnalysis)) {
      relevanceScore += 1;
    }

    // 5. 위치 기반 가중치
    const positionWeight = this.calculatePositionWeight(chunk);
    relevanceScore += positionWeight;

    // 정규화 (0-1 범위)
    const normalizedScore = Math.min(relevanceScore / 10, 1);

    return {
      ...chunk,
      relevanceScore: normalizedScore
    };
  }

  /**
   * 품질 지표 계산
   */
  private static calculateQualityMetrics(
    chunk: Chunk & { relevanceScore: number },
    questionAnalysis: QuestionAnalysis
  ): EnhancedChunk {
    const completenessScore = this.calculateCompletenessScore(chunk, questionAnalysis);
    const accuracyScore = this.calculateAccuracyScore(chunk);
    const clarityScore = this.calculateClarityScore(chunk);
    
    const overallScore = (
      chunk.relevanceScore * 0.4 +
      completenessScore * 0.3 +
      accuracyScore * 0.2 +
      clarityScore * 0.1
    );

    return {
      ...chunk,
      qualityMetrics: {
        relevanceScore: chunk.relevanceScore,
        completenessScore,
        accuracyScore,
        clarityScore,
        overallScore
      },
      contextInfo: {
        documentType: chunk.metadata.documentType || 'unknown',
        section: chunk.location.section || 'general',
        importance: this.determineImportance(chunk, questionAnalysis),
        lastUpdated: new Date()
      }
    };
  }

  /**
   * 완성도 점수 계산
   */
  private static calculateCompletenessScore(
    chunk: Chunk,
    questionAnalysis: QuestionAnalysis
  ): number {
    const content = chunk.content;
    const keywords = questionAnalysis.keywords;
    
    let completenessScore = 0;
    
    // 키워드 포함 비율
    const keywordCoverage = keywords.filter(keyword => 
      content.toLowerCase().includes(keyword.toLowerCase())
    ).length / keywords.length;
    
    completenessScore += keywordCoverage * 0.5;
    
    // 내용 길이 적절성
    const contentLength = content.length;
    if (contentLength >= 100 && contentLength <= 2000) {
      completenessScore += 0.3;
    } else if (contentLength > 2000) {
      completenessScore += 0.2;
    }
    
    // 구조적 완성도 (문장 끝, 문단 구분 등)
    if (content.includes('.') && content.includes(' ')) {
      completenessScore += 0.2;
    }
    
    return Math.min(completenessScore, 1);
  }

  /**
   * 정확성 점수 계산
   */
  private static calculateAccuracyScore(chunk: Chunk): number {
    const content = chunk.content;
    let accuracyScore = 0.5; // 기본 점수
    
    // 법령 관련 용어 포함
    const legalTerms = ['법', '규정', '지침', '안내', '절차', '요건'];
    const hasLegalTerms = legalTerms.some(term => content.includes(term));
    if (hasLegalTerms) accuracyScore += 0.2;
    
    // 구체적 정보 포함 (날짜, 숫자, 단위 등)
    const hasSpecificInfo = /\d{4}년|\d+일|\d+%|\d+원/.test(content);
    if (hasSpecificInfo) accuracyScore += 0.2;
    
    // 출처 정보 포함
    const hasSource = chunk.metadata.source && chunk.metadata.source !== 'Unknown';
    if (hasSource) accuracyScore += 0.1;
    
    return Math.min(accuracyScore, 1);
  }

  /**
   * 명확성 점수 계산
   */
  private static calculateClarityScore(chunk: Chunk): number {
    const content = chunk.content;
    let clarityScore = 0.5; // 기본 점수
    
    // 문장 구조의 명확성
    const sentences = content.split(/[.!?]/).filter(s => s.trim().length > 0);
    const avgSentenceLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;
    
    if (avgSentenceLength >= 20 && avgSentenceLength <= 100) {
      clarityScore += 0.3;
    }
    
    // 전문용어와 일반용어의 균형
    const hasTechnicalTerms = /[가-힣]{3,}법|[가-힣]{3,}규정|[가-힣]{3,}지침/.test(content);
    const hasCommonTerms = /[가-힣]{2,}시설|[가-힣]{2,}장소|[가-힣]{2,}방법/.test(content);
    
    if (hasTechnicalTerms && hasCommonTerms) {
      clarityScore += 0.2;
    }
    
    return Math.min(clarityScore, 1);
  }

  /**
   * 문맥적 유사성 계산
   */
  private static calculateContextSimilarity(content: string, context: string): number {
    const contentWords = content.toLowerCase().split(/\s+/);
    const contextWords = context.toLowerCase().split(/\s+/);
    
    const commonWords = contentWords.filter(word => 
      contextWords.includes(word) && word.length > 2
    );
    
    return commonWords.length / Math.max(contentWords.length, contextWords.length);
  }

  /**
   * 문서 유형 관련성 확인
   */
  private static isDocumentTypeRelevant(
    chunk: Chunk,
    questionAnalysis: QuestionAnalysis
  ): boolean {
    const documentType = chunk.metadata.documentType;
    const category = questionAnalysis.category;
    
    if (category === 'regulation' && documentType === 'legal') return true;
    if (category === 'procedure' && documentType === 'guideline') return true;
    
    return false;
  }

  /**
   * 위치 기반 가중치 계산
   */
  private static calculatePositionWeight(chunk: Chunk): number {
    const position = chunk.metadata.position || 0;
    const totalSize = chunk.metadata.originalSize || 1;
    
    const relativePosition = position / totalSize;
    
    // 문서 앞부분과 뒷부분에 가중치 부여
    if (relativePosition < 0.1 || relativePosition > 0.9) {
      return 0.5;
    } else if (relativePosition < 0.2 || relativePosition > 0.8) {
      return 0.3;
    }
    
    return 0.1;
  }

  /**
   * 중요도 결정
   */
  private static determineImportance(
    chunk: Chunk,
    questionAnalysis: QuestionAnalysis
  ): 'high' | 'medium' | 'low' {
    const relevanceScore = chunk.relevanceScore || 0;
    
    if (relevanceScore >= 0.8) return 'high';
    if (relevanceScore >= 0.6) return 'medium';
    return 'low';
  }

  /**
   * 컨텍스트 길이 제한 적용
   */
  private static applyContextLengthLimit(
    chunks: EnhancedChunk[],
    maxChunks: number
  ): EnhancedChunk[] {
    let totalLength = 0;
    const selectedChunks: EnhancedChunk[] = [];
    
    // ✅ 개선: 청크가 없으면 빈 배열 반환
    if (chunks.length === 0) {
      console.log(`📏 컨텍스트 길이 제한 적용: 0자 (최대: ${this.MAX_CONTEXT_LENGTH}자) - 청크 없음`);
      return [];
    }
    
    // ✅ 개선: content가 없는 청크는 스킵
    const validChunks = chunks.filter(chunk => chunk.content && chunk.content.length > 0);
    
    if (validChunks.length === 0) {
      console.log(`⚠️ 컨텍스트 길이 제한 적용: 유효한 청크 없음`);
      return [];
    }
    
    // ✅ 개선: 길이 제한보다 작은 청크도 허용 (적어도 1개는 반환)
    for (const chunk of validChunks) {
      if (selectedChunks.length >= maxChunks) break;
      
      // ✅ 핵심 수정: 첫 번째 청크는 무조건 포함 (길이와 상관없이)
      if (selectedChunks.length === 0) {
        selectedChunks.push(chunk);
        totalLength += chunk.content.length;
        continue;
      }
      
      // 나머지 청크는 길이 제한 체크
      if (totalLength + chunk.content.length > this.MAX_CONTEXT_LENGTH) {
        // 경고만 로그하고 계속 진행 (최소 1개는 포함됨)
        if (totalLength > this.MAX_CONTEXT_LENGTH * 0.8) {
          console.log(`⚠️ 컨텍스트 길이 초과: ${totalLength}자 (최대: ${this.MAX_CONTEXT_LENGTH}자), 더 추가하지 않음`);
          break;
        }
      }
      
      selectedChunks.push(chunk);
      totalLength += chunk.content.length;
    }
    
    console.log(`📏 컨텍스트 길이 제한 적용: ${totalLength}자 (최대: ${this.MAX_CONTEXT_LENGTH}자), ${selectedChunks.length}개 청크`);
    
    return selectedChunks;
  }

  /**
   * 평균 품질 점수 계산
   */
  private static calculateAverageScore(chunks: EnhancedChunk[]): number {
    if (chunks.length === 0) return 0;
    
    const totalScore = chunks.reduce((sum, chunk) => 
      sum + chunk.qualityMetrics.overallScore, 0
    );
    
    return totalScore / chunks.length;
  }

  /**
   * 품질 지표 요약 생성
   */
  static generateQualitySummary(chunks: EnhancedChunk[]): {
    totalChunks: number;
    averageRelevance: number;
    averageCompleteness: number;
    averageAccuracy: number;
    averageClarity: number;
    averageOverall: number;
    highQualityChunks: number;
    mediumQualityChunks: number;
    lowQualityChunks: number;
  } {
    const totalChunks = chunks.length;
    const averageRelevance = chunks.reduce((sum, c) => sum + c.qualityMetrics.relevanceScore, 0) / totalChunks;
    const averageCompleteness = chunks.reduce((sum, c) => sum + c.qualityMetrics.completenessScore, 0) / totalChunks;
    const averageAccuracy = chunks.reduce((sum, c) => sum + c.qualityMetrics.accuracyScore, 0) / totalChunks;
    const averageClarity = chunks.reduce((sum, c) => sum + c.qualityMetrics.clarityScore, 0) / totalChunks;
    const averageOverall = chunks.reduce((sum, c) => sum + c.qualityMetrics.overallScore, 0) / totalChunks;
    
    const highQualityChunks = chunks.filter(c => c.qualityMetrics.overallScore >= 0.8).length;
    const mediumQualityChunks = chunks.filter(c => c.qualityMetrics.overallScore >= 0.6 && c.qualityMetrics.overallScore < 0.8).length;
    const lowQualityChunks = chunks.filter(c => c.qualityMetrics.overallScore < 0.6).length;
    
    return {
      totalChunks,
      averageRelevance: Number(averageRelevance.toFixed(3)),
      averageCompleteness: Number(averageCompleteness.toFixed(3)),
      averageAccuracy: Number(averageAccuracy.toFixed(3)),
      averageClarity: Number(averageClarity.toFixed(3)),
      averageOverall: Number(averageOverall.toFixed(3)),
      highQualityChunks,
      mediumQualityChunks,
      lowQualityChunks
    };
  }
}
