/**
 * 답변 검증 시스템
 * 품질 지표 실시간 측정 및 답변 품질 보장
 */

import { Chunk } from '../types';

export interface AnswerValidationMetrics {
  completeness: number;
  accuracy: number;
  consistency: number;
  clarity: number;
  relevance: number;
  overallScore: number;
}

export interface ValidationResult {
  isValid: boolean;
  metrics: AnswerValidationMetrics;
  issues: ValidationIssue[];
  suggestions: string[];
  confidence: number;
}

export interface ValidationIssue {
  type: 'completeness' | 'accuracy' | 'consistency' | 'clarity' | 'relevance';
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggestion: string;
}

export class AnswerValidationSystem {
  private static readonly MIN_OVERALL_SCORE = 0.7;
  private static readonly MIN_CONFIDENCE = 0.6;

  /**
   * 답변 검증 실행
   */
  static validateAnswer(
    answer: string,
    question: string,
    sources: Chunk[],
    questionAnalysis?: any
  ): ValidationResult {
    console.log(`🔍 답변 검증 시작: "${question}"`);
    
    const metrics = this.calculateValidationMetrics(answer, question, sources, questionAnalysis);
    const issues = this.identifyIssues(answer, question, sources, metrics);
    const suggestions = this.generateSuggestions(issues);
    const confidence = this.calculateConfidence(metrics, issues);
    const isValid = this.determineValidity(metrics, issues, confidence);
    
    const result: ValidationResult = {
      isValid,
      metrics,
      issues,
      suggestions,
      confidence
    };
    
    console.log(`✅ 답변 검증 완료: ${isValid ? '유효' : '무효'} (신뢰도: ${confidence.toFixed(3)})`);
    
    return result;
  }

  /**
   * 검증 지표 계산
   */
  private static calculateValidationMetrics(
    answer: string,
    question: string,
    sources: Chunk[],
    questionAnalysis?: any
  ): AnswerValidationMetrics {
    const completeness = this.calculateCompleteness(answer, question);
    const accuracy = this.calculateAccuracy(answer, sources);
    const consistency = this.calculateConsistency(answer, sources);
    const clarity = this.calculateClarity(answer);
    const relevance = this.calculateRelevance(answer, question, questionAnalysis);
    
    const overallScore = (
      completeness * 0.25 +
      accuracy * 0.25 +
      consistency * 0.2 +
      clarity * 0.15 +
      relevance * 0.15
    );
    
    return {
      completeness,
      accuracy,
      consistency,
      clarity,
      relevance,
      overallScore
    };
  }

  /**
   * 완성도 계산
   */
  private static calculateCompleteness(answer: string, question: string): number {
    let completeness = 0.5; // 기본 점수
    
    // 질문 키워드 포함 여부
    const questionKeywords = this.extractKeywords(question);
    const answerKeywords = this.extractKeywords(answer);
    const keywordCoverage = questionKeywords.filter(keyword => 
      answerKeywords.some(answerKeyword => 
        answerKeyword.includes(keyword) || keyword.includes(answerKeyword)
      )
    ).length / Math.max(questionKeywords.length, 1);
    
    completeness += keywordCoverage * 0.3;
    
    // 답변 길이 적절성
    const answerLength = answer.length;
    if (answerLength >= 50 && answerLength <= 1000) {
      completeness += 0.2;
    } else if (answerLength > 1000) {
      completeness += 0.1;
    }
    
    // 구조적 완성도 (문단, 문장 구조)
    if (answer.includes('\n') || answer.includes('•') || answer.includes('-')) {
      completeness += 0.1;
    }
    
    return Math.min(completeness, 1);
  }

  /**
   * 정확성 계산
   */
  private static calculateAccuracy(answer: string, sources: Chunk[]): number {
    let accuracy = 0.5; // 기본 점수
    
    if (sources.length === 0) {
      return 0.3; // 출처가 없으면 낮은 점수
    }
    
    // 출처 기반 사실 검증
    const sourceContent = sources.map(source => source.content).join(' ');
    const answerSentences = answer.split(/[.!?]/).filter(s => s.trim().length > 0);
    
    let verifiedSentences = 0;
    answerSentences.forEach(sentence => {
      if (this.isSentenceVerified(sentence, sourceContent)) {
        verifiedSentences++;
      }
    });
    
    const verificationRate = verifiedSentences / Math.max(answerSentences.length, 1);
    accuracy += verificationRate * 0.4;
    
    // 법령 관련 용어 정확성
    const legalTerms = ['법', '규정', '지침', '안내', '절차'];
    const hasLegalTerms = legalTerms.some(term => answer.includes(term));
    if (hasLegalTerms) {
      accuracy += 0.1;
    }
    
    return Math.min(accuracy, 1);
  }

  /**
   * 일관성 계산
   */
  private static calculateConsistency(answer: string, sources: Chunk[]): number {
    let consistency = 0.5; // 기본 점수
    
    if (sources.length === 0) {
      return 0.3;
    }
    
    // 출처 간 일관성 확인
    const sourceContents = sources.map(source => source.content);
    const answerContent = answer.toLowerCase();
    
    let consistentClaims = 0;
    let totalClaims = 0;
    
    // 답변의 주요 주장들을 추출하고 출처와 비교
    const claims = this.extractClaims(answer);
    claims.forEach(claim => {
      totalClaims++;
      const isConsistent = sourceContents.some(source => 
        this.isClaimConsistent(claim, source.toLowerCase())
      );
      if (isConsistent) {
        consistentClaims++;
      }
    });
    
    if (totalClaims > 0) {
      consistency += (consistentClaims / totalClaims) * 0.4;
    }
    
    // 답변 내부 일관성 (모순 없는지)
    const internalConsistency = this.checkInternalConsistency(answer);
    consistency += internalConsistency * 0.1;
    
    return Math.min(consistency, 1);
  }

  /**
   * 명확성 계산
   */
  private static calculateClarity(answer: string): number {
    let clarity = 0.5; // 기본 점수
    
    // 문장 구조의 명확성
    const sentences = answer.split(/[.!?]/).filter(s => s.trim().length > 0);
    if (sentences.length > 0) {
      const avgSentenceLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;
      
      if (avgSentenceLength >= 20 && avgSentenceLength <= 100) {
        clarity += 0.2;
      } else if (avgSentenceLength > 100) {
        clarity += 0.1;
      }
    }
    
    // 전문용어와 일반용어의 균형
    const technicalTerms = /[가-힣]{3,}법|[가-힣]{3,}규정|[가-힣]{3,}지침/.test(answer);
    const commonTerms = /[가-힣]{2,}시설|[가-힣]{2,}장소|[가-힣]{2,}방법/.test(answer);
    
    if (technicalTerms && commonTerms) {
      clarity += 0.2;
    } else if (technicalTerms || commonTerms) {
      clarity += 0.1;
    }
    
    // 구체적 정보 포함
    const hasSpecificInfo = /\d{4}년|\d+일|\d+%|\d+원/.test(answer);
    if (hasSpecificInfo) {
      clarity += 0.1;
    }
    
    return Math.min(clarity, 1);
  }

  /**
   * 관련성 계산
   */
  private static calculateRelevance(answer: string, question: string, questionAnalysis?: any): number {
    let relevance = 0.5; // 기본 점수
    
    // 질문과 답변의 키워드 유사성
    const questionKeywords = this.extractKeywords(question);
    const answerKeywords = this.extractKeywords(answer);
    
    const commonKeywords = questionKeywords.filter(qKeyword => 
      answerKeywords.some(aKeyword => 
        aKeyword.includes(qKeyword) || qKeyword.includes(aKeyword)
      )
    );
    
    const keywordRelevance = commonKeywords.length / Math.max(questionKeywords.length, 1);
    relevance += keywordRelevance * 0.4;
    
    // 질문 유형별 관련성
    if (questionAnalysis) {
      const category = questionAnalysis.category;
      const intent = questionAnalysis.intent;
      
      if (category === 'regulation' && answer.includes('법') || answer.includes('규정')) {
        relevance += 0.1;
      }
      
      if (intent && answer.toLowerCase().includes(intent.toLowerCase())) {
        relevance += 0.1;
      }
    }
    
    return Math.min(relevance, 1);
  }

  /**
   * 문제점 식별
   */
  private static identifyIssues(
    answer: string,
    question: string,
    sources: Chunk[],
    metrics: AnswerValidationMetrics
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    
    // 완성도 문제
    if (metrics.completeness < 0.6) {
      issues.push({
        type: 'completeness',
        severity: metrics.completeness < 0.4 ? 'high' : 'medium',
        description: '답변이 질문에 대한 완전한 정보를 제공하지 못함',
        suggestion: '질문의 모든 측면을 다루는 더 포괄적인 답변을 제공하세요'
      });
    }
    
    // 정확성 문제
    if (metrics.accuracy < 0.6) {
      issues.push({
        type: 'accuracy',
        severity: metrics.accuracy < 0.4 ? 'high' : 'medium',
        description: '답변의 사실적 정확성에 문제가 있음',
        suggestion: '제공된 자료를 더 정확히 인용하고 사실을 검증하세요'
      });
    }
    
    // 일관성 문제
    if (metrics.consistency < 0.6) {
      issues.push({
        type: 'consistency',
        severity: metrics.consistency < 0.4 ? 'high' : 'medium',
        description: '답변과 출처 간 일관성에 문제가 있음',
        suggestion: '출처 자료와 일치하는 정보만 포함하세요'
      });
    }
    
    // 명확성 문제
    if (metrics.clarity < 0.6) {
      issues.push({
        type: 'clarity',
        severity: metrics.clarity < 0.4 ? 'high' : 'medium',
        description: '답변이 명확하지 않거나 이해하기 어려움',
        suggestion: '더 명확하고 이해하기 쉬운 언어로 답변하세요'
      });
    }
    
    // 관련성 문제
    if (metrics.relevance < 0.6) {
      issues.push({
        type: 'relevance',
        severity: metrics.relevance < 0.4 ? 'high' : 'medium',
        description: '답변이 질문과 관련성이 낮음',
        suggestion: '질문의 핵심 키워드와 의도를 더 명확히 반영하세요'
      });
    }
    
    return issues;
  }

  /**
   * 개선 제안 생성
   */
  private static generateSuggestions(issues: ValidationIssue[]): string[] {
    const suggestions: string[] = [];
    
    issues.forEach(issue => {
      suggestions.push(issue.suggestion);
    });
    
    // 일반적인 개선 제안
    if (issues.length > 0) {
      suggestions.push('제공된 자료를 더 철저히 검토하고 인용하세요');
      suggestions.push('구체적인 예시나 사례를 포함하여 답변을 풍부하게 하세요');
    }
    
    return [...new Set(suggestions)]; // 중복 제거
  }

  /**
   * 신뢰도 계산
   */
  private static calculateConfidence(metrics: AnswerValidationMetrics, issues: ValidationIssue[]): number {
    let confidence = metrics.overallScore;
    
    // 심각한 문제가 있으면 신뢰도 감소
    const highSeverityIssues = issues.filter(issue => issue.severity === 'high').length;
    const mediumSeverityIssues = issues.filter(issue => issue.severity === 'medium').length;
    
    confidence -= highSeverityIssues * 0.2;
    confidence -= mediumSeverityIssues * 0.1;
    
    return Math.max(confidence, 0);
  }

  /**
   * 유효성 판단
   */
  private static determineValidity(
    metrics: AnswerValidationMetrics,
    issues: ValidationIssue[],
    confidence: number
  ): boolean {
    return (
      metrics.overallScore >= this.MIN_OVERALL_SCORE &&
      confidence >= this.MIN_CONFIDENCE &&
      issues.filter(issue => issue.severity === 'high').length === 0
    );
  }

  /**
   * 키워드 추출
   */
  private static extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 1)
      .filter(word => !['그리고', '또한', '하지만', '따라서', '그러나'].includes(word));
  }

  /**
   * 문장 검증
   */
  private static isSentenceVerified(sentence: string, sourceContent: string): boolean {
    const sentenceKeywords = this.extractKeywords(sentence);
    const sourceKeywords = this.extractKeywords(sourceContent);
    
    // 문장의 주요 키워드가 출처에 포함되어 있는지 확인
    const verifiedKeywords = sentenceKeywords.filter(keyword => 
      sourceKeywords.some(sourceKeyword => 
        sourceKeyword.includes(keyword) || keyword.includes(sourceKeyword)
      )
    );
    
    return verifiedKeywords.length >= Math.max(sentenceKeywords.length * 0.5, 1);
  }

  /**
   * 주장 추출
   */
  private static extractClaims(text: string): string[] {
    const sentences = text.split(/[.!?]/).filter(s => s.trim().length > 0);
    return sentences.filter(sentence => 
      sentence.includes('입니다') || 
      sentence.includes('됩니다') || 
      sentence.includes('입니다') ||
      sentence.includes('규정') ||
      sentence.includes('법령')
    );
  }

  /**
   * 주장 일관성 확인
   */
  private static isClaimConsistent(claim: string, source: string): boolean {
    const claimKeywords = this.extractKeywords(claim);
    const sourceKeywords = this.extractKeywords(source);
    
    const matchingKeywords = claimKeywords.filter(keyword => 
      sourceKeywords.some(sourceKeyword => 
        sourceKeyword.includes(keyword) || keyword.includes(sourceKeyword)
      )
    );
    
    return matchingKeywords.length >= Math.max(claimKeywords.length * 0.6, 1);
  }

  /**
   * 내부 일관성 확인
   */
  private static checkInternalConsistency(answer: string): number {
    // 간단한 내부 일관성 검사
    const sentences = answer.split(/[.!?]/).filter(s => s.trim().length > 0);
    
    if (sentences.length < 2) return 1;
    
    // 모순적인 표현 검사
    const contradictions = [
      ['금지', '허용'],
      ['필수', '선택'],
      ['의무', '권장'],
      ['불가능', '가능']
    ];
    
    let contradictionCount = 0;
    contradictions.forEach(([term1, term2]) => {
      const hasTerm1 = sentences.some(s => s.includes(term1));
      const hasTerm2 = sentences.some(s => s.includes(term2));
      if (hasTerm1 && hasTerm2) {
        contradictionCount++;
      }
    });
    
    return Math.max(1 - (contradictionCount / contradictions.length), 0);
  }

  /**
   * 검증 결과 요약 생성
   */
  static generateValidationSummary(result: ValidationResult): {
    isValid: boolean;
    overallScore: number;
    confidence: number;
    issueCount: number;
    highSeverityIssues: number;
    recommendations: string[];
  } {
    return {
      isValid: result.isValid,
      overallScore: result.metrics.overallScore,
      confidence: result.confidence,
      issueCount: result.issues.length,
      highSeverityIssues: result.issues.filter(issue => issue.severity === 'high').length,
      recommendations: result.suggestions
    };
  }
}
