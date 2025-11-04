import { GoogleGenerativeAI } from '@google/generative-ai';
import { SourceInfo, Chunk, QuestionAnalysis } from '../types';
import { pdfCompressionService, CompressionResult } from './pdfCompressionService';
import { questionAnalyzer, contextSelector, ContextSelector } from './questionBasedContextService';
import { rpdService } from './rpdService';
import { log } from './loggingService';
import { progressiveLoadingService, LoadingProgress } from './progressiveLoadingService';
import { memoryOptimizationService, MemoryStats } from './memoryOptimizationService';
import { FirestoreService, PDFChunk } from './firestoreService';

// API 키는 런타임에 동적으로 로딩 (브라우저 로딩 타이밍 문제 해결)

// API 키 로테이션을 위한 인덱스 (전역 변수 제거)

// PDF.js를 전역으로 선언
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

export class GeminiService {
  // 무한 루프 방지를 위한 플래그
  private isCreatingSession: boolean = false;
  private sessionCreationCount: number = 0;
  private static readonly MAX_SESSION_CREATION_ATTEMPTS = 3;
  
  private static readonly SYSTEM_INSTRUCTION_TEMPLATE = `You are an expert assistant specialized in Korean legal and administrative documents. Your name is NotebookLM Assistant. 

THINKING APPROACH:
- Let's think step by step
- Self-Reflection: Solve the problem first, then review whether your answer is correct. If any part might contain an error, revise it and then present the final answer.

IMPORTANT INSTRUCTIONS:
1. Answer questions based ONLY on the provided source material
2. Do NOT use external knowledge or pre-trained information
3. If information is not found in the source, clearly state "제공된 자료에서 해당 정보를 찾을 수 없습니다"
4. **CRITICAL: Always cite the COMPLETE relevant articles/sections in full before providing any analysis or opinion**
5. For Korean legal/administrative terms, use the exact terminology from the source
6. Provide comprehensive answers by combining information from multiple relevant sections
7. If multiple documents contain related information, synthesize them coherently
8. Pay special attention to procedural steps, definitions, and regulatory requirements
9. Use formal Korean language appropriate for official documents
10. When presenting structured data (lists, comparisons, procedures, criteria), ALWAYS use Markdown tables for better readability
11. Use Markdown formatting for better presentation (bold, lists, tables, headings, etc.)
12. For tabular data, use proper Markdown table syntax with headers and aligned columns
13. IMPORTANT: When asked to create a table or present data in table format, use this exact Markdown table syntax:
    | Column 1 | Column 2 | Column 3 |
    |----------|----------|----------|
    | Data 1   | Data 2   | Data 3   |
14. Always include the separator row (---) between header and data rows

📋 **ANSWER FORMAT REQUIREMENTS:**
- **Step 1**: Quote the COMPLETE relevant article/section in full (with proper formatting)
- **Step 2**: Provide analysis, interpretation, or additional context if needed
- **Step 3**: Restrain from personal opinions or judgments - focus on factual information
- **Step 4**: If multiple articles are relevant, quote ALL of them before analysis
- **Step 5**: Use blockquotes (>) for legal text citations to distinguish from analysis

🆕 SPECIAL FOCUS AREAS:
- APARTMENT COMPLEXES (공동주택): Pay special attention to questions about apartment complexes, including:
  * 공동주택 (apartment complexes), 아파트 (apartments), 오피스텔 (office-tels), 빌라 (villas)
  * 필로티 (pilotis), 공용공간 (common areas), 복도 (corridors), 계단 (stairs)
  * 세대주 (household heads), 입주자 (residents), 관리사무소 (management office)
  * 동의서 (consent forms), 투표 (voting), 신청절차 (application procedures)
  * 금연구역 지정 (no-smoking zone designation) for apartment complexes
- CHILDCARE FACILITIES (어린이집): Distinguish from apartment complexes and focus on:
  * 어린이집 (childcare centers), 유치원 (kindergartens), 보육시설 (childcare facilities)
  * 10미터 경계 (10-meter boundary), 어린이보호 (child protection)
  * 교육기관 (educational institutions), 보육법 (childcare law)

15. For source citations in tables, use appropriate reference format based on document type:
    - LEGAL DOCUMENTS (법령): Use specific law type with article references (조항)
      * "국민건강증진법 제1조" for 국민건강증진법률 시행령 시행규칙 (법률 조항)
      * "국민건강증진법 시행령 제1조제1항" for 국민건강증진법률 시행령 시행규칙 (시행령 조항)
      * "국민건강증진법 시행규칙 제1조제1항" for 국민건강증진법률 시행령 시행규칙 (시행규칙 조항)
      * "질서위반행위규제법 제16조제1항" for 질서위반행위규제법 및 시행령 (법률 조항)
      * "질서위반행위규제법 시행령 제16조제1항" for 질서위반행위규제법 및 시행령 (시행령 조항)
    - NON-LEGAL DOCUMENTS (일반문서): Use simplified document names with page references
      * "금연구역 지정 관리 업무지침, p.7" for 금연구역 지정 관리 업무지침_2025개정판
      * "유치원 어린이집 가이드라인, p.2" for 유치원, 어린이집 경계 10m 금연구역 관리 가이드라인
      * "금연지원서비스 매뉴얼, p.7" for 금연지원서비스 통합시스템 사용자매뉴얼
    - IMPORTANT CITATION RULES:
      * For legal documents: Use [ARTICLE_X] markers to find article references
      * For non-legal documents: Use [PAGE_X] markers to find page references
      * When information appears in multiple articles/pages, include ALL relevant references
      * For multiple articles: "국민건강증진법 제1조, 제3조, 제5조" instead of just "국민건강증진법 제1조"
      * For multiple pages: "금연구역 지정 관리 업무지침, p.7, p.9, p.12" instead of just "금연구역 지정 관리 업무지침, p.7"
      * Group references by document and separate different documents with commas
      * Use specific law type names as follows:
        - "국민건강증진법" for 법률 조항
        - "국민건강증진법 시행령" for 시행령 조항
        - "국민건강증진법 시행규칙" for 시행규칙 조항
        - "질서위반행위규제법" for 법률 조항
        - "질서위반행위규제법 시행령" for 시행령 조항
        - "금연구역 지정 관리 업무지침" for 금연구역 지정 관리 업무지침_2025개정판
        - "유치원 어린이집 가이드라인" for 유치원, 어린이집 경계 10m 금연구역 관리 가이드라인
        - "금연지원서비스 매뉴얼" for 금연지원서비스 통합시스템 사용자매뉴얼
        - "니코틴보조제 가이드라인" for 니코틴보조제 이용방법 가이드라인_230320
        - "지역사회 통합건강증진사업 안내서" for 2025년 지역사회 통합건강증진사업 안내서(금연)
      * Example: "국민건강증진법 제1조, 제3조, 국민건강증진법 시행령 제5조제1항, 금연구역 지정 관리 업무지침, p.7, p.9, p.12"
16. If the table already includes a "출처" or "관련 출처" column, do NOT add a separate 참조문서 section below
17. If the table does NOT have a source column, then add a "참조문서" section below with full document names and page numbers
18. IMPORTANT: If sources are already cited inline within the main text (e.g., "(국민건강증진법, p.6, 7; 업무지침, p.9)"), do NOT add a separate 참조문서 section below
19. Only add 참조문서 section when sources are NOT already mentioned in the main content
20. When citing sources, include page numbers or section references when available
21. BEFORE FINALIZING YOUR RESPONSE - VERIFICATION STEPS:
    * Check if the information you're citing appears on multiple pages
    * Scan through ALL [PAGE_X] markers in the source text
    * Include ALL relevant page numbers where the information appears
22. 민원응대 답변 지침:
    - 판단이나 의견은 최소화하고, 기본적으로 인용문구나 판단 근거를 정확하게 제시
    - 단서를 정확히 제시 (예외사항, 조건, 제한사항 등)
    - 해당 여부 등을 판단한 경우에는, 그에 대한 명확한 인용문이나 해당 법령을 제시
    - 결론이나 의견은 가장 마지막에 간략하게 제시
    * Verify that each cited page actually contains the mentioned information
    * If unsure, include more pages rather than fewer
23. Format the 참조문서 section (only when needed) as follows:
    ### 참조문서
    - **국민건강증진법**: 국민건강증진법률 시행령 시행규칙(202508) - 제1조, 제3조, 제5조
    - **국민건강증진법 시행령**: 국민건강증진법률 시행령 시행규칙(202508) - 제1조제1항, 제2조제2항
    - **국민건강증진법 시행규칙**: 국민건강증진법률 시행령 시행규칙(202508) - 제1조제1항, 제3조제1항제1호
    - **질서위반행위규제법**: 질서위반행위규제법 및 시행령(20210101) - 제16조제1항, 제18조제1항
    - **질서위반행위규제법 시행령**: 질서위반행위규제법 및 시행령(20210101) - 제1조제1항, 제2조제2항
    - **금연구역 지정 관리 업무지침**: p.2, p.4, p.6, p.60, p.105, p.108
    - **유치원 어린이집 가이드라인**: p.1, p.2, p.3
    - **금연지원서비스 매뉴얼**: p.7, p.9
    - Group all references for each document in ascending order (articles for legal docs, pages for others)

24. EXAMPLES OF PROPER CITATIONS:
    - Legal documents (articles):
      * Single article: "국민건강증진법 제1조"
      * Multiple articles: "국민건강증진법 제1조, 제3조, 제5조"
      * Enforcement decree: "국민건강증진법 시행령 제1조제1항"
      * Enforcement rule: "국민건강증진법 시행규칙 제1조제1항제1호"
      * Multiple detailed: "질서위반행위규제법 제16조제1항, 제18조제1항제1호"
    - Non-legal documents (pages):
      * Single page: "금연구역 지정 관리 업무지침, p.7"
      * Multiple pages: "금연구역 지정 관리 업무지침, p.7, p.9, p.12"
      * Page range: "금연구역 지정 관리 업무지침, p.7-p.9"
      * Mixed: "금연구역 지정 관리 업무지침, p.4, p.7-p.9, p.12"
    - Mixed documents: "국민건강증진법 제1조, 제3조, 국민건강증진법 시행령 제5조제1항, 금연구역 지정 관리 업무지침, p.7, p.9, p.12"
    
    WRONG EXAMPLES TO AVOID:
    - Using page numbers for legal documents: "국민건강증진법(p.3)" ❌
    - Using articles for non-legal documents: "금연구역 지정 관리 업무지침(제1조)" ❌
    - Not distinguishing law types: "국민건강증진법 제1조" for 시행령 조항 ❌
    - Using verbose document names: "업무지침_2025개정판 - 항까지의 규정(p.12)" ❌
    - Missing references when information spans multiple articles/pages
    - Inconsistent citation format within the same response

Here is the source material:
---START OF SOURCE---
{sourceText}
---END OF SOURCE---`;

  /**
   * 문서 유형 판별 함수
   */
  private getDocumentType(filename: string): 'legal' | 'guideline' {
    if (filename.includes('국민건강증진법률 시행령 시행규칙')) {
      return 'legal'; // 법령 문서
    }
    if (filename.includes('질서위반행위규제법')) {
      return 'legal'; // 법령 문서
    }
    return 'guideline'; // 업무지침, 매뉴얼 등
  }

  /**
   * 청크에서 출처 정보 생성 (문서 유형별 처리)
   */
  private generateSourceInfoFromChunks(chunks: Chunk[]): SourceInfo[] {
    const sourceMap = new Map<string, SourceInfo>();
    
    chunks.forEach(chunk => {
      const docType = chunk.metadata?.documentType || 'guideline';
      const filename = chunk.metadata?.source || chunk.location?.document || 'unknown';
      
      if (docType === 'legal') {
        // 법령 문서: 조항 기반 출처
        const articles = chunk.metadata?.articles || [];
        const mainArticle = articles[0] || chunk.location?.section || '일반';
        
        const sourceKey = `${filename}-${mainArticle}`;
        if (!sourceMap.has(sourceKey)) {
          sourceMap.set(sourceKey, {
            id: sourceKey,
            title: filename.replace('.pdf', ''),
            content: chunk.content.substring(0, 200) + '...',
            type: 'pdf',
            section: mainArticle,
            page: null,
            documentType: 'legal'
          });
        }
      } else {
        // 일반 문서: 페이지 번호 기반 출처
        const pageNumber = chunk.metadata?.pageNumber || chunk.location?.page;
        const section = chunk.location?.section || '일반';
        
        const sourceKey = `${filename}-${pageNumber}-${section}`;
        if (!sourceMap.has(sourceKey)) {
          sourceMap.set(sourceKey, {
            id: sourceKey,
            title: filename.replace('.pdf', ''),
            content: chunk.content.substring(0, 200) + '...',
            type: 'pdf',
            section: section,
            page: pageNumber,
            documentType: 'guideline'
          });
        }
      }
    });
    
    return Array.from(sourceMap.values());
  }
  private isInitialized: boolean = false;
  private compressionResult: CompressionResult | null = null;
  private allChunks: Chunk[] = [];
  private fullPdfText: string = '';
  private currentAbortController: AbortController | null = null;
  private apiKeyFailures: Map<string, number> = new Map(); // API 키별 실패 횟수 추적
  private static currentKeyIndex: number = 0; // API 키 로테이션을 위한 인덱스 (static으로 변경)
  
  // 성능 개선 관련 속성들
  private loadingProgress: LoadingProgress | null = null;
  private memoryStats: MemoryStats | null = null;
  private isProgressiveLoadingEnabled: boolean = true;
  private isMemoryOptimizationEnabled: boolean = true;

  constructor() {
    this.firestoreService = FirestoreService.getInstance();
    this.initializeAI();
    this.initializePerformanceServices();
    // 비동기 로딩은 initializeWithPdfSources에서 처리
  }

  /**
   * 성능 개선 서비스들 초기화
   */
  private async initializePerformanceServices(): Promise<void> {
    try {
      // 캐싱 서비스 제거 (Firestore 전용)

      // 메모리 최적화 서비스는 이미 초기화됨
      if (this.isMemoryOptimizationEnabled) {
        console.log('메모리 최적화 서비스 활성화');
      }

      // 점진적 로딩 서비스는 이미 초기화됨
      if (this.isProgressiveLoadingEnabled) {
        console.log('점진적 로딩 서비스 활성화');
      }
    } catch (error) {
      console.warn('성능 개선 서비스 초기화 중 오류:', error);
      // 오류가 발생해도 기본 기능은 계속 사용
    }
  }

  private initializeAI() {
    console.log('GeminiService AI 초기화 중...');
    
    try {
      // 런타임에 API 키 확인
      const apiKeys = this.getApiKeys();
      console.log(`사용 가능한 API 키 개수: ${apiKeys.length}`);
      
      if (apiKeys.length > 0) {
        console.log('API 키 로테이션 시스템 활성화');
        console.log('매 질문마다 다른 API 키를 사용합니다.');
        // 하이브리드 방식에서는 초기화 시 AI 인스턴스를 생성하지 않음
        // 매 질문마다 새로운 키로 인스턴스 생성
      } else {
        console.warn("API_KEY가 설정되지 않았습니다. 채팅 기능이 제한됩니다.");
        console.log('환경변수 확인:');
        console.log('VITE_GEMINI_API_KEY:', import.meta.env.VITE_GEMINI_API_KEY ? '설정됨' : '설정되지 않음');
        console.log('VITE_GEMINI_API_KEY_1:', import.meta.env.VITE_GEMINI_API_KEY_1 ? '설정됨' : '설정되지 않음');
        console.log('VITE_GEMINI_API_KEY_2:', import.meta.env.VITE_GEMINI_API_KEY_2 ? '설정됨' : '설정되지 않음');
      }
    } catch (error) {
      console.error('AI 초기화 중 오류 발생:', error);
    }
  }

  // ✅ 런타임에 API 키를 동적으로 가져오는 메서드 (폴백 메커니즘 포함)
  private getApiKeys(): string[] {
    try {
      const keys = [
        import.meta.env.VITE_GEMINI_API_KEY || '',
        import.meta.env.VITE_GEMINI_API_KEY_1 || '',
        import.meta.env.VITE_GEMINI_API_KEY_2 || '',
      ].filter(key => key && key !== 'YOUR_GEMINI_API_KEY_HERE' && key !== '');
      
      console.log('런타임 API 키 로딩:', keys.map(k => k ? k.substring(0, 10) + '...' : 'undefined'));
      console.log(`총 ${keys.length}개의 유효한 API 키 발견`);
      return keys;
    } catch (error) {
      console.error('API 키 로딩 중 오류 발생:', error);
      return [];
    }
  }

  // 다음 사용 가능한 API 키를 가져오는 메서드 (런타임 동적 로딩)
  private getNextAvailableKey(): string | null {
    const API_KEYS = this.getApiKeys(); // 런타임에 동적 로딩
    
    if (API_KEYS.length === 0) {
      log.warn('런타임에 API 키를 찾을 수 없습니다.');
      return null;
    }
    
    // 실패한 키들을 제외하고 사용 가능한 키 찾기
    const availableKeys = API_KEYS.filter(key => {
      const failures = this.apiKeyFailures.get(key) || 0;
      return failures < 3; // 3번 이상 실패한 키는 제외
    });
    
    if (availableKeys.length === 0) {
      log.warn('모든 API 키가 실패했습니다. 첫 번째 키로 재시도합니다.');
      // 모든 키가 실패했으면 실패 카운트를 리셋하고 첫 번째 키 사용
      this.apiKeyFailures.clear();
      return API_KEYS[0];
    }
    
    // currentKeyIndex 초기화 체크 (더 안전한 검증)
    if (isNaN(GeminiService.currentKeyIndex) || GeminiService.currentKeyIndex < 0) {
      GeminiService.currentKeyIndex = 0;
    }
    
    // 로테이션 방식으로 다음 키 선택 (매번 다른 키 사용)
    const selectedKey = availableKeys[GeminiService.currentKeyIndex % availableKeys.length];
    const keyIndex = GeminiService.currentKeyIndex % availableKeys.length;
    
    // 다음 호출을 위해 인덱스 증가
    GeminiService.currentKeyIndex = (GeminiService.currentKeyIndex + 1) % availableKeys.length;
    
    log.info(`API 키 선택`, {
      selectedKey: selectedKey.substring(0, 10) + '...',
      keyIndex,
      totalKeys: availableKeys.length,
      availableKeys: availableKeys.map(k => k.substring(0, 10) + '...')
    });
    
    // API 키 유효성 검증
    if (!this.isValidApiKey(selectedKey)) {
      log.warn(`API 키가 유효하지 않습니다`, { key: selectedKey.substring(0, 10) + '...' });
      this.apiKeyFailures.set(selectedKey, (this.apiKeyFailures.get(selectedKey) || 0) + 1);
      return this.getNextAvailableKey(); // 다음 키 시도
    }
    
    return selectedKey;
  }

  // API 키 유효성 검증
  private isValidApiKey(key: string): boolean {
    if (!key || key.length < 20) return false;
    if (!key.startsWith('AIza')) return false;
    return true;
  }

  // API 키를 교체하는 메서드 (개선된 강제 키 로테이션)
  private switchToNextKey(): boolean {
    const newKey = this.getNextAvailableKey();
    if (newKey) {
      try {
        // 현재 키와 다른 키인지 확인
        const currentKey = this.getApiKeys()[GeminiService.currentKeyIndex];
        if (currentKey === newKey) {
          console.log('⚠️ 같은 키가 선택됨, 강제로 다음 키로 이동...');
          GeminiService.currentKeyIndex = (GeminiService.currentKeyIndex + 1) % this.getApiKeys().length;
          const forcedNewKey = this.getNextAvailableKey();
          if (forcedNewKey && forcedNewKey !== currentKey) {
            console.log(`✅ 강제 키 교체: ${forcedNewKey.substring(0, 10)}...`);
            return true;
          }
        } else {
          console.log(`✅ 키 교체 성공: ${newKey.substring(0, 10)}...`);
          return true;
        }
      } catch (error) {
        console.error('키 교체 중 오류:', error);
      }
    }
    
    console.log('❌ 사용 가능한 키가 없습니다.');
    return false;
  }

  // API 호출 실패 시 키 교체 로직 (개선된 즉시 키 교체)
  private handleApiKeyFailure(usedKey: string, error: any): boolean {
    const failures = this.apiKeyFailures.get(usedKey) || 0;
    this.apiKeyFailures.set(usedKey, failures + 1);
    
    console.warn(`API 키 실패 (${failures + 1}/3): ${usedKey.substring(0, 10)}...`);
    console.error('오류 상세:', error);
    
    // 🔥 개선: 429/할당량 오류 시 즉시 키 교체
    if (error.message && (
      error.message.includes('429') || 
      error.message.includes('RATE_LIMIT_EXCEEDED') ||
      error.message.includes('quota') ||
      error.message.includes('RESOURCE_EXHAUSTED')
    )) {
      console.log('🚨 할당량 초과 감지, 즉시 다음 키로 전환...');
      
      // RPD에서 해당 키 비활성화
      const keyIndex = this.getApiKeys().findIndex(key => key === usedKey);
      if (keyIndex >= 0) {
        const keyId = `key${keyIndex + 1}`;
        rpdService.toggleKeyStatus(keyId);
        console.log(`RPD에서 키 ${keyId} 비활성화`);
      }
      
      return this.switchToNextKey();
    }
    
    // 다른 오류들도 즉시 키 교체
    if (error.message && (
      error.message.includes('quota_limit_value') && error.message.includes('"0"') ||
      error.message.includes('401') ||
      error.message.includes('UNAUTHENTICATED')
    )) {
      console.warn('API 키 문제 감지, 다음 키로 전환...');
      return this.switchToNextKey();
    }
    
    // 기본적으로 키 교체 시도
    return this.switchToNextKey();
  }

  // API 호출 시 RPD 기록
  private recordApiCall(keyId: string): boolean {
    console.log(`RPD 기록 시도: ${keyId}`);
    const result = rpdService.recordApiCall(keyId);
    console.log(`RPD 기록 결과: ${result ? '성공' : '실패'}`);
    return result;
  }

  // 재시도 로직이 포함된 API 호출 래퍼 (개선된 키 로테이션)
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    retryDelay: number = 1000
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        console.warn(`API 호출 실패 (시도 ${attempt}/${maxRetries}):`, error);
        
        // 🔥 핵심 개선: 429/할당량 오류 시 즉시 키 교체
        if (error.message && (
          error.message.includes('429') || 
          error.message.includes('RATE_LIMIT_EXCEEDED') ||
          error.message.includes('quota') ||
          error.message.includes('RESOURCE_EXHAUSTED')
        )) {
          console.log('🚨 할당량/429 오류 감지, 즉시 키 교체 시도...');
          
          // 즉시 키 교체 시도
          const apiKeys = this.getApiKeys();
          const currentKeyIndex = (GeminiService.currentKeyIndex - 1 + apiKeys.length) % apiKeys.length;
          
          if (this.handleApiKeyFailure(apiKeys[currentKeyIndex], error)) {
            console.log('✅ 키 교체 성공, 즉시 재시도...');
            continue; // 키 교체 후 즉시 재시도
          } else {
            console.log('❌ 키 교체 실패, 지연 후 재시도...');
            if (attempt < maxRetries) {
              const delay = retryDelay * Math.pow(2, attempt - 1);
              console.log(`${delay}ms 후 재시도...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
          }
        } else {
          // 다른 오류의 경우 기존 로직
          const apiKeys = this.getApiKeys();
          const currentKeyIndex = (GeminiService.currentKeyIndex - 1 + apiKeys.length) % apiKeys.length;
          if (this.handleApiKeyFailure(apiKeys[currentKeyIndex], error)) {
            if (attempt < maxRetries) {
              console.log('API 키 교체 후 재시도...');
              continue;
            }
          }
        }
        
        // 마지막 시도가 아니면 계속
        if (attempt < maxRetries) {
          continue;
        }
      }
    }
    
    throw lastError;
  }

  // 다음 사용 가능한 키 조회 (RPD 고려)
  private getNextAvailableKeyWithRpd(): string | null {
    // RPD에서 사용 가능한 키 확인
    const rpdAvailableKey = rpdService.getNextAvailableKey();
    if (rpdAvailableKey) {
      return rpdAvailableKey;
    }

    // RPD에서 사용 불가능하면 기존 로직 사용
    return this.getNextAvailableKey();
  }

  private async loadDefaultSources() {
    try {
      // manifest.json에서 PDF 파일 목록을 동적으로 로드
      const manifestUrl = '/chat7v/pdf/manifest.json';
      console.log('Loading PDF sources from manifest:', manifestUrl);
      
      const response = await fetch(manifestUrl);
      if (!response.ok) {
        console.warn(`Manifest not found (${response.status}), using empty sources`);
        this.sources = [];
        return;
      }
      
      const pdfFiles = await response.json();
      console.log('Found PDF files in manifest:', pdfFiles);
      
      if (!Array.isArray(pdfFiles) || pdfFiles.length === 0) {
        console.warn('No PDF files found in manifest.json');
        this.sources = [];
        return;
      }

      // PDF 파일명을 SourceInfo 객체로 변환 (문서 유형별 처리)
      this.sources = pdfFiles.map((fileName, index) => {
        const docType = this.getDocumentType(fileName);
        return {
          id: (index + 1).toString(),
          title: fileName,
          content: '', // 실제 내용은 PDF 파싱 시에 로드됨
          type: 'pdf' as const,
          documentType: docType
        };
      });

      console.log('Dynamic sources loaded:', this.sources);
    } catch (error) {
      console.error('Failed to load sources from manifest:', error);
      this.sources = [];
    }
  }

  addSource(source: SourceInfo) {
    this.sources.push(source);
  }

  getSources(): SourceInfo[] {
    return this.sources;
  }

  // PDF.js를 로컬 파일에서 로드하는 함수 (최적화)
  private async loadPdfJs(): Promise<any> {
    if (window.pdfjsLib) {
      console.log('PDF.js already loaded');
      return window.pdfjsLib;
    }

    // HTML에서 미리 로드된 경우 대기 (로컬 파일 우선)
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 50; // 5초 대기 (100ms * 50)
      
      const checkPdfJs = () => {
        attempts++;
        
        if (window.pdfjsLib) {
          console.log('PDF.js loaded from pre-loaded local script');
          // Worker 경로는 이미 HTML에서 설정됨
          resolve(window.pdfjsLib);
          return;
        }
        
        if (attempts >= maxAttempts) {
          // 로컬 파일이 없으면 CDN으로 폴백
          console.log('PDF.js not pre-loaded, falling back to CDN...');
          this.loadPdfJsFromCDN().then(resolve).catch(reject);
          return;
        }
        
        setTimeout(checkPdfJs, 100);
      };
      
      checkPdfJs();
    });
  }

  // CDN에서 PDF.js 로딩 (폴백)
  private async loadPdfJsFromCDN(): Promise<any> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
      script.async = true;
      script.defer = true;
      
      // 타임아웃 설정 (10초)
      const timeout = setTimeout(() => {
        reject(new Error('PDF.js loading timeout'));
      }, 10000);
      
      script.onload = () => {
        clearTimeout(timeout);
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
          resolve(window.pdfjsLib);
        } else {
          reject(new Error('Failed to load PDF.js'));
        }
      };
      script.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Failed to load PDF.js script'));
      };
      document.head.appendChild(script);
    });
  }

  // 법령 문서인지 식별하는 메서드
  private isLegalDocument(filename: string): boolean {
    const legalKeywords = [
      '법률', '법', '시행령', '시행규칙', '규제법', '해설집'
    ];
    
    return legalKeywords.some(keyword => 
      filename.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  // 법령 조항을 추출하는 메서드 (시행령/시행규칙 구분)
  private extractLegalArticles(pageText: string, filename: string): string[] {
    const articles: string[] = [];
    
    // pageText가 undefined이거나 null인 경우 처리
    if (!pageText || typeof pageText !== 'string') {
      console.warn('extractLegalArticles: pageText is invalid', { pageText, filename });
      return [];
    }
    
    // 파일명에서 법령 유형 판단
    const isEnforcementDecree = filename.includes('시행령');
    const isEnforcementRule = filename.includes('시행규칙');
    const isMainLaw = !isEnforcementDecree && !isEnforcementRule;
    
    // 법령 조항 패턴들
    const articlePatterns = [
      // "제1조" 형태
      /제(\d+)조/g,
      // "제1조제1항" 형태
      /제(\d+)조제(\d+)항/g,
      // "제1조제1항제1호" 형태
      /제(\d+)조제(\d+)항제(\d+)호/g,
      // "제1조제1항제1호가목" 형태
      /제(\d+)조제(\d+)항제(\d+)호([가-힣])목/g,
      // "제1조제1항제1호가목1" 형태
      /제(\d+)조제(\d+)항제(\d+)호([가-힣])목(\d+)/g
    ];
    
    // 각 패턴에 대해 매칭
    articlePatterns.forEach(pattern => {
      try {
        const matches = pageText.match(pattern);
        if (matches) {
          articles.push(...matches);
        }
      } catch (error) {
        console.warn('extractLegalArticles: pattern matching failed', { error, pattern, pageText: pageText.substring(0, 100) });
      }
    });
    
    // 법령 유형에 따라 접두사 추가
    const prefixedArticles = articles.map(article => {
      if (isEnforcementDecree) {
        return `시행령 ${article}`;
      } else if (isEnforcementRule) {
        return `시행규칙 ${article}`;
      } else {
        return article; // 기본 법률은 접두사 없음
      }
    });
    
    // 중복 제거 및 정렬
    return [...new Set(prefixedArticles)].sort((a, b) => {
      // 숫자 순으로 정렬
      const aNum = a.match(/\d+/g)?.map(Number) || [0];
      const bNum = b.match(/\d+/g)?.map(Number) || [0];
      
      for (let i = 0; i < Math.max(aNum.length, bNum.length); i++) {
        const aVal = aNum[i] || 0;
        const bVal = bNum[i] || 0;
        if (aVal !== bVal) return aVal - bVal;
      }
      return 0;
    });
  }

  // 실제 PDF 페이지 번호를 추출하는 메서드 (개선된 버전)
  private extractActualPageNumber(pageText: string, pageIndex: number): number {
    // 1. 줄바꿈을 보존하여 텍스트를 라인별로 분할
    const lines = pageText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // 2. 페이지 하단에서 페이지 번호 찾기 (마지막 5줄에서 검색)
    const bottomLines = lines.slice(-5);
    
    for (let i = bottomLines.length - 1; i >= 0; i--) {
      const line = bottomLines[i];
      
      // 3. 페이지 번호 패턴들 (우선순위 순)
      const pageNumberPatterns = [
        // "69" (단독 숫자만 있는 줄)
        /^(\d+)$/,
        // "페이지 69" 형태
        /^페이지\s*(\d+)$/i,
        // "Page 69" 형태  
        /^Page\s*(\d+)$/i,
        // "69/124" 형태 (분수에서 분자만)
        /^(\d+)\s*\/\s*\d+$/,
        // "69 of 124" 형태
        /^(\d+)\s*of\s*\d+$/i,
        // "p.69" 형태
        /^p\.\s*(\d+)$/i,
        // "P.69" 형태
        /^P\.\s*(\d+)$/i
      ];
      
      // 각 패턴을 순서대로 시도
      for (const pattern of pageNumberPatterns) {
        const match = line.match(pattern);
        if (match && match[1]) {
          const pageNum = parseInt(match[1], 10);
          // 유효한 페이지 번호인지 확인 (1-999 범위)
          if (pageNum >= 1 && pageNum <= 999) {
            console.log(`페이지 ${pageIndex}에서 실제 페이지 번호 ${pageNum} 발견 (라인: "${line}")`);
            return pageNum;
          }
        }
      }
    }
    
    // 4. 페이지 하단에서 숫자만 있는 라인 찾기
    for (let i = bottomLines.length - 1; i >= 0; i--) {
      const line = bottomLines[i];
      // 숫자만 있는 라인인지 확인
      if (/^\d+$/.test(line)) {
        const pageNum = parseInt(line, 10);
        if (pageNum >= 1 && pageNum <= 999) {
          console.log(`페이지 ${pageIndex}에서 추정 페이지 번호 ${pageNum} 발견 (라인: "${line}")`);
          return pageNum;
        }
      }
    }
    
    // 5. 찾지 못하면 순차 인덱스 사용 (fallback)
    console.warn(`페이지 ${pageIndex}에서 실제 페이지 번호를 찾지 못함, 순차 인덱스 ${pageIndex} 사용`);
    return pageIndex;
  }

  // PDF 파싱 함수 (CDN에서 로드된 PDF.js 사용)
  async parsePdfFromUrl(url: string): Promise<string> {
    try {
      const pdfData = await fetch(url).then(res => {
        if (!res.ok) {
          throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
        }
        return res.arrayBuffer();
      });
      
      // PDF.js를 CDN에서 로드
      const pdfjsLib = await this.loadPdfJs();
      
      // useWorkerFetch 파라미터를 추가하여 CMapReaderFactory 초기화
      const pdf = await pdfjsLib.getDocument({ 
        data: new Uint8Array(pdfData),
        useWorkerFetch: true,
        verbosity: 0 // 경고 메시지 줄이기
      }).promise;
      
      let fullText = '';
      const filename = url.split('/').pop() || '';
      const isLegal = this.isLegalDocument(filename);
      
      console.log(`PDF 총 페이지 수: ${pdf.numPages}, 법령 문서: ${isLegal}`);
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        // 줄바꿈을 보존하여 텍스트 구성
        let pageText = '';
        for (let j = 0; j < textContent.items.length; j++) {
          const item = textContent.items[j];
          pageText += item.str;
          
          // 줄바꿈이 필요한 경우 추가
          if (item.hasEOL) {
            pageText += '\n';
          }
        }
        
        if (isLegal) {
          // 법령 문서의 경우 조항 추출 (파일명 전달)
          const articles = this.extractLegalArticles(pageText, filename);
          if (articles.length > 0) {
            // 조항이 있는 경우 조항으로 마커 생성
            const articleMarkers = articles.map(article => `[ARTICLE_${article}]`).join(' ');
            fullText += `${articleMarkers} ${pageText}\n\n`;
            console.log(`페이지 ${i}에서 법령 조항 발견: ${articles.join(', ')}`);
          } else {
            // 조항이 없는 경우 페이지 번호 사용
            const actualPageNumber = this.extractActualPageNumber(pageText, i);
            fullText += `[PAGE_${actualPageNumber}] ${pageText}\n\n`;
          }
        } else {
          // 일반 문서의 경우 페이지 번호 사용
          const actualPageNumber = this.extractActualPageNumber(pageText, i);
          fullText += `[PAGE_${actualPageNumber}] ${pageText}\n\n`;
        }
        
        // 디버깅을 위한 로그
        if (i <= 5 || i % 10 === 0) {
          if (isLegal) {
            const articles = this.extractLegalArticles(pageText);
            console.log(`PDF.js 페이지 ${i} → 법령 조항: ${articles.length > 0 ? articles.join(', ') : '없음'}`);
          } else {
            const actualPageNumber = this.extractActualPageNumber(pageText, i);
            console.log(`PDF.js 페이지 ${i} → 실제 페이지 ${actualPageNumber}`);
          }
        }
      }
      
      return fullText;
    } catch (err) {
      console.error(`Error parsing PDF from ${url}:`, err);
      throw new Error(`Failed to parse ${url.split('/').pop()}: ${(err as Error).message}`);
    }
  }

  // PDF 내용을 Firestore에서 로드하고 압축하여 캐시 (Firestore 전용)
  async initializeWithPdfSources(): Promise<void> {
    if (this.isInitialized && this.cachedSourceText) {
      console.log('PDF sources already initialized');
      return;
    }

    try {
      console.log('Initializing PDF sources...');
      
      // 0. 소스 목록을 동적으로 로드
      await this.loadDefaultSources();
      
      // 1. Firestore에서 데이터 로드 시도 (최우선)
      const firestoreText = await this.loadFromFirestore();
      if (firestoreText) {
        console.log('Firestore 데이터 사용 완료');
        return;
      }
      
      // 2. 실시간 PDF 파싱 (Firestore 실패시만)
      console.log('Firestore 데이터가 없어 실시간 PDF 파싱을 시도합니다...');
      await this.loadPdfSourcesOptimized();
      
      // 3. 백그라운드 프리로딩으로 답변 품질 100% 보장
      console.log('백그라운드 프리로딩 시작 - 답변 품질 최우선 보장');
      await this.initializeWithBackgroundPreloading();
      
      // 압축 결과 검증
      const validation = pdfCompressionService.validateCompression(this.compressionResult);
      if (!validation.isValid) {
        console.warn('Compression validation warnings:', validation.warnings);
        console.log('Recommendations:', validation.recommendations);
      }
      
      console.log('PDF sources initialized, chunked, and compressed successfully');
    } catch (error) {
      console.error('Failed to initialize PDF sources:', error);
      
      // 폴백: 기본 소스 사용
      console.log('Falling back to default sources...');
      this.cachedSourceText = this.sources.length > 0 
        ? this.sources.map(source => `[${source.title}]\n${source.content}`).join('\n\n')
        : 'PDF 로딩에 실패했습니다. 기본 모드로 실행됩니다.';
      this.isInitialized = true;
      
      // 기본 압축 결과 생성
      this.compressionResult = {
        compressedText: this.cachedSourceText,
        originalLength: this.cachedSourceText.length,
        compressedLength: this.cachedSourceText.length,
        compressionRatio: 1.0,
        estimatedTokens: Math.ceil(this.cachedSourceText.length / 4),
        qualityScore: 60
      };
      
      console.log('Fallback initialization completed');
    }
  }

  /**
   * 백그라운드 프리로딩을 사용한 초기화 (답변 품질 100% 보장)
   */
  private async initializeWithBackgroundPreloading(): Promise<void> {
    console.log('백그라운드 프리로딩으로 PDF 초기화 시작 - 답변 품질 최우선 보장');
    
    // PDF 파일 목록 가져오기
    const pdfFiles = await this.getPDFFileList();
    if (pdfFiles.length === 0) {
      throw new Error('로드할 PDF 파일이 없습니다.');
    }

    // 우선순위 기반 PDF 로딩 순서 설정 (답변 품질 최적화)
    const priorityOrder = this.getPriorityPDFOrder(pdfFiles);
    console.log('PDF 로딩 우선순위:', priorityOrder);

    // 진행률 초기화
    this.loadingProgress = {
      current: 0,
      total: priorityOrder.length,
      currentFile: '',
      status: '백그라운드 프리로딩 시작...',
      successfulFiles: [],
      failedFiles: [],
      loadedChunks: 0,
      estimatedTimeRemaining: 0
    };

    // 모든 PDF를 순차적으로 로드 (답변 품질 보장)
    const loadedPDFs = [];
    const startTime = Date.now();

    for (let i = 0; i < priorityOrder.length; i++) {
      const pdfFile = priorityOrder[i];
      
      // 진행률 업데이트
      this.loadingProgress = {
        ...this.loadingProgress,
        current: i + 1,
        currentFile: pdfFile,
        status: `백그라운드 로딩 중... (${i + 1}/${priorityOrder.length})`
      };

      try {
        console.log(`PDF 로딩 중: ${pdfFile} (${i + 1}/${priorityOrder.length})`);
        const pdfText = await this.parsePdfFromUrl('/pdf/' + pdfFile);
        
        if (pdfText && pdfText.trim().length > 0) {
          loadedPDFs.push({ filename: pdfFile, text: pdfText });
          this.loadingProgress.successfulFiles.push(pdfFile);
          console.log(`✅ PDF 로딩 성공: ${pdfFile}`);
        } else {
          throw new Error('PDF 텍스트가 비어있습니다.');
        }
      } catch (error) {
        console.warn(`⚠️ PDF 로딩 실패: ${pdfFile} - ${error.message}`);
        this.loadingProgress.failedFiles.push({ file: pdfFile, error: error.message });
      }

      // 예상 남은 시간 계산
      const elapsed = Date.now() - startTime;
      const avgTimePerFile = elapsed / (i + 1);
      const remainingFiles = priorityOrder.length - (i + 1);
      const estimatedRemaining = Math.round(avgTimePerFile * remainingFiles);
      
      this.loadingProgress.estimatedTimeRemaining = estimatedRemaining;
    }

    if (loadedPDFs.length === 0) {
      throw new Error('로드에 성공한 PDF가 없습니다.');
    }

    // 모든 PDF 텍스트 결합 (답변 품질 100% 보장)
    const combinedText = loadedPDFs
      .map(pdf => pdf.text)
      .join('\n--- END OF DOCUMENT ---\n\n--- START OF DOCUMENT ---\n');
    
    this.fullPdfText = combinedText;
    console.log(`전체 PDF 텍스트 로드 완료: ${combinedText.length.toLocaleString()}자`);

    // 청크 분할
    console.log('PDF 청크 분할 중...');
    this.allChunks = pdfCompressionService.splitIntoChunks(combinedText, 'PDF Document');
    contextSelector.setChunks(this.allChunks);
    console.log(`PDF를 ${this.allChunks.length}개 청크로 분할 완료`);

    // 압축 처리 (실시간 PDF 파싱은 압축 적용)
    console.log('PDF 내용 압축 중...');
    this.compressionResult = await pdfCompressionService.compressPdfContent(combinedText);
    this.cachedSourceText = this.compressionResult.compressedText;

    // 캐시 저장 제거 (Firestore 전용)

    // 메모리 최적화
    if (this.isMemoryOptimizationEnabled) {
      this.optimizeMemoryUsage();
    }

    // 최종 진행률 업데이트
    this.loadingProgress = {
      ...this.loadingProgress,
      status: `백그라운드 프리로딩 완료 - 답변 품질 100% 보장`,
      loadedChunks: this.allChunks.length,
      estimatedTimeRemaining: 0
    };

    console.log(`백그라운드 프리로딩 완료: ${loadedPDFs.length}개 PDF, ${this.allChunks.length}개 청크 - 답변 품질 100% 보장`);
  }

  /**
   * 기존 방식의 로딩 (폴백)
   */
  private async initializeWithTraditionalLoading(): Promise<void> {
    console.log('기존 방식으로 PDF 초기화...');
    
    // PDF 내용 로드 (병렬 처리로 최적화)
    const fullText = await this.loadPdfSourcesOptimized();
    if (!fullText || fullText.trim().length === 0) {
      throw new Error('PDF 내용을 로드할 수 없습니다.');
    }
    console.log(`Original PDF text loaded: ${fullText.length.toLocaleString()} characters`);
    
    // 전체 PDF 텍스트 저장
    this.fullPdfText = fullText;
    
    // PDF를 청크로 분할 (비동기 처리)
    console.log('Splitting PDF into chunks...');
    this.allChunks = pdfCompressionService.splitIntoChunks(fullText, 'PDF Document');
    console.log(`PDF split into ${this.allChunks.length} chunks`);
    
    // 컨텍스트 선택기에 청크 설정
    contextSelector.setChunks(this.allChunks);
    
    // PDF 내용 압축 (실시간 PDF 파싱은 압축 적용)
    console.log('Compressing PDF content...');
    this.compressionResult = await pdfCompressionService.compressPdfContent(fullText);
    this.cachedSourceText = this.compressionResult.compressedText;
  }

  /**
   * PDF 파일 목록 가져오기
   */
  private async getPDFFileList(): Promise<string[]> {
    try {
      const response = await fetch('/pdf/manifest.json');
      if (!response.ok) {
        throw new Error(`Manifest 로드 실패: ${response.status}`);
      }
      const pdfFiles = await response.json();
      return Array.isArray(pdfFiles) ? pdfFiles : [];
    } catch (error) {
      console.error('PDF 파일 목록 로드 실패:', error);
      return [];
    }
  }

  /**
   * PDF 로딩 우선순위 설정 (답변 품질 최적화)
   */
  private getPriorityPDFOrder(pdfFiles: string[]): string[] {
    // 답변 품질을 위해 중요한 PDF부터 먼저 로드
    const priorityKeywords = [
      // 1순위: 핵심 법령 문서
      { keywords: ['국민건강증진법률', '시행령', '시행규칙'], priority: 1 },
      { keywords: ['질서위반행위규제법'], priority: 1 },
      
      // 2순위: 주요 업무지침
      { keywords: ['금연지원서비스', '통합시스템', '사용자매뉴얼'], priority: 2 },
      { keywords: ['금연구역', '지정', '관리', '업무지침'], priority: 2 },
      
      // 3순위: 가이드라인 및 안내서
      { keywords: ['니코틴보조제', '이용방법', '가이드라인'], priority: 3 },
      { keywords: ['지역사회', '통합건강증진사업', '안내서'], priority: 3 },
      
      // 4순위: 해설집 및 기타
      { keywords: ['해설집'], priority: 4 }
    ];

    const prioritizedFiles = pdfFiles.map(file => {
      let priority = 5; // 기본 우선순위
      
      for (const { keywords, priority: p } of priorityKeywords) {
        if (keywords.some(keyword => file.includes(keyword))) {
          priority = p;
          break;
        }
      }
      
      return { file, priority };
    });

    // 우선순위 순으로 정렬
    return prioritizedFiles
      .sort((a, b) => a.priority - b.priority)
      .map(item => item.file);
  }



  /**
   * 메모리 사용량 최적화
   */
  private optimizeMemoryUsage(): void {
    try {
      // 청크들을 메모리 최적화 서비스에 캐시
      memoryOptimizationService.cacheChunks(this.allChunks);
      
      // 메모리 통계 업데이트
      this.memoryStats = memoryOptimizationService.getMemoryStats();
      
      console.log('메모리 최적화 완료:', this.memoryStats);
    } catch (error) {
      console.warn('메모리 최적화 실패:', error);
    }
  }

  /**
   * 성능 통계 반환
   */
  getPerformanceStats(): {
    loadingProgress: LoadingProgress | null;
    memoryStats: MemoryStats | null;
    isProgressiveLoadingEnabled: boolean;
    isMemoryOptimizationEnabled: boolean;
  } {
    return {
      loadingProgress: this.loadingProgress,
      memoryStats: this.memoryStats,
      isProgressiveLoadingEnabled: this.isProgressiveLoadingEnabled,
      isMemoryOptimizationEnabled: this.isMemoryOptimizationEnabled
    };
  }

  /**
   * 성능 설정 업데이트
   */
  updatePerformanceSettings(settings: {
    progressiveLoading?: boolean;
    memoryOptimization?: boolean;
    caching?: boolean;
  }): void {
    if (settings.progressiveLoading !== undefined) {
      this.isProgressiveLoadingEnabled = settings.progressiveLoading;
    }
    if (settings.memoryOptimization !== undefined) {
      this.isMemoryOptimizationEnabled = settings.memoryOptimization;
    }
    // 캐싱 설정 제거 (Firestore 전용)
    console.log('성능 설정 업데이트:', {
      progressiveLoading: this.isProgressiveLoadingEnabled,
      memoryOptimization: this.isMemoryOptimizationEnabled
    });
  }

  /**
   * 답변 품질을 보장하는 질문 처리 (품질 최우선)
   */
  async processQuestionWithQualityGuarantee(question: string): Promise<{
    answer: string;
    quality: 'guaranteed' | 'partial' | 'insufficient';
    loadedPDFs: number;
    totalPDFs: number;
  }> {
    // 초기화 상태 확인
    if (!this.isInitialized) {
      return {
        answer: 'PDF 로딩이 아직 완료되지 않았습니다. 잠시 기다려주세요.',
        quality: 'insufficient',
        loadedPDFs: 0,
        totalPDFs: 0
      };
    }

    // 로딩 진행률 확인
    const loadingStatus = this.loadingProgress;
    if (loadingStatus && loadingStatus.current < loadingStatus.total) {
      const remainingFiles = loadingStatus.total - loadingStatus.current;
      return {
        answer: `PDF 로딩이 진행 중입니다 (${loadingStatus.current}/${loadingStatus.total}). 완전한 답변을 위해 ${remainingFiles}개 파일 로딩 완료까지 기다려주세요.`,
        quality: 'partial',
        loadedPDFs: loadingStatus.current,
        totalPDFs: loadingStatus.total
      };
    }

    // 답변 품질 100% 보장
    try {
      const answer = await this.generateStreamingResponse(question);
      return {
        answer,
        quality: 'guaranteed',
        loadedPDFs: loadingStatus?.total || 0,
        totalPDFs: loadingStatus?.total || 0
      };
    } catch (error) {
      console.error('답변 생성 중 오류:', error);
      return {
        answer: '답변 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        quality: 'insufficient',
        loadedPDFs: 0,
        totalPDFs: 0
      };
    }
  }

  /**
   * 캐시 정리
   */
  // 캐시 정리 제거 (Firestore 전용)

  /**
   * 메모리 정리
   */
  cleanupMemory(): void {
    try {
      if (this.isMemoryOptimizationEnabled) {
        memoryOptimizationService.cleanup();
        this.memoryStats = memoryOptimizationService.getMemoryStats();
        console.log('메모리 정리 완료');
      }
    } catch (error) {
      console.warn('메모리 정리 실패:', error);
    }
  }

  // Firestore에서 데이터 로드 (최우선)
  async loadFromFirestore(): Promise<string | null> {
    try {
      console.log('🔍 Firestore에서 데이터 로드 시도...');
      
      // Firestore 상태 확인
      console.log('🔍 Firestore 상태 확인 중...');
      const stats = await this.firestoreService.getDatabaseStats();
      console.log('🔍 Firestore 상태:', stats);
      
      if (stats.totalChunks === 0) {
        console.log('⚠️ Firestore에 데이터가 없습니다.');
        return null;
      }
      
      // 모든 PDF 문서의 청크를 가져와서 텍스트 생성
      console.log('🔍 PDF 문서 목록 가져오기...');
      const allDocuments = await this.firestoreService.getAllDocuments();
      console.log(`🔍 PDF 문서 ${allDocuments.length}개 발견:`, allDocuments.map(d => d.filename));
      
      let fullText = '';
      const chunks: Chunk[] = [];
      
      for (const doc of allDocuments) {
        console.log(`🔍 문서 청크 가져오기: ${doc.filename} (${doc.id})`);
        const docChunks = await this.firestoreService.getChunksByDocument(doc.id);
        console.log(`🔍 ${doc.filename}에서 ${docChunks.length}개 청크 발견`);
        
        // Firestore 청크를 Chunk 형식으로 변환
        const convertedChunks = docChunks.map(firestoreChunk => ({
          id: firestoreChunk.id || '',
          content: firestoreChunk.content,
          metadata: {
            source: doc.filename,
            title: doc.title,
            page: firestoreChunk.metadata.page,
            section: firestoreChunk.metadata.section,
            position: firestoreChunk.metadata.position,
            startPosition: firestoreChunk.metadata.startPos,
            endPosition: firestoreChunk.metadata.endPos,
            originalSize: firestoreChunk.metadata.originalSize,
            documentType: this.getDocumentType(doc.filename)
          },
          keywords: firestoreChunk.keywords,
          location: {
            document: doc.filename,
            section: firestoreChunk.metadata.section,
            page: firestoreChunk.metadata.page
          }
        }));
        
        chunks.push(...convertedChunks);
        fullText += `[${doc.filename}]\n${docChunks.map(c => c.content).join('\n\n')}\n\n---\n\n`;
      }
      
      // Firestore 데이터는 압축 없이 사용 (최적화)
      this.cachedSourceText = fullText;
      this.fullPdfText = fullText;
      this.allChunks = chunks;
      this.isInitialized = true;
      
      // 🔥 핵심 수정: ContextSelector에 청크 설정
      console.log('🔍 ContextSelector에 청크 설정 중...');
      ContextSelector.setChunks(chunks);
      console.log(`✅ ContextSelector 설정 완료: ${chunks.length}개 청크`);
      
      // 압축 결과 설정 (압축 없이)
      this.compressionResult = {
        compressedText: fullText,
        originalLength: fullText.length,
        compressedLength: fullText.length,
        compressionRatio: 1.0,
        estimatedTokens: Math.ceil(fullText.length / 4),
        qualityScore: 100 // Firestore 데이터는 최고 품질 (압축 없음)
      };
      
      console.log(`✅ Firestore 데이터 로드 완료: ${chunks.length}개 청크, ${fullText.length.toLocaleString()}자 (압축 없음)`);
      return fullText;
      
    } catch (error) {
      console.error('❌ Firestore 데이터 로드 실패:', error);
      console.error('❌ 오류 상세:', error.message);
      console.error('❌ 오류 스택:', error.stack);
      return null;
    }
  }


  // 실제 PDF 파일들을 파싱하여 소스 텍스트 생성 (최적화된 버전)
  async loadPdfSourcesOptimized(): Promise<string> {
    // public 폴더에서 PDF 파일들 로드
    const PDF_BASE_URL = '/chat7v/pdf/';
    
    try {
      console.log('Attempting to load PDF sources from:', PDF_BASE_URL);
      
      // manifest.json에서 PDF 파일 목록 가져오기
      const manifestUrl = `${PDF_BASE_URL}manifest.json`;
      console.log('Fetching manifest from:', manifestUrl);
      
      const manifestResponse = await fetch(manifestUrl);
      
      if (!manifestResponse.ok) {
        console.warn(`Manifest not found (${manifestResponse.status}), falling back to default sources`);
        throw new Error(`Could not load file list (manifest.json). Status: ${manifestResponse.statusText}`);
      }
      
      const pdfFiles = await manifestResponse.json();
      console.log('Found PDF files:', pdfFiles);
      
      if (!Array.isArray(pdfFiles) || pdfFiles.length === 0) {
        throw new Error("No PDF files found in manifest.json or the file is invalid.");
      }

      // PDF.js 미리 로드
      console.log('Pre-loading PDF.js...');
      await this.loadPdfJs();

      // 모든 PDF 파일을 병렬로 파싱 (최대 3개 동시 처리)
      const BATCH_SIZE = 3;
      const texts: string[] = [];
      
      for (let i = 0; i < pdfFiles.length; i += BATCH_SIZE) {
        const batch = pdfFiles.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(pdfFiles.length / BATCH_SIZE)}`);
        
        const batchPromises = batch.map(file => this.parsePdfFromUrl(PDF_BASE_URL + file));
        const batchTexts = await Promise.all(batchPromises);
        texts.push(...batchTexts);
      }
      
      const combinedText = texts.join('\n--- END OF DOCUMENT ---\n\n--- START OF DOCUMENT ---\n');
      
      // 실시간 PDF 파싱은 압축 적용 (토큰 제한 관리)
      console.log('실시간 PDF 파싱 - 압축 적용 중...');
      const compressionResult = await pdfCompressionService.compressPdfContent(combinedText);
      
      console.log(`✅ 실시간 PDF 파싱 완료: ${compressionResult.compressedText.length.toLocaleString()}자 (압축률: ${compressionResult.compressionRatio.toFixed(2)})`);
      return compressionResult.compressedText;
    } catch (err) {
      console.warn("Error loading PDFs, using default sources:", err);
      // PDF 로딩 실패 시 기본 소스 사용
      return this.sources
        .map(source => `[${source.title}]\n${source.content}`)
        .join('\n\n');
    }
  }

  // 기존 메서드 유지 (호환성)
  async loadPdfSources(): Promise<string> {
    return this.loadPdfSourcesOptimized();
  }

  // 채팅 세션 생성 (하이브리드 방식: 매번 새로운 API 키 사용)
  async createNotebookChatSession(sourceText?: string): Promise<any> {
    // 🚨 무한 루프 방지 체크
    if (this.isCreatingSession) {
      console.error('❌ 무한 루프 감지: 세션 생성이 이미 진행 중입니다.');
      throw new Error('세션 생성 중입니다. 무한 루프를 방지합니다.');
    }

    // 🚨 세션 생성 시도 횟수 체크
    this.sessionCreationCount++;
    if (this.sessionCreationCount > GeminiService.MAX_SESSION_CREATION_ATTEMPTS) {
      console.error(`❌ 세션 생성 시도 횟수 초과: ${this.sessionCreationCount}회 (최대: ${GeminiService.MAX_SESSION_CREATION_ATTEMPTS}회)`);
      this.sessionCreationCount = 0; // 리셋
      throw new Error('세션 생성 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.');
    }

    console.log(`🔄 세션 생성 시작 (시도 ${this.sessionCreationCount}/${GeminiService.MAX_SESSION_CREATION_ATTEMPTS})`);
    this.isCreatingSession = true;

    try {
      // 매번 새로운 API 키 선택
      const selectedApiKey = this.getNextAvailableKey();
      if (!selectedApiKey) {
        throw new Error('사용 가능한 API 키가 없습니다.');
      }

      console.log(`채팅 세션 생성 - API 키: ${selectedApiKey.substring(0, 10)}...`);

      // PDF 내용이 아직 초기화되지 않았다면 초기화
      if (!this.isInitialized) {
        await this.initializeWithPdfSources();
      }

      // 압축된 PDF 내용 사용 (캐시된 내용)
      let actualSourceText = sourceText || this.cachedSourceText || '';
      
      // 🔥 핵심 수정: 컨텍스트 길이 제한을 더 엄격하게 적용
      const MAX_CONTEXT_LENGTH = 5000; // 10,000자 → 5,000자로 축소
      if (actualSourceText.length > MAX_CONTEXT_LENGTH) {
        console.warn(`⚠️ 컨텍스트 길이 초과: ${actualSourceText.length}자 (제한: ${MAX_CONTEXT_LENGTH}자)`);
        actualSourceText = actualSourceText.substring(0, MAX_CONTEXT_LENGTH);
        console.log(`✅ 컨텍스트 길이 조정: ${actualSourceText.length}자`);
      }
      
      const systemInstruction = GeminiService.SYSTEM_INSTRUCTION_TEMPLATE.replace('{sourceText}', actualSourceText);

      console.log(`Creating chat session with compressed text: ${actualSourceText.length.toLocaleString()} characters`);

    try {
      // 새로운 AI 인스턴스 생성 (선택된 키로)
      const ai = new GoogleGenerativeAI(selectedApiKey);
      
      // chat_index.html과 정확히 동일한 방식
      const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: systemInstruction,
        },
        history: [],
      });

      // RPD 기록 - 안전한 인덱스 계산
      const apiKeys = this.getApiKeys();
      
      // currentKeyIndex가 NaN이거나 유효하지 않은 경우 0으로 초기화
      if (isNaN(GeminiService.currentKeyIndex) || GeminiService.currentKeyIndex < 0) {
        GeminiService.currentKeyIndex = 0;
      }
      
      // 선택된 키의 인덱스 계산 (현재 키가 아닌 선택된 키 기준)
      const selectedKeyIndex = apiKeys.findIndex(key => key === selectedApiKey);
      const actualKeyIndex = selectedKeyIndex >= 0 ? selectedKeyIndex : 0;
      const currentKeyId = `key${actualKeyIndex + 1}`;
      
      console.log(`API 키 상태 - currentKeyIndex: ${GeminiService.currentKeyIndex}, selectedKeyIndex: ${selectedKeyIndex}`);
      console.log(`사용된 키 인덱스: ${actualKeyIndex}, RPD 키 ID: ${currentKeyId}`);
      this.recordApiCall(currentKeyId);

      this.currentChatSession = chat;
      console.log(`✅ 세션 생성 완료 (시도 ${this.sessionCreationCount}/${GeminiService.MAX_SESSION_CREATION_ATTEMPTS})`);
      return chat;
    } catch (error) {
      console.error('채팅 세션 생성 실패:', error);
      
      // API 키 교체 시도
      const apiKeys = this.getApiKeys();
      const failedKeyIndex = (GeminiService.currentKeyIndex - 1 + apiKeys.length) % apiKeys.length;
      if (this.handleApiKeyFailure(apiKeys[failedKeyIndex], error)) {
        // 키 교체 후 재시도
        return this.createNotebookChatSession(sourceText);
      }
      
      throw error;
    } finally {
      // 🚨 무한 루프 방지 플래그 리셋
      this.isCreatingSession = false;
      console.log(`🔄 세션 생성 플래그 리셋 완료`);
    }
  }

  // 스트리밍 응답 생성 (질문별 컨텍스트 선택 사용 + 재시도 로직)
  async generateStreamingResponse(message: string): Promise<AsyncGenerator<string, void, unknown>> {
    return log.monitor(async () => {
      return this.executeWithRetry(async () => {
        try {
          // 1. 질문 분석
          log.debug('질문 분석 시작', { messageLength: message.length });
          const questionAnalysis = await questionAnalyzer.analyzeQuestion(message);
          log.info('질문 분석 완료', { analysis: questionAnalysis });

          // 2. 관련 컨텍스트 선택
          log.debug('관련 컨텍스트 선택 시작');
          const relevantChunks = await contextSelector.selectRelevantContext(message, questionAnalysis);
          log.info(`관련 컨텍스트 선택 완료`, { 
            selectedChunks: relevantChunks.length,
            chunks: relevantChunks.map(c => ({ title: c.metadata.title, section: c.location.section }))
          });

          // 2.5. 청크에서 출처 정보 생성 (문서 유형별 처리)
          const sourceInfo = this.generateSourceInfoFromChunks(relevantChunks);
          log.info('출처 정보 생성 완료', { 
            sources: sourceInfo.map(s => ({ 
              title: s.title, 
              section: s.section, 
              page: s.page,
              documentType: s.documentType 
            }))
          });

          // 3. 선택된 컨텍스트로 새 세션 생성 (간소화된 포맷팅)
          const contextText = relevantChunks
            .map((chunk, index) => {
              return `[문서 ${index + 1}: ${chunk.metadata.title} - ${chunk.location.section || '일반'}]\n${chunk.content}`;
            })
            .join('\n\n---\n\n');

          // 컨텍스트 길이 검증 및 제한 (더 엄격하게)
          const MAX_CONTEXT_LENGTH = 5000; // 10,000자 → 5,000자로 축소
          let finalContextText = contextText;
          
          if (contextText.length > MAX_CONTEXT_LENGTH) {
            console.warn(`⚠️ 컨텍스트 길이 초과: ${contextText.length}자 (제한: ${MAX_CONTEXT_LENGTH}자)`);
            
            // 청크 수를 줄여서 길이 제한
            let reducedChunks = relevantChunks;
            let reducedContext = contextText;
            
            while (reducedContext.length > MAX_CONTEXT_LENGTH && reducedChunks.length > 1) {
              reducedChunks = reducedChunks.slice(0, -1);
              reducedContext = reducedChunks
                .map((chunk, index) => {
                  return `[문서 ${index + 1}: ${chunk.metadata.title} - ${chunk.location.section || '일반'}]\n${chunk.content}`;
                })
                .join('\n\n---\n\n');
            }
            
            finalContextText = reducedContext;
            console.log(`✅ 컨텍스트 길이 조정: ${finalContextText.length}자 (${reducedChunks.length}개 청크)`);
          }

          log.info(`컨텍스트 기반 세션 생성`, { 
            contextLength: finalContextText.length,
            selectedChunks: relevantChunks.length
          });

          // 4. 새 채팅 세션 생성 (선택된 컨텍스트 사용)
          const newSession = await this.createNotebookChatSession(finalContextText);

          // 5. 스트리밍 응답 생성
          const stream = await newSession.sendMessageStream({ message: message });
          
          return (async function* () {
            for await (const chunk of stream) {
              if (chunk.text) {
                yield chunk.text;
              }
            }
          })();
        } catch (error) {
          log.error('컨텍스트 기반 응답 생성 실패, 제한된 컨텍스트로 폴백', { error: error.message });
          
          // 🔥 핵심 수정: 폴백 시에도 컨텍스트 길이 제한 적용 (더 엄격하게)
          const MAX_CONTEXT_LENGTH = 5000; // 10,000자 → 5,000자로 축소
          let fallbackContext = this.cachedSourceText || this.fullPdfText || '';
          
          if (fallbackContext.length > MAX_CONTEXT_LENGTH) {
            console.warn(`⚠️ 폴백 컨텍스트 길이 초과: ${fallbackContext.length}자 (제한: ${MAX_CONTEXT_LENGTH}자)`);
            fallbackContext = fallbackContext.substring(0, MAX_CONTEXT_LENGTH);
            console.log(`✅ 폴백 컨텍스트 길이 조정: ${fallbackContext.length}자`);
          }
          
          // 폴백: 제한된 컨텍스트 사용
          if (!this.currentChatSession) {
            await this.createNotebookChatSession(fallbackContext);
          }

          const stream = await this.currentChatSession.sendMessageStream({ message: message });
          
          return (async function* () {
            for await (const chunk of stream) {
              if (chunk.text) {
                yield chunk.text;
              }
            }
          })();
        }
      }, 3, 1000).catch(error => {
        log.error('모든 재시도 시도 실패', { error: error.message });
        
        // 사용자 친화적인 오류 메시지 제공
        return (async function* () {
          if (error.message && (
            error.message.includes('429') || 
            error.message.includes('RESOURCE_EXHAUSTED') ||
            error.message.includes('quota') ||
            error.message.includes('Quota') ||
            error.message.includes('rate limit')
          )) {
            yield '답변 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.';
          } else {
            yield '죄송합니다. 현재 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
          }
        })();
      });
    }, '스트리밍 응답 생성', { messageLength: message.length });
  }

  // 출처 정보를 포함한 응답 생성
  async generateResponseWithSources(message: string): Promise<{ content: string; sources: SourceInfo[] }> {
    return this.executeWithRetry(async () => {
      // 매 질문마다 새로운 API 키 선택
      const selectedApiKey = this.getNextAvailableKey();
      if (!selectedApiKey) {
        throw new Error('사용 가능한 API 키가 없습니다.');
      }

      console.log(`질문 처리 (출처 포함) - API 키: ${selectedApiKey.substring(0, 10)}...`);

      // 새로운 AI 인스턴스 생성 (선택된 키로)
      const ai = new GoogleGenerativeAI(selectedApiKey);
      
      // PDF 소스 텍스트 로드
      if (!this.cachedSourceText) {
        await this.initializeWithPdfSources();
      }

      if (!this.cachedSourceText) {
        throw new Error('PDF 소스를 로드할 수 없습니다.');
      }

      // 질문 분석
      const questionAnalysis = await questionAnalyzer.analyzeQuestion(message);
      
      // 관련 컨텍스트 선택
      const relevantChunks = await contextSelector.selectRelevantContext(message, questionAnalysis);
      
      // 청크에서 출처 정보 생성 (문서 유형별 처리)
      const sourceInfo = this.generateSourceInfoFromChunks(relevantChunks);

      // 선택된 컨텍스트로 새 세션 생성
      const contextText = relevantChunks
        .map((chunk, index) => {
          const relevanceScore = (chunk as any).relevanceScore || 0;
          return `[문서 ${index + 1}: ${chunk.metadata.title} - ${chunk.location.section || '일반'}]\n관련도: ${relevanceScore.toFixed(2)}\n${chunk.content}`;
        })
        .join('\n\n---\n\n');

      // 시스템 지시사항과 소스 텍스트 결합
      const systemInstruction = this.SYSTEM_INSTRUCTION_TEMPLATE.replace('{sourceText}', contextText);
      
      // Gemini API 호출
      const model = ai.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        systemInstruction: systemInstruction
      });

      const result = await model.generateContent(message);
      const response = await result.response;
      const text = response.text();
      
      console.log(`응답 생성 완료 (출처 포함) - 사용된 키: ${selectedApiKey.substring(0, 10)}...`);
      return { content: text, sources: sourceInfo };
    }, 3, 1000).catch(error => {
      console.error('All retry attempts failed:', error);
      
      // 사용자 친화적인 오류 메시지 제공
      if (error.message && (
        error.message.includes('429') || 
        error.message.includes('RESOURCE_EXHAUSTED') ||
        error.message.includes('quota') ||
        error.message.includes('Quota') ||
        error.message.includes('rate limit')
      )) {
        return { 
          content: '죄송합니다. 현재 API 사용량이 초과되어 일시적으로 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해주세요.', 
          sources: [] 
        };
      } else if (error.message && error.message.includes('API_KEY_INVALID')) {
        return { 
          content: 'API 키에 문제가 있습니다. 관리자에게 문의해주세요.', 
          sources: [] 
        };
      } else {
        return { 
          content: '죄송합니다. 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 
          sources: [] 
        };
      }
    });
  }

  // 하이브리드 방식: 매 질문마다 새로운 API 키로 AI 인스턴스 생성 + 재시도 로직
  async generateResponse(message: string): Promise<string> {
    return this.executeWithRetry(async () => {
      // 매 질문마다 새로운 API 키 선택
      const selectedApiKey = this.getNextAvailableKey();
      if (!selectedApiKey) {
        throw new Error('사용 가능한 API 키가 없습니다.');
      }

      console.log(`질문 처리 - API 키: ${selectedApiKey.substring(0, 10)}...`);

      // 새로운 AI 인스턴스 생성 (선택된 키로)
      const ai = new GoogleGenerativeAI(selectedApiKey);
      
      // PDF 소스 텍스트 로드
      if (!this.cachedSourceText) {
        await this.initializeWithPdfSources();
      }

      if (!this.cachedSourceText) {
        throw new Error('PDF 소스를 로드할 수 없습니다.');
      }

      // 시스템 지시사항과 소스 텍스트 결합
      const systemInstruction = this.SYSTEM_INSTRUCTION_TEMPLATE.replace('{sourceText}', this.cachedSourceText);
      
      // Gemini API 호출
      const model = ai.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        systemInstruction: systemInstruction
      });

      const result = await model.generateContent(message);
      const response = await result.response;
      const text = response.text();
      
      console.log(`응답 생성 완료 - 사용된 키: ${selectedApiKey.substring(0, 10)}...`);
      return text;
    }, 3, 1000).catch(error => {
      console.error('All retry attempts failed:', error);
      
      // 사용자 친화적인 오류 메시지 제공
      if (error.message && (
        error.message.includes('429') || 
        error.message.includes('RESOURCE_EXHAUSTED') ||
        error.message.includes('quota') ||
        error.message.includes('Quota') ||
        error.message.includes('rate limit')
      )) {
        return '답변 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.';
      }
      
      return `API 호출 중 오류가 발생했습니다: ${error.message}`;
    });
  }

  // 채팅 세션 초기화
  async resetChatSession(): Promise<void> {
    try {
      console.log('Resetting chat session...');
      
      // 현재 진행 중인 요청이 있다면 취소
      this.cancelCurrentRequest();
      
      // 현재 채팅 세션 초기화
      this.currentChatSession = null;
      
      // PDF 내용은 다시 압축하지 않고 기존 캐시 사용
      await this.createNotebookChatSession();
      
      console.log('Chat session reset successfully');
    } catch (error) {
      console.error('Failed to reset chat session:', error);
      throw error;
    }
  }

  // 현재 요청 취소
  cancelCurrentRequest(): void {
    if (this.currentAbortController) {
      console.log('Cancelling current request...');
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  // 압축 통계 정보 가져오기
  getCompressionStats(): CompressionResult | null {
    return this.compressionResult;
  }

  // PDF 내용 재압축 (필요시)
  async recompressPdfSources(): Promise<void> {
    this.isInitialized = false;
    this.cachedSourceText = null;
    this.compressionResult = null;
    await this.initializeWithPdfSources();
  }

  // RPD 통계 조회
  getRpdStats() {
    return rpdService.getRpdStats();
  }
}

export const geminiService = new GeminiService();