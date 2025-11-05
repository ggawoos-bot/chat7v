/**
 * PDF 내용 압축 서비스
 * 품질을 최대한 유지하면서 토큰 사용량을 줄이는 압축 기능 제공
 */

import { Chunk } from '../types';

export interface CompressionResult {
  compressedText: string;
  originalLength: number;
  compressedLength: number;
  compressionRatio: number;
  estimatedTokens: number;
  qualityScore: number;
}

export interface CompressionOptions {
  maxTokens: number;
  preserveKeywords: string[];
  minChunkSize: number;
  maxChunkSize: number;
  maxChunks: number;
}

export class PDFCompressionService {
  private static readonly DEFAULT_OPTIONS: CompressionOptions = {
    maxTokens: 2500, // 2,500 토큰 (약 10,000자)
    preserveKeywords: [
      // ✅ 핵심 키워드만 보존 (범용적)
      // 1. 금연 관련 핵심 용어
      '금연', '금연구역', '건강증진', '시행령', '시행규칙',
      '지정', '관리', '업무', '지침',
      
      // 2. 법적/행정 핵심 용어
      '법령', '법률', '규정', '조항', '항목', '고시', '공고',
      '의무', '권한', '책임', '적용', '범위', '대상',
      
      // 3. 행정 절차 핵심 용어
      '신고', '신청', '처리', '심사', '승인', '허가', '등록',
      '변경', '취소', '정지', '폐지', '위반', '과태료',
      
      // 4. 동적 키워드 플레이스홀더 (자동 추출)
      'DYNAMIC_KEYWORDS'
    ],
    minChunkSize: 1000,
    maxChunkSize: 10000,
    maxChunks: 50
  };

  /**
   * PDF 텍스트에서 모든 한글 단어를 추출하여 키워드 목록에 추가
   */
  private extractDynamicKeywords(text: string): string[] {
    // 모든 한글 단어 추출 (2글자 이상)
    const koreanWords = text.match(/[가-힣]+/g) || [];
    const uniqueWords = [...new Set(koreanWords)];
    
    // 2글자 이상이고, 너무 일반적인 단어 제외
    const filteredWords = uniqueWords.filter(word => {
      return word.length >= 2 && 
             word.length <= 10 && // 너무 긴 단어 제외
             !this.isCommonWord(word); // 일반적인 단어 제외
    });
    
    // 빈도순으로 정렬하여 상위 100개만 선택
    const wordFreq = {};
    filteredWords.forEach(word => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });
    
    return Object.entries(wordFreq)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 100)
      .map(([word]) => word);
  }
  
  /**
   * 일반적인 단어인지 확인
   */
  private isCommonWord(word: string): boolean {
    const commonWords = [
      '것', '이', '그', '저', '의', '을', '를', '에', '에서', '로', '으로',
      '와', '과', '는', '은', '가', '이', '다', '하다', '있다', '없다',
      '되다', '하다', '보다', '같다', '다르다', '크다', '작다', '많다', '적다',
      '좋다', '나쁘다', '새', '오래', '빠르다', '느리다', '높다', '낮다',
      '여기', '저기', '어디', '언제', '어떻게', '왜', '무엇', '누구',
      '모든', '전체', '일부', '대부분', '일부', '모든', '각', '모든'
    ];
    return commonWords.includes(word);
  }

  /**
   * 개선된 압축 처리 (동적 키워드 포함)
   */
  async compressPdfContentWithDynamicKeywords(
    fullText: string, 
    options: Partial<CompressionOptions> = {}
  ): Promise<CompressionResult> {
    // 1. 동적 키워드 추출
    const dynamicKeywords = this.extractDynamicKeywords(fullText);
    console.log(`동적 키워드 추출: ${dynamicKeywords.length}개`);
    
    // 2. 기존 키워드와 동적 키워드 결합
    const allKeywords = [
      ...PDFCompressionService.DEFAULT_OPTIONS.preserveKeywords.filter(k => k !== 'DYNAMIC_KEYWORDS'),
      ...dynamicKeywords
    ];
    
    // 3. 키워드 중복 제거
    const uniqueKeywords = [...new Set(allKeywords)];
    console.log(`총 키워드 수: ${uniqueKeywords.length}개`);
    
    // 4. 확장된 키워드로 압축 처리
    const extendedOptions = {
      ...options,
      preserveKeywords: uniqueKeywords
    };
    
    return this.compressPdfContent(fullText, extendedOptions);
  }

  /**
   * PDF 텍스트를 품질을 유지하면서 압축 (에러 처리 포함 + 성능 최적화)
   */
  async compressPdfContent(
    fullText: string, 
    options: Partial<CompressionOptions> = {}
  ): Promise<CompressionResult> {
    try {
      const opts = { ...PDFCompressionService.DEFAULT_OPTIONS, ...options };
      
      console.log('PDF 압축 시작...');
      console.log(`원본 크기: ${fullText.length.toLocaleString()}자`);
      
      // 입력 검증
      if (!fullText || fullText.trim().length === 0) {
        throw new Error('입력 텍스트가 비어있습니다.');
      }
      
      if (fullText.length < 100) {
        console.warn('입력 텍스트가 매우 짧습니다. 압축이 필요하지 않을 수 있습니다.');
        return this.createMinimalResult(fullText);
      }
      
      // 빠른 압축을 위한 단계별 처리 (비동기)
      const compressionSteps = [
        () => this.cleanPdfText(fullText),
        (cleaned: string) => this.extractImportantSections(cleaned, opts.preserveKeywords),
        (structured: string) => this.processChunks(structured, opts),
        (chunks: string[]) => this.applyLengthLimit(chunks, opts)
      ];
      
      let compressed = fullText;
      
      // 1단계: 기본 정리
      compressed = compressionSteps[0]();
      if (compressed.length === 0) {
        throw new Error('텍스트 정리 후 내용이 비어있습니다.');
      }
      console.log(`1단계 (기본 정리) 완료: ${compressed.length.toLocaleString()}자`);
      
      // 2단계: 구조적 압축 (비동기 처리)
      try {
        const structured = compressionSteps[1](compressed);
        if (structured.length < compressed.length && structured.length > 0) {
          compressed = structured;
          console.log(`2단계 (구조적 압축) 완료: ${compressed.length.toLocaleString()}자`);
        }
      } catch (error) {
        console.warn('구조적 압축 중 오류 발생, 기본 정리 결과 사용:', error);
      }
      
      // 3단계: 청크 분할 및 선택 (최적화된 처리)
      try {
        const chunks = compressionSteps[2](compressed);
        if (chunks.length > 0) {
          compressed = chunks.join('\n\n---\n\n');
          console.log(`3단계 (청크 선택) 완료: ${compressed.length.toLocaleString()}자`);
        }
      } catch (error) {
        console.warn('청크 선택 중 오류 발생, 원본 텍스트 사용:', error);
        compressed = fullText; // 폴백
      }
      
      // 4단계: 최종 길이 제한 (필요시에만)
      const maxLength = this.tokensToCharacters(opts.maxTokens);
      if (compressed.length > maxLength) {
        try {
          const finalChunks = compressionSteps[3](compressed.split('\n\n---\n\n'));
          if (finalChunks.length > 0) {
            compressed = finalChunks.join('\n\n---\n\n');
            console.log(`4단계 (길이 제한) 완료: ${compressed.length.toLocaleString()}자`);
          }
        } catch (error) {
          console.warn('길이 제한 중 오류 발생, 현재 결과 유지:', error);
        }
      }
      
      // 최종 검증
      if (compressed.length === 0) {
        throw new Error('압축 결과가 비어있습니다.');
      }
      
      // 품질 검증 (비동기)
      const [qualityScore, estimatedTokens] = await Promise.all([
        Promise.resolve(this.calculateQualityScore(fullText, compressed, opts.preserveKeywords)),
        Promise.resolve(this.estimateTokens(compressed))
      ]);
      
      const result: CompressionResult = {
        compressedText: compressed,
        originalLength: fullText.length,
        compressedLength: compressed.length,
        compressionRatio: compressed.length / fullText.length,
        estimatedTokens,
        qualityScore
      };
      
      console.log(`압축 완료: ${(result.compressionRatio * 100).toFixed(1)}% 압축, ${estimatedTokens.toLocaleString()} 토큰, 품질 점수: ${qualityScore.toFixed(2)}`);
      
      return result;
      
    } catch (error) {
      console.error('PDF 압축 중 오류 발생:', error);
      
      // 최소한의 결과라도 반환
      return this.createFallbackResult(fullText, error as Error);
    }
  }

  /**
   * 청크 처리 (최적화된 버전)
   */
  private processChunks(text: string, opts: CompressionOptions): string[] {
    const chunks = this.splitIntoMeaningfulChunks(text, opts.maxChunkSize);
    if (chunks.length === 0) {
      throw new Error('청크 분할 결과가 비어있습니다.');
    }
    
    const selectedChunks = this.selectImportantChunks(chunks, opts.preserveKeywords, opts.maxChunks);
    if (selectedChunks.length === 0) {
      console.warn('선택된 청크가 없습니다. 원본 텍스트를 사용합니다.');
      return [text];
    }
    
    return selectedChunks;
  }

  /**
   * 길이 제한 적용 (최적화된 버전)
   */
  private applyLengthLimit(chunks: string[], opts: CompressionOptions): string[] {
    const maxLength = this.tokensToCharacters(opts.maxTokens);
    const currentLength = chunks.join('\n\n---\n\n').length;
    
    if (currentLength <= maxLength) {
      return chunks;
    }
    
    const finalChunks = this.splitIntoMeaningfulChunks(
      chunks.join('\n\n---\n\n'), 
      opts.minChunkSize
    );
    
    return this.selectImportantChunks(
      finalChunks, 
      opts.preserveKeywords, 
      Math.floor(opts.maxChunks * 0.7)
    );
  }

  /**
   * 최소한의 결과 생성 (짧은 텍스트용)
   */
  private createMinimalResult(text: string): CompressionResult {
    return {
      compressedText: text,
      originalLength: text.length,
      compressedLength: text.length,
      compressionRatio: 1.0,
      estimatedTokens: this.estimateTokens(text),
      qualityScore: 100
    };
  }

  /**
   * 폴백 결과 생성 (오류 발생시)
   */
  private createFallbackResult(text: string, error: Error): CompressionResult {
    // 원본 텍스트를 최대 길이로 제한
    const maxLength = this.tokensToCharacters(200000);
    const fallbackText = text.length > maxLength ? text.substring(0, maxLength) : text;
    
    return {
      compressedText: fallbackText,
      originalLength: text.length,
      compressedLength: fallbackText.length,
      compressionRatio: fallbackText.length / text.length,
      estimatedTokens: this.estimateTokens(fallbackText),
      qualityScore: 50 // 낮은 품질 점수
    };
  }

  /**
   * PDF 텍스트 기본 정리
   */
  private cleanPdfText(text: string): string {
    return text
      // 1. 페이지 번호 제거 (단독 페이지 번호만, [PAGE_X] 주석은 보존)
      .replace(/^\s*\d+\s*$/gm, '')
      // 2. 헤더/푸터 제거 (반복되는 패턴)
      .replace(/^.*(페이지|Page|page)\s*\d+.*$/gm, '')
      .replace(/^.*\d+\s*\/\s*\d+.*$/gm, '')
      // 3. 특수 문자 정리 (한글, 영문, 숫자, 기본 문장부호만 유지, [PAGE_X] 주석은 보존)
      .replace(/[^\w\s가-힣.,;:!?()[\]{}'"-]/g, ' ')
      // 4. 연속된 공백 정리
      .replace(/\s+/g, ' ')
      // 5. 짧은 단어 제거 (1-2글자 단어 중 불필요한 것들)
      .replace(/\b(그|이|저|것|수|등|및|또|또한|그리고|하지만|그러나|따라서|그런데|그러므로)\b/g, '')
      // 6. 빈 라인 정리
      .replace(/\n\s*\n/g, '\n')
      .trim();
  }

  /**
   * 중요 섹션 추출
   */
  private extractImportantSections(text: string, keywords: string[]): string {
    const sections = text.split(/\n\s*제\d+[장조항]|\n\s*[가-힣]{2,}.*규정|\n\s*[가-힣]{2,}.*지침|\n\s*[가-힣]{2,}.*업무/g);
    
    const importantSections = sections.filter(section => {
      if (section.trim().length < 100) return false;
      
      // 키워드 매칭 점수 계산
      let score = 0;
      keywords.forEach(keyword => {
        const matches = (section.match(new RegExp(keyword, 'gi')) || []).length;
        score += matches * 2;
      });
      
      // 길이 점수
      if (section.length > 500 && section.length < 5000) {
        score += 1;
      }
      
      return score > 0;
    });
    
    return importantSections.join('\n\n---\n\n');
  }

  /**
   * 의미 있는 청크로 분할
   */
  private splitIntoMeaningfulChunks(text: string, maxChunkSize: number): string[] {
    const chunks = [];
    const sentences = text.split(/[.!?]\s+/);
    
    let currentChunk = '';
    
    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (!trimmedSentence) continue;
      
      if (currentChunk.length + trimmedSentence.length > maxChunkSize && currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = trimmedSentence;
      } else {
        currentChunk += (currentChunk ? '. ' : '') + trimmedSentence;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }

  /**
   * 중요도 기반 청크 선택 (개선된 알고리즘)
   */
  private selectImportantChunks(
    chunks: string[], 
    keywords: string[], 
    maxChunks: number
  ): string[] {
    const scoredChunks = chunks.map(chunk => {
      let score = 0;
      
      // 1. 키워드 기반 점수 (가중치 적용)
      const keywordWeights = this.calculateKeywordWeights(keywords);
      keywords.forEach(keyword => {
        const matches = (chunk.match(new RegExp(keyword, 'gi')) || []).length;
        const weight = keywordWeights[keyword] || 1;
        score += matches * weight * 3;
      });
      
      // 2. 길이 점수 (적절한 길이의 청크에 높은 점수)
      if (chunk.length > 500 && chunk.length < 3000) {
        score += 3; // 이상적인 길이
      } else if (chunk.length > 200 && chunk.length < 5000) {
        score += 2; // 양호한 길이
      } else if (chunk.length > 100 && chunk.length < 8000) {
        score += 1; // 허용 가능한 길이
      }
      
      // 3. 구조적 요소 점수
      if (chunk.includes('제') && chunk.includes('조')) {
        score += 4; // 법조문 (매우 중요)
      }
      if (chunk.includes('규정') || chunk.includes('지침') || chunk.includes('업무')) {
        score += 2; // 규정 관련
      }
      if (chunk.includes('시행령') || chunk.includes('시행규칙')) {
        score += 3; // 시행령/규칙
      }
      
      // 4. 표나 목록 포함 점수
      if (chunk.includes('|') || chunk.includes('•') || chunk.includes('·')) {
        score += 2; // 구조화된 정보
      }
      
      // 5. 문장 완성도 점수
      const sentenceEndings = (chunk.match(/[.!?]/g) || []).length;
      if (sentenceEndings > 0) {
        score += Math.min(2, sentenceEndings); // 완성된 문장들
      }
      
      // 6. 숫자/날짜 포함 점수 (구체적인 정보)
      const numberMatches = (chunk.match(/\d+/g) || []).length;
      if (numberMatches > 0) {
        score += Math.min(2, numberMatches * 0.5);
      }
      
      // 7. 질문/답변 패턴 점수
      if (chunk.includes('?') || chunk.includes('어떻게') || chunk.includes('무엇') || chunk.includes('언제')) {
        score += 1; // 질문 관련 내용
      }
      
      // 8. 부정 점수 (너무 짧거나 의미 없는 청크)
      if (chunk.length < 50) {
        score -= 5; // 너무 짧은 청크
      }
      if (chunk.match(/^[^가-힣]*$/)) {
        score -= 3; // 한글이 없는 청크
      }
      
      return { chunk, score: Math.max(0, score) };
    });
    
    // 점수 순으로 정렬하고 상위 청크 선택
    const selectedChunks = scoredChunks
      .sort((a, b) => b.score - a.score)
      .slice(0, maxChunks)
      .map(item => item.chunk);
    
    // 선택된 청크들의 품질을 한 번 더 검증
    return this.validateSelectedChunks(selectedChunks, keywords);
  }

  /**
   * 키워드 가중치 계산
   */
  private calculateKeywordWeights(keywords: string[]): Record<string, number> {
    const weights: Record<string, number> = {};
    
    // 핵심 키워드 (높은 가중치)
    const coreKeywords = ['금연', '금연구역', '건강증진', '시행령', '시행규칙'];
    coreKeywords.forEach(keyword => {
      if (keywords.includes(keyword)) {
        weights[keyword] = 3;
      }
    });
    
    // 중요 키워드 (중간 가중치)
    const importantKeywords = ['지정', '관리', '업무', '지침', '서비스', '통합', '사업', '지원'];
    importantKeywords.forEach(keyword => {
      if (keywords.includes(keyword)) {
        weights[keyword] = 2;
      }
    });
    
    // 일반 키워드 (기본 가중치)
    keywords.forEach(keyword => {
      if (!weights[keyword]) {
        weights[keyword] = 1;
      }
    });
    
    return weights;
  }

  /**
   * 선택된 청크들의 품질 검증
   */
  private validateSelectedChunks(chunks: string[], keywords: string[]): string[] {
    // 최소한의 키워드 커버리지 확인
    const keywordCoverage = new Set<string>();
    chunks.forEach(chunk => {
      keywords.forEach(keyword => {
        if (chunk.includes(keyword)) {
          keywordCoverage.add(keyword);
        }
      });
    });
    
    // 키워드 커버리지가 너무 낮으면 추가 청크 선택
    if (keywordCoverage.size < keywords.length * 0.3) {
      console.warn('키워드 커버리지가 낮습니다. 추가 청크를 선택합니다.');
      // 여기서 추가 로직을 구현할 수 있음
    }
    
    return chunks;
  }

  /**
   * 품질 점수 계산
   */
  private calculateQualityScore(
    original: string, 
    compressed: string, 
    keywords: string[]
  ): number {
    let score = 0;
    const maxScore = 100;
    
    // 압축률 점수 (적절한 압축률에 높은 점수)
    const compressionRatio = compressed.length / original.length;
    if (compressionRatio > 0.1 && compressionRatio < 0.5) {
      score += 30; // 10-50% 압축률이 이상적
    } else if (compressionRatio > 0.05 && compressionRatio < 0.8) {
      score += 20; // 5-80% 압축률도 양호
    } else {
      score += 10; // 그 외
    }
    
    // 키워드 보존 점수
    const originalKeywordCount = keywords.reduce((count, keyword) => {
      return count + (original.match(new RegExp(keyword, 'gi')) || []).length;
    }, 0);
    
    const compressedKeywordCount = keywords.reduce((count, keyword) => {
      return count + (compressed.match(new RegExp(keyword, 'gi')) || []).length;
    }, 0);
    
    if (originalKeywordCount > 0) {
      const keywordPreservationRatio = compressedKeywordCount / originalKeywordCount;
      score += Math.min(40, keywordPreservationRatio * 40);
    }
    
    // 구조적 요소 보존 점수
    const structuralElements = ['제', '조', '항', '목', '규정', '지침', '업무'];
    const originalStructuralCount = structuralElements.reduce((count, element) => {
      return count + (original.match(new RegExp(element, 'gi')) || []).length;
    }, 0);
    
    const compressedStructuralCount = structuralElements.reduce((count, element) => {
      return count + (compressed.match(new RegExp(element, 'gi')) || []).length;
    }, 0);
    
    if (originalStructuralCount > 0) {
      const structuralPreservationRatio = compressedStructuralCount / originalStructuralCount;
      score += Math.min(30, structuralPreservationRatio * 30);
    }
    
    return Math.min(maxScore, score);
  }

  /**
   * 토큰 수 추정
   */
  private estimateTokens(text: string): number {
    // 대략적인 토큰 계산 (1토큰 ≈ 4자)
    return Math.ceil(text.length / 4);
  }

  /**
   * 토큰 수를 문자 수로 변환
   */
  private tokensToCharacters(tokens: number): number {
    return tokens * 4;
  }

  /**
   * 전체 PDF를 청크로 분할하여 반환
   */
  splitIntoChunks(fullText: string, sourceTitle: string = 'PDF Document'): Chunk[] {
    const chunks: Chunk[] = [];
    const chunkSize = 2000; // 2000자 단위로 분할
    const overlap = 200; // 200자 오버랩

    let startPos = 0;
    let chunkIndex = 0;

    while (startPos < fullText.length) {
      const endPos = Math.min(startPos + chunkSize, fullText.length);
      let chunkContent = fullText.substring(startPos, endPos);

      // 문장 경계에서 자르기
      if (endPos < fullText.length) {
        const lastSentenceEnd = chunkContent.lastIndexOf('.');
        if (lastSentenceEnd > chunkSize * 0.7) { // 70% 이상이면 문장 경계에서 자르기
          chunkContent = chunkContent.substring(0, lastSentenceEnd + 1);
        }
      }

      // 청크 생성
      const chunk: Chunk = {
        id: `chunk_${chunkIndex}`,
        content: chunkContent.trim(),
        metadata: {
          source: sourceTitle,
          title: sourceTitle,
          chunkIndex,
          startPosition: startPos,
          endPosition: startPos + chunkContent.length
        },
        keywords: this.extractChunkKeywords(chunkContent),
        location: {
          document: sourceTitle,
          section: this.extractSection(chunkContent),
          subsection: this.extractSubsection(chunkContent)
        }
      };

      chunks.push(chunk);
      chunkIndex++;

      // 다음 청크 시작 위치 (오버랩 고려)
      startPos += chunkContent.length - overlap;
    }

    console.log(`PDF를 ${chunks.length}개 청크로 분할 완료`);
    return chunks;
  }

  /**
   * 청크에서 키워드 추출
   */
  private extractChunkKeywords(content: string): string[] {
    const keywords = [
      '금연', '금연구역', '건강증진', '시행령', '시행규칙', '지정', '관리', '업무', '지침',
      '서비스', '통합', '사업', '지원', '규정', '법률', '조항', '항목', '절차', '방법',
      '기준', '요건', '조건', '제한', '신고', '신청', '처리', '심사', '승인', '허가',
      '등록', '변경', '취소', '정지', '폐지', '해제', '위반', '과태료', '벌금', '처벌',
      '제재', '조치', '시설', '장소', '구역', '지역', '범위', '대상', '기관', '단체',
      '조직', '협회', '연합', '연합회', '담당', '책임', '의무', '권한', '기능', '역할'
    ];

    return keywords.filter(keyword => 
      content.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  /**
   * 섹션 추출
   */
  private extractSection(content: string): string | undefined {
    const sectionPatterns = [
      /제\d+장\s*([^\.\n]+)/g,
      /제\d+절\s*([^\.\n]+)/g,
      /([가-힣]{2,})\s*규정/g,
      /([가-힣]{2,})\s*지침/g
    ];

    for (const pattern of sectionPatterns) {
      const match = content.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }

    return undefined;
  }

  /**
   * 하위 섹션 추출
   */
  private extractSubsection(content: string): string | undefined {
    const subsectionPatterns = [
      /제\d+조\s*([^\.\n]+)/g,
      /제\d+항\s*([^\.\n]+)/g,
      /\([가-힣]+\)\s*([^\.\n]+)/g
    ];

    for (const pattern of subsectionPatterns) {
      const match = content.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }

    return undefined;
  }

  /**
   * 질문과 청크의 관련도 기반으로 청크 선택
   */
  selectChunksByRelevance(
    chunks: Chunk[], 
    questionKeywords: string[], 
    maxTokens: number = 100000 // 토큰 제한 증가
  ): Chunk[] {
    const scoredChunks = chunks.map(chunk => ({
      chunk,
      score: this.calculateChunkRelevanceScore(chunk, questionKeywords)
    }));

    // 점수 순으로 정렬
    scoredChunks.sort((a, b) => b.score - a.score);

    // 토큰 제한 내에서 선택
    const selectedChunks: Chunk[] = [];
    let totalTokens = 0;

    for (const { chunk } of scoredChunks) {
      const chunkTokens = this.estimateTokens(chunk.content);
      
      if (totalTokens + chunkTokens <= maxTokens) {
        selectedChunks.push({
          ...chunk,
          relevanceScore: this.calculateChunkRelevanceScore(chunk, questionKeywords)
        });
        totalTokens += chunkTokens;
      } else {
        break;
      }
    }

    console.log(`관련도 기반 청크 선택: ${selectedChunks.length}개, 예상 토큰: ${totalTokens.toLocaleString()}개`);
    return selectedChunks;
  }

  /**
   * 청크와 질문 키워드의 관련도 점수 계산
   */
  private calculateChunkRelevanceScore(chunk: Chunk, questionKeywords: string[]): number {
    let score = 0;

    // 1. 키워드 매칭 점수
    const keywordMatches = questionKeywords.filter(keyword =>
      chunk.content.toLowerCase().includes(keyword.toLowerCase())
    ).length;
    score += keywordMatches * 10;

    // 2. 청크 내 키워드와 질문 키워드의 교집합
    const chunkKeywords = chunk.keywords;
    const commonKeywords = questionKeywords.filter(keyword =>
      chunkKeywords.some(chunkKeyword => 
        chunkKeyword.toLowerCase().includes(keyword.toLowerCase()) ||
        keyword.toLowerCase().includes(chunkKeyword.toLowerCase())
      )
    ).length;
    score += commonKeywords * 15;

    // 3. 청크 품질 점수
    const qualityScore = this.calculateChunkQuality(chunk);
    score += qualityScore;

    // 4. 위치 가중치
    const positionWeight = this.calculatePositionWeight(chunk, chunks.length);
    score *= positionWeight;

    return Math.max(0, score);
  }

  /**
   * 청크 품질 점수 계산
   */
  private calculateChunkQuality(chunk: Chunk): number {
    let quality = 0;

    // 길이 점수
    if (chunk.content.length > 500 && chunk.content.length < 3000) {
      quality += 5;
    } else if (chunk.content.length > 200 && chunk.content.length < 5000) {
      quality += 3;
    }

    // 구조적 요소 점수
    if (chunk.content.includes('제') && chunk.content.includes('조')) {
      quality += 3; // 법조문
    }
    if (chunk.content.includes('규정') || chunk.content.includes('지침')) {
      quality += 2; // 규정 관련
    }

    // 문장 완성도
    const sentenceCount = (chunk.content.match(/[.!?]/g) || []).length;
    if (sentenceCount > 0) {
      quality += Math.min(2, sentenceCount);
    }

    return quality;
  }

  /**
   * 위치 가중치 계산
   */
  private calculatePositionWeight(chunk: Chunk, totalChunks: number): number {
    const position = chunk.metadata.chunkIndex / totalChunks;
    return 1.2 - (position * 0.4); // 1.2에서 0.8까지 감소
  }

  /**
   * 압축 결과 검증
   */
  validateCompression(result: CompressionResult): {
    isValid: boolean;
    warnings: string[];
    recommendations: string[];
  } {
    const warnings: string[] = [];
    const recommendations: string[] = [];
    
    // 토큰 수 검증
    if (result.estimatedTokens > 2500) {
      warnings.push(`토큰 수가 많습니다: ${result.estimatedTokens.toLocaleString()}개`);
      recommendations.push('더 많은 청크를 제거하거나 압축률을 높이세요.');
    }
    
    // 압축률 검증
    if (result.compressionRatio < 0.05) {
      warnings.push(`압축률이 너무 높습니다: ${(result.compressionRatio * 100).toFixed(1)}%`);
      recommendations.push('중요한 정보가 손실될 수 있습니다. 압축률을 조정하세요.');
    }
    
    if (result.compressionRatio > 0.8) {
      warnings.push(`압축률이 낮습니다: ${(result.compressionRatio * 100).toFixed(1)}%`);
      recommendations.push('더 많은 압축이 가능합니다.');
    }
    
    // 품질 점수 검증
    if (result.qualityScore < 60) {
      warnings.push(`품질 점수가 낮습니다: ${result.qualityScore.toFixed(1)}점`);
      recommendations.push('키워드 보존을 개선하거나 압축 전략을 조정하세요.');
    }
    
    return {
      isValid: warnings.length === 0,
      warnings,
      recommendations
    };
  }

  /**
   * 간단한 텍스트 압축 (Firestore용)
   */
  async compressText(text: string): Promise<string> {
    try {
      const result = await this.compressPdfContent(text);
      return result.compressedText;
    } catch (error) {
      console.error('텍스트 압축 실패:', error);
      // 폴백: 원본 텍스트를 최대 길이로 제한
      const maxLength = 10000; // 1만자 제한 (GitHub Pages 수준)
      return text.length > maxLength ? text.substring(0, maxLength) : text;
    }
  }
}

// 싱글톤 인스턴스
export const pdfCompressionService = new PDFCompressionService();
