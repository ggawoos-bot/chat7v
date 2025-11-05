/**
 * 고급 검색 품질 향상 통합 서비스
 * 모든 새로운 검색 시스템을 통합하여 사용
 */

import { Chunk, QuestionAnalysis } from '../types';
import { ContextQualityOptimizer, EnhancedChunk } from './contextQualityOptimizer';
import { UnifiedSearchEngine, UnifiedSearchResult } from './unifiedSearchEngine';
import { AnswerValidationSystem } from './answerValidationSystem';
import { PromptEngineeringSystem } from './promptEngineeringSystem';

export interface AdvancedSearchResult {
  chunks: EnhancedChunk[];
  searchMetrics: {
    totalProcessed: number;
    uniqueResults: number;
    averageRelevance: number;
    searchCoverage: number;
    resultDiversity: number;
    executionTime: number;
    scoreBreakdown: {
      keyword: number;
      synonym: number;
      semantic: number;
    };
  };
  qualityMetrics: {
    totalChunks: number;
    averageRelevance: number;
    averageCompleteness: number;
    averageAccuracy: number;
    averageClarity: number;
    averageOverall: number;
    highQualityChunks: number;
    mediumQualityChunks: number;
    lowQualityChunks: number;
  };
}

export interface AnswerValidationResult {
  isValid: boolean;
  metrics: any;
  issues: any[];
  suggestions: string[];
  confidence: number;
}

export class AdvancedSearchQualityService {
  private unifiedSearch: UnifiedSearchEngine;
  private static readonly DEFAULT_MAX_CHUNKS = 50;  // ✅ 하이브리드 개선: 20 → 50
  private static readonly MAX_CONTEXT_LENGTH = 50000;

  constructor() {
    this.unifiedSearch = new UnifiedSearchEngine();
  }

  /**
   * 고급 검색 실행 (통합 검색 엔진 사용)
   */
  async executeAdvancedSearch(
    questionAnalysis: QuestionAnalysis,
    maxChunks: number = AdvancedSearchQualityService.DEFAULT_MAX_CHUNKS
  ): Promise<AdvancedSearchResult> {
    const startTime = Date.now();
    console.log(`🚀 통합 검색 실행: "${questionAnalysis.context}"`);
    
    // ✅ 핵심 수정: maxChunks가 유효하지 않으면 기본값 사용
    const validMaxChunks = (maxChunks && maxChunks > 0) ? maxChunks : AdvancedSearchQualityService.DEFAULT_MAX_CHUNKS;
    
    try {
      // ✅ 통합 검색 엔진 사용 (중복 제거, 성능 최적화)
      const unifiedResult = await this.unifiedSearch.executeUnifiedSearch(
        questionAnalysis,
        validMaxChunks
      );

      const executionTime = Date.now() - startTime;

      const result: AdvancedSearchResult = {
        chunks: unifiedResult.chunks,
        searchMetrics: {
          totalProcessed: unifiedResult.searchMetrics.totalProcessed,
          uniqueResults: unifiedResult.searchMetrics.uniqueResults,
          averageRelevance: unifiedResult.searchMetrics.averageRelevance,
          searchCoverage: unifiedResult.searchMetrics.uniqueResults / unifiedResult.searchMetrics.totalProcessed,
          resultDiversity: this.calculateDiversity(unifiedResult.chunks),
          executionTime,
          scoreBreakdown: unifiedResult.searchMetrics.scoreBreakdown
        },
        qualityMetrics: ContextQualityOptimizer.generateQualitySummary(unifiedResult.chunks)
      };

      console.log(`🎉 통합 검색 완료: ${unifiedResult.chunks.length}개 최종 결과, ${executionTime}ms`);
      console.log(`📊 검색 품질: 평균 관련성 ${result.searchMetrics.averageRelevance.toFixed(3)}`);
      console.log(`📊 컨텍스트 품질: 평균 점수 ${result.qualityMetrics.averageOverall.toFixed(3)}`);
      console.log(`📊 점수 분포: 키워드 ${result.searchMetrics.scoreBreakdown.keyword.toFixed(2)}, 동의어 ${result.searchMetrics.scoreBreakdown.synonym.toFixed(2)}, 의미 ${result.searchMetrics.scoreBreakdown.semantic.toFixed(2)}`);

      return result;

    } catch (error) {
      console.error('❌ 고급 검색 오류:', error);
      throw error;
    }
  }
  
  /**
   * 결과 다양성 계산
   */
  private calculateDiversity(chunks: EnhancedChunk[]): number {
    if (chunks.length === 0) return 0;
    
    const documentIds = new Set(chunks.map(c => c.metadata?.source || ''));
    return documentIds.size / chunks.length;
  }

  /**
   * 동적 프롬프트 생성
   */
  generateDynamicPrompt(
    questionAnalysis: QuestionAnalysis,
    contextText: string,
    customInstructions?: string[]
  ): any {
    console.log(`🔄 동적 프롬프트 생성: ${questionAnalysis.category}/${questionAnalysis.complexity}`);
    
    return PromptEngineeringSystem.generateDynamicPrompt(
      questionAnalysis,
      contextText,
      customInstructions
    );
  }

  /**
   * 답변 검증 실행
   */
  validateAnswer(
    answer: string,
    question: string,
    sources: Chunk[],
    questionAnalysis?: QuestionAnalysis
  ): AnswerValidationResult {
    console.log(`🔍 답변 검증 시작: "${question}"`);
    
    const validationResult = AnswerValidationSystem.validateAnswer(
      answer,
      question,
      sources,
      questionAnalysis
    );

    console.log(`✅ 답변 검증 완료: ${validationResult.isValid ? '유효' : '무효'} (신뢰도: ${validationResult.confidence.toFixed(3)})`);

    return validationResult;
  }

  /**
   * 중복 청크 제거
   */
  private removeDuplicateChunks(chunks: Chunk[]): Chunk[] {
    const seen = new Set<string>();
    return chunks.filter(chunk => {
      const key = chunk.content.substring(0, 100); // 첫 100자로 중복 판단
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * 컨텍스트 길이 제한 적용
   */
  private applyContextLengthLimit(chunks: EnhancedChunk[]): EnhancedChunk[] {
    let totalLength = 0;
    const limitedChunks: EnhancedChunk[] = [];

    for (const chunk of chunks) {
      // ✅ 핵심 수정: chunk.content가 undefined인 경우 대응
      const chunkLength = chunk.content?.length || 0;
      
      // ✅ 완화: MAX_CONTEXT_LENGTH를 초과해도 경고만 하고 계속 포함
      if (totalLength + chunkLength > this.MAX_CONTEXT_LENGTH) {
        console.warn(`⚠️ 컨텍스트 길이 초과: ${totalLength + chunkLength}자 (최대: ${this.MAX_CONTEXT_LENGTH}자) - 그러나 계속 포함`);
        // break 제거: 모든 청크 포함
      }
      limitedChunks.push(chunk);
      totalLength += chunkLength;
    }

    // ✅ 안전한 로그 출력
    const safeTotalLength = totalLength || 0;
    const safeMaxLength = this.MAX_CONTEXT_LENGTH || 0;
    
    console.log(`📏 컨텍스트 길이 제한 적용: ${safeTotalLength.toLocaleString()}자 (최대: ${safeMaxLength.toLocaleString()}자) - ${limitedChunks.length}개 청크`);
    
    return limitedChunks;
  }

  /**
   * 검색 성능 통계 생성
   */
  generateSearchStatistics(result: AdvancedSearchResult): {
    totalExecutionTime: number;
    searchEfficiency: number;
    qualityBreakdown: any;
    performanceMetrics: any;
  } {
    const searchEfficiency = result.chunks.length / result.searchMetrics.totalStages;
    
    return {
      totalExecutionTime: result.searchMetrics.executionTime,
      searchEfficiency: Number(searchEfficiency.toFixed(4)),
      qualityBreakdown: result.qualityMetrics,
      performanceMetrics: {
        stagesExecuted: result.searchMetrics.totalStages,
        stagesSuccessful: result.searchMetrics.successfulStages,
        averageRelevance: result.searchMetrics.averageRelevance,
        searchCoverage: result.searchMetrics.searchCoverage,
        resultDiversity: result.searchMetrics.resultDiversity
      }
    };
  }

  /**
   * 검색 품질 리포트 생성
   */
  generateQualityReport(result: AdvancedSearchResult): {
    overallScore: number;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
  } {
    const overallScore = result.qualityMetrics.averageOverall;
    
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];

    // 강점 분석
    if (result.qualityMetrics.averageRelevance >= 0.8) {
      strengths.push('높은 관련성 점수');
    }
    if (result.qualityMetrics.averageCompleteness >= 0.8) {
      strengths.push('완성도 높은 결과');
    }
    if (result.qualityMetrics.averageAccuracy >= 0.8) {
      strengths.push('정확한 정보 제공');
    }
    if (result.searchMetrics.searchCoverage >= 0.8) {
      strengths.push('포괄적인 검색 범위');
    }

    // 약점 분석
    if (result.qualityMetrics.averageRelevance < 0.6) {
      weaknesses.push('낮은 관련성');
      recommendations.push('키워드 확장 및 동의어 사전 개선');
    }
    if (result.qualityMetrics.averageCompleteness < 0.6) {
      weaknesses.push('불완전한 정보');
      recommendations.push('검색 범위 확대 및 컨텍스트 품질 향상');
    }
    if (result.qualityMetrics.averageAccuracy < 0.6) {
      weaknesses.push('정확성 부족');
      recommendations.push('출처 검증 및 사실 확인 강화');
    }
    if (result.searchMetrics.searchCoverage < 0.6) {
      weaknesses.push('제한적인 검색 범위');
      recommendations.push('다단계 검색 시스템 개선');
    }

    // 일반적 권장사항
    if (overallScore < 0.7) {
      recommendations.push('전체적인 검색 품질 향상 필요');
    }
    if (result.qualityMetrics.lowQualityChunks > result.qualityMetrics.highQualityChunks) {
      recommendations.push('저품질 청크 필터링 강화');
    }

    return {
      overallScore: Number(overallScore.toFixed(3)),
      strengths,
      weaknesses,
      recommendations
    };
  }
}
