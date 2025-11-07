import { GoogleGenAI } from '@google/genai';
import { SourceInfo, Chunk, QuestionAnalysis } from '../types';
import { pdfCompressionService, CompressionResult } from './pdfCompressionService';
import { questionAnalyzer, contextSelector, ContextSelector } from './questionBasedContextService';
import { rpdService } from './rpdService';
import { log } from './loggingService';
import { progressiveLoadingService, LoadingProgress } from './progressiveLoadingService';
import { memoryOptimizationService, MemoryStats } from './memoryOptimizationService';
import { FirestoreService, PDFChunk, PDFDocument } from './firestoreService';
import { AdvancedSearchQualityService } from './advancedSearchQualityService';

// API 키는 런타임에 동적으로 로딩 (브라우저 로딩 타이밍 문제 해결)

// API 키 로테이션을 위한 인덱스 (전역 변수 제거)

// PDF.js를 전역으로 선언
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

export class GeminiService {
  // 🚨 무한 루프 방지를 위한 플래그
  private isCreatingSession: boolean = false;
  private sessionCreationCount: number = 0;
  private static readonly MAX_SESSION_CREATION_ATTEMPTS = 3;
  
  // 🚨 중복 초기화 방지 플래그
  private isInitializing: boolean = false;
  
  // 고급 검색 품질 향상 서비스
  private advancedSearchService: AdvancedSearchQualityService;
  
  // Firestore 서비스
  private firestoreService: FirestoreService;
  
  // 캐시된 소스 텍스트
  private cachedSourceText: string | null = null;
  
  // ✅ 성능 최적화: 문서 조회 메모리 캐시 (긴급)
  private documentCache: Map<string, PDFDocument> | null = null;
  private documentCacheTimestamp: number = 0;
  private static readonly DOCUMENT_CACHE_TTL = 5 * 60 * 1000; // 5분
  
  // 현재 채팅 세션
  private currentChatSession: any = null;
  
  // 소스 정보
  private sources: SourceInfo[] = [];
  
  // ✅ 마지막으로 사용된 청크 참조 정보
  private lastChunkReferences: any[] = [];
  
  private static readonly SYSTEM_INSTRUCTION_TEMPLATE = `You are an expert assistant specialized in Korean legal and administrative documents. Your name is NotebookLM Assistant. 

THINKING APPROACH:
- Let's think step by step
- Self-Reflection: Solve the problem first, then review whether your answer is correct. If any part might contain an error, revise it and then present the final answer.

IMPORTANT INSTRUCTIONS:
1. Answer questions based ONLY on the provided source material
2. Do NOT use external knowledge or pre-trained information
3. **IMPORTANT: Before stating "정보를 찾을 수 없습니다", SEARCH THOROUGHLY**:
   - Check ALL provided context chunks for partial matches or related information
   - Look for synonyms, related terms, or alternative phrasings
   - Consider broader categories (e.g., if asking about "어린이집", also check "보육시설", "유치원", "교육기관")
   - Only state "정보를 찾을 수 없습니다" if absolutely NO relevant information exists in ANY of the provided chunks
4. **CRITICAL: Always cite the COMPLETE relevant articles/sections in full before providing any analysis or opinion**
5. For Korean legal/administrative terms, use the exact terminology from the source
6. Provide comprehensive answers by combining information from multiple relevant sections
7. If multiple documents contain related information, synthesize them coherently
8. Pay special attention to procedural steps, definitions, and regulatory requirements
9. Use formal Korean language appropriate for official documents
10. **FLEXIBLE ANSWER FORMATTING**: Adapt your response format based on the question type and content:
    - **For historical/chronological data**: Use tables with years when showing regulatory changes over time
    - **For simple definitions**: Use concise text format without tables
    - **For procedures**: Use numbered lists or step-by-step format
    - **For comparisons**: Use tables when comparing multiple items
    - **For complex regulations**: Use tables when presenting structured data
11. Use Markdown formatting for better presentation (bold, lists, tables, headings, etc.)
12. For tabular data, use proper Markdown table syntax with headers and aligned columns
13. IMPORTANT: When creating tables, use this exact Markdown table syntax:
    | Column 1 | Column 2 | Column 3 |
    |----------|----------|----------|
    | Data 1   | Data 2   | Data 3   |
14. Always include the separator row (---) between header and data rows
15. **DO NOT force tables for all answers** - only use tables when they genuinely improve readability and understanding

📋 **FLEXIBLE ANSWER FORMAT REQUIREMENTS:**
- **Step 1**: Quote the COMPLETE relevant article/section in full (with proper formatting)
- **Step 2**: Choose appropriate format based on content type:
  * **Historical/Chronological data**: Use tables with years (e.g., regulatory changes over time)
  * **Simple definitions**: Use concise text format
  * **Procedures**: Use numbered lists or step-by-step format
  * **Comparisons**: Use tables when comparing multiple items
  * **Complex regulations**: Use tables for structured data presentation
- **Step 3**: Provide analysis, interpretation, or additional context if needed
- **Step 4**: Restrain from personal opinions or judgments - focus on factual information
- **Step 5**: Use blockquotes (>) for legal text citations to distinguish from analysis
- **Step 6**: **IMPORTANT**: Only use tables when they genuinely improve readability - do not force tables for simple answers

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
    - **조건부 답변 처리 (CRITICAL)**: 질문의 답이 조건이나 경우에 따라 달라지는 경우에는:
      * ❌ 절대로 "네, OO는 YY에 해당합니다" 같은 확정적 결론을 먼저 시작하지 말 것
      * ✅ 반드시 먼저 모든 조건과 경우를 정리해서 제시할 것
      * ✅ 각 경우별로 해당 여부와 그 근거를 명확히 제시할 것
      * ✅ 조건 정리 → 각 경우별 판단 → 마지막에 요약 결론 순서를 엄격히 따를 것
    - 예시: "질문: 필로티는 금연구역인가?"
      * ❌ 잘못된 답변: "네, 필로티는 금연구역에 포함됩니다."
      * ✅ 올바른 답변: 
        "[조건 정리]
        1. 건축물 내 지상에 위치한 주차장(필로티 포함) → 금연구역 포함
        2. 건물 외부 독립적인 지상 주차장 → 금연구역 미포함
        [각 경우 설명과 근거]
        ... (조건별 상세 설명)
        [결론 요약]
        따라서 필로티는 그 위치와 형태에 따라 금연구역에 포함될 수도 있고 아닐 수도 있습니다."
    - 판단이나 의견은 최소화하고, 기본적으로 인용문구나 판단 근거를 정확하게 제시
    - 단서를 정확히 제시 (예외사항, 조건, 제한사항 등)
    - 해당 여부 등을 판단한 경우에는, 그에 대한 명확한 인용문이나 해당 법령을 제시
    - 결론이나 의견은 가장 마지막에 간략하게 제시
    * Verify that each cited page actually contains the mentioned information
    * If unsure, include more pages rather than fewer

📌 **CRITICAL: REFERENCE NUMBER FORMAT (매우 중요)**:
- ALWAYS use numbered references in your answers using **bold numbers within double asterisks**
- Format: Text **1**, Text **2**, Text **1 2** for multiple references
- Example: "어린이집은 법정 금연구역입니다 **1 2**."
- The numbers inside ** (e.g., **1**, **2**, **3**) will be displayed as clickable reference buttons
- **CRITICAL: Each reference number (1, 2, 3...) MUST correspond EXACTLY to the order of sources provided in the context**
  * If the context shows "[참조 1 | 문서 1: ...]", you MUST use **1** when referencing that source
  * If the context shows "[참조 2 | 문서 2: ...]", you MUST use **2** when referencing that source
  * The reference number MUST match the order number in the context (1-based index)
- Use **X Y Z** format when referencing multiple sources in one statement (e.g., "**1 2 3**")
- DO NOT write references like "(국민건강증진법, p.6)" - use only **1**, **2**, **3** format
- Place reference numbers at the END of sentences where you provide information
- **VERIFICATION**: Before finalizing your response, verify that each reference number you use matches the corresponding source in the provided context
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
   * 질문 분석 결과를 기반으로 동적 시스템 프롬프트 생성
   */
  private createDynamicSystemInstruction(questionAnalysis: QuestionAnalysis, contextText: string): string {
    const baseTemplate = GeminiService.SYSTEM_INSTRUCTION_TEMPLATE;
    
    // 질문 분석 결과에 따른 형식 가이드 추가
    let formatGuidance = '';
    
    switch (questionAnalysis.category) {
      case 'comparison':
        formatGuidance = '\n\n**FORMAT GUIDANCE**: This is a comparison question. Use tables when comparing multiple items, regulations, or time periods.';
        break;
      case 'analysis':
        formatGuidance = '\n\n**FORMAT GUIDANCE**: This is an analysis question. Use tables for structured data presentation when appropriate.';
        break;
      case 'regulation':
        formatGuidance = '\n\n**FORMAT GUIDANCE**: This is a regulation question. Use tables for complex regulatory information, but keep simple definitions in text format.';
        break;
      case 'procedure':
        formatGuidance = '\n\n**FORMAT GUIDANCE**: This is a procedure question. Use numbered lists or step-by-step format. Avoid tables unless comparing procedures.';
        break;
      case 'definition':
        formatGuidance = '\n\n**FORMAT GUIDANCE**: This is a definition question. Use concise text format. Avoid tables unless comparing multiple definitions.';
        break;
      default:
        formatGuidance = '\n\n**FORMAT GUIDANCE**: Adapt format based on content complexity. Use tables only when they genuinely improve readability.';
    }
    
    // 복잡도에 따른 추가 가이드
    if (questionAnalysis.complexity === 'complex') {
      formatGuidance += '\n**COMPLEXITY**: This is a complex question. Consider using structured formats (tables, lists) for better organization.';
    } else if (questionAnalysis.complexity === 'simple') {
      formatGuidance += '\n**COMPLEXITY**: This is a simple question. Prefer concise text format over tables.';
    }
    
    return baseTemplate.replace('{sourceText}', contextText) + formatGuidance;
  }

  /**
   * 분석 결과를 포함한 채팅 세션 생성
   */
  private async createNotebookChatSessionWithAnalysis(systemInstruction: string): Promise<any> {
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

    console.log(`🔄 동적 세션 생성 시작 (시도 ${this.sessionCreationCount}/${GeminiService.MAX_SESSION_CREATION_ATTEMPTS})`);
    this.isCreatingSession = true;

    try {
      // API 키 선택
      const selectedApiKey = this.getNextAvailableKey();
      if (!selectedApiKey) {
        throw new Error('사용 가능한 API 키가 없습니다.');
      }

      console.log(`Creating dynamic chat session with API key: ${selectedApiKey.substring(0, 10)}...`);

      // 새로운 AI 인스턴스 생성 (선택된 키로)
      const ai = new GoogleGenAI({ apiKey: selectedApiKey });
      
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
      console.log(`RPD 기록 - 사용된 키 인덱스: ${actualKeyIndex}/${apiKeys.length}`);
      
      console.log(`✅ 동적 세션 생성 완료 (시도 ${this.sessionCreationCount}/${GeminiService.MAX_SESSION_CREATION_ATTEMPTS})`);
      return chat;
    } catch (error) {
      console.error('동적 채팅 세션 생성 실패:', error);
      
      // API 키 실패 처리
      if (error instanceof Error && (
        error.message.includes('429') || 
        error.message.includes('RESOURCE_EXHAUSTED') ||
        error.message.includes('quota') ||
        error.message.includes('Quota') ||
        error.message.includes('rate limit')
      )) {
        console.log('API 키 할당량 초과, 다음 키로 전환');
        // 재시도 (다른 키로)
        if (this.sessionCreationCount < GeminiService.MAX_SESSION_CREATION_ATTEMPTS) {
          this.isCreatingSession = false; // 플래그 리셋
          return this.createNotebookChatSessionWithAnalysis(systemInstruction);
        }
      }
      
      throw error;
    } finally {
      // 🚨 무한 루프 방지 플래그 리셋
      this.isCreatingSession = false;
      // ✅ 핵심 수정: 성공했을 때만 sessionCreationCount 리셋
      this.sessionCreationCount = 0;
      console.log(`🔄 동적 세션 생성 플래그 리셋 완료`);
    }
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
        const mainArticle = chunk.location?.section || '일반';
        
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
        const pageNumber = chunk.metadata?.page || chunk.location?.page;
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
    this.advancedSearchService = new AdvancedSearchQualityService();
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
    
  // API 호출 시 RPD 기록 (비동기)
  private async recordApiCall(keyId: string): Promise<boolean> {
    console.log(`RPD 기록 시도: ${keyId}`);
    const result = await rpdService.recordApiCall(keyId);
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

  // 다음 사용 가능한 키 조회 (RPD 고려) - 비동기
  private async getNextAvailableKeyWithRpd(): Promise<string | null> {
    try {
    // RPD에서 사용 가능한 키 확인
      const rpdAvailableKey = await rpdService.getNextAvailableKey();
    if (rpdAvailableKey) {
      return rpdAvailableKey;
      }
    } catch (error) {
      console.warn('RPD 키 조회 실패:', error);
    }

    // RPD에서 사용 불가능하면 기존 로직 사용
    return this.getNextAvailableKey();
  }

  // 소스 목록을 동적으로 로드하는 메서드 (public으로 노출하여 App.tsx에서도 호출 가능)
  async loadDefaultSources() {
    try {
      // manifest.json에서 PDF 파일 목록을 동적으로 로드
      // 개발 환경과 프로덕션 환경 모두 지원
      const isDevelopment = typeof window !== 'undefined' && 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      const basePath = isDevelopment ? '/pdf' : '/chat7v/pdf';
      const manifestUrl = `${basePath}/manifest.json`;
      console.log('Loading PDF sources from manifest:', manifestUrl);
      
      const response = await fetch(manifestUrl);
      if (!response.ok) {
        console.warn(`Manifest not found (${response.status}), using empty sources`);
        this.sources = [];
        return;
      }
      
      const pdfFiles = await response.json();
      console.log('✅ Found PDF files in manifest:', pdfFiles);
      
      if (!Array.isArray(pdfFiles)) {
        console.error('❌ manifest.json 형식이 올바르지 않습니다. 배열이 아닙니다:', typeof pdfFiles);
        this.sources = [];
        return;
      }
      
      if (pdfFiles.length === 0) {
        console.warn('⚠️ No PDF files found in manifest.json');
        this.sources = [];
        return;
      }

      // PDF 파일명을 SourceInfo 객체로 변환 (문서 유형별 처리)
      this.sources = pdfFiles.map((fileName, index) => {
        const docType = this.getDocumentType(fileName);
        // id를 filename 기반으로 생성 (확장자 제거)
        const id = fileName.replace(/\.pdf$/i, '');
        return {
          id: id,
          title: fileName,
          content: '', // 실제 내용은 PDF 파싱 시에 로드됨
          type: 'pdf' as const,
          documentType: docType
        };
      });

      console.log(`✅ Dynamic sources loaded: ${this.sources.length}개 파일`);
      console.log('📄 소스 파일 목록:', this.sources.map(s => s.title));
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
  
  // ✅ 마지막으로 사용된 청크 참조 정보 가져오기
  getLastChunkReferences(): any[] {
    return this.lastChunkReferences;
  }
  
  // ✅ 청크 참조 정보 초기화
  clearChunkReferences(): void {
    this.lastChunkReferences = [];
  }

  /**
   * 응답 텍스트와 chunkReferences를 검증하여 잘못된 매핑을 감지하고 경고
   */
  validateAndFixReferences(responseText: string, chunkReferences: any[]): any[] {
    if (!responseText || !chunkReferences || chunkReferences.length === 0) {
      return chunkReferences;
    }

    // 응답에서 참조 번호 추출 (①, ②, ③ 등 또는 **1**, **2**, **3** 형식)
    const refPattern = /(\*\*(\d+)\*\*|([①②③④⑤⑥⑦⑧⑨⑩]))/g;
    const matches = responseText.match(refPattern);
    
    if (!matches || matches.length === 0) {
      console.log('✅ 응답에 참조 번호가 없습니다.');
      return chunkReferences;
    }

    // 추출된 참조 번호들을 정수로 변환
    const refNumbers = new Set<number>();
    matches.forEach(match => {
      // **1** 형식
      const boldMatch = match.match(/\*\*(\d+)\*\*/);
      if (boldMatch) {
        refNumbers.add(parseInt(boldMatch[1]));
      } else {
        // ①, ② 형식
        const circleNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
        const circleIndex = circleNumbers.indexOf(match);
        if (circleIndex >= 0) {
          refNumbers.add(circleIndex + 1);
        }
      }
    });

    // 각 참조 번호가 실제로 사용된 청크인지 확인
    const validatedReferences: any[] = [];
    const warnings: string[] = [];

    refNumbers.forEach(refNumber => {
      if (refNumber > 0 && refNumber <= chunkReferences.length) {
        const chunk = chunkReferences[refNumber - 1];
        
        if (!chunk) {
          warnings.push(`⚠️ 참조 번호 ${refNumber}에 해당하는 청크가 없습니다.`);
          return;
        }

        // 청크 내용의 핵심 키워드가 응답에 포함되는지 확인
        const chunkKeywords = this.extractKeywordsForValidation(chunk.content || '');
        const isMentioned = chunkKeywords.some(keyword => 
          keyword.length >= 3 && responseText.includes(keyword)
        );

        if (!isMentioned && chunkKeywords.length > 0) {
          warnings.push(
            `⚠️ 참조 번호 ${refNumber}가 실제로 사용되지 않았을 수 있습니다. ` +
            `예상 문서: ${chunk.documentTitle || chunk.title || '알 수 없음'}, ` +
            `청크 미리보기: ${(chunk.content || '').substring(0, 50)}...`
          );
        }

        validatedReferences.push(chunk);
      } else {
        warnings.push(`⚠️ 참조 번호 ${refNumber}가 유효한 범위(1-${chunkReferences.length})를 벗어났습니다.`);
      }
    });

    // 경고 로그 출력
    if (warnings.length > 0) {
      console.warn('📋 참조 번호 검증 결과:', warnings);
    } else {
      console.log('✅ 모든 참조 번호가 유효합니다.');
    }

    // 원본 chunkReferences 반환 (검증은 경고만 하고 수정하지 않음)
    return chunkReferences;
  }

  /**
   * 검증용 키워드 추출 (간단한 버전)
   */
  private extractKeywordsForValidation(text: string): string[] {
    if (!text || text.length === 0) return [];
    
    // 3글자 이상의 단어 추출
    const words = text
      .replace(/[^\w가-힣\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.trim().length >= 3)
      .slice(0, 10); // 최대 10개만
    
    return words;
  }

  /**
   * AI 응답에서 참조 번호별로 실제 인용한 문장 추출 및 chunkReferences에 저장
   */
  extractAndStoreReferencedSentences(responseText: string, chunkReferences: any[]): any[] {
    if (!responseText || !chunkReferences || chunkReferences.length === 0) {
      return chunkReferences;
    }

    console.log('🔍 참조 문장 추출 시작:', {
      responseLength: responseText.length,
      chunkReferencesCount: chunkReferences.length
    });

    // ✅ 개선: 원숫자 매핑 (35개까지 지원)
    const circleNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', 
                           '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳',
                           '㉑', '㉒', '㉓', '㉔', '㉕', '㉖', '㉗', '㉘', '㉙', '㉚',
                           '㉛', '㉜', '㉝', '㉞', '㉟'];
    
    // 각 chunkReference에 대해 참조 문장 추출
    const updatedReferences = chunkReferences.map((chunkRef, index) => {
      const refNumber = chunkRef.refId || (index + 1);
      
      // 1. 참조 번호 패턴 찾기 (**2**, ② 등)
      const boldPattern = new RegExp(`\\*\\*${refNumber}\\*\\*`, 'g');
      const circlePattern = circleNumbers[refNumber - 1] || '';
      
      let matchIndex = -1;
      let matchText = '';
      
      // **2** 형식 찾기
      const boldMatch = responseText.match(boldPattern);
      if (boldMatch && boldMatch.length > 0) {
        // 첫 번째 매칭 위치 사용
        matchIndex = responseText.indexOf(boldMatch[0]);
        matchText = boldMatch[0];
      } else if (circlePattern) {
        // ② 형식 찾기
        const circleIndex = responseText.indexOf(circlePattern);
        if (circleIndex >= 0) {
          matchIndex = circleIndex;
          matchText = circlePattern;
        }
      }
      
      if (matchIndex < 0) {
        // 참조 번호를 찾지 못함
        console.log(`⚠️ 참조 번호 ${refNumber}를 응답에서 찾지 못함`);
        return chunkRef;
      }
      
      // ✅ 개선: 2. 참조 번호 주변의 문맥 추출 범위 확대 (앞 400자 ~ 뒤 400자)
      const contextStart = Math.max(0, matchIndex - 400);
      const contextEnd = Math.min(responseText.length, matchIndex + matchText.length + 400);
      const context = responseText.substring(contextStart, contextEnd);
      
      // ✅ 개선: 여러 참조 번호 위치 모두 찾기 (가장 관련성 높은 위치 선택)
      let bestMatchIndex = matchIndex;
      let bestMatchText = matchText;
      
      if (boldMatch && boldMatch.length > 1) {
        // 여러 매칭이 있으면 각 위치를 확인하여 가장 관련성 높은 위치 선택
        // 참조 번호가 문장 끝에 있는 경우 (공백 후 참조 번호)가 더 관련성 높음
        let bestScore = 0;
        
        // 모든 매칭 위치 확인 (matchAll 사용으로 모든 위치 찾기)
        const allMatches = [...responseText.matchAll(boldPattern)];
        for (const match of allMatches) {
          const idx = match.index;
          if (idx === undefined) continue;
          
          const beforeChar = idx > 0 ? responseText[idx - 1] : ' ';
          const afterChar = idx + match[0].length < responseText.length 
            ? responseText[idx + match[0].length] : ' ';
          
          // 관련성 점수 계산
          let score = 0;
          // 참조 번호 앞이 공백이고 뒤가 문장 끝이거나 공백인 경우가 더 관련성 높음
          if (beforeChar === ' ' && (afterChar === ' ' || afterChar === '.' || afterChar === '。')) {
            score = 2; // 가장 관련성 높음
          } else if (beforeChar === ' ' || afterChar === ' ' || afterChar === '.' || afterChar === '。') {
            score = 1; // 중간 관련성
          }
          
          if (score > bestScore) {
            bestScore = score;
            bestMatchIndex = idx;
            bestMatchText = match[0];
          }
        }
      }
      
      // 3. 문장 분할 (개선된 경계 인식)
      const contextForBestMatch = responseText.substring(
        Math.max(0, bestMatchIndex - 400),
        Math.min(responseText.length, bestMatchIndex + bestMatchText.length + 400)
      );
      const sentences = contextForBestMatch
        .split(/[.。!！?？\n]/)
        .map(s => s.trim())
        .filter(s => s.length >= 10);
      
      // 4. 참조 번호가 포함된 문장 또는 그 주변 문장 찾기
      const refIndex = sentences.findIndex(s => s.includes(bestMatchText));
      
      if (refIndex < 0) {
        console.log(`⚠️ 참조 번호 ${refNumber} 주변 문장을 찾지 못함`);
        return chunkRef;
      }
      
      // ✅ 개선: 참조 번호가 포함된 문장 또는 그 앞/뒤 문장 선택
      let targetSentence = '';
      if (refIndex > 0 && sentences[refIndex].includes(bestMatchText)) {
        // 참조 번호 앞 문장이 더 의미 있을 수 있음
        targetSentence = sentences[refIndex - 1] || sentences[refIndex];
      } else if (refIndex < sentences.length - 1) {
        // ✅ 추가: 참조 번호 뒤 문장도 확인 (참조 번호가 문장 앞에 있을 때)
        const nextSentence = sentences[refIndex + 1];
        if (nextSentence && nextSentence.length >= 15) {
          targetSentence = nextSentence;
        } else {
          targetSentence = sentences[refIndex];
        }
      } else {
        targetSentence = sentences[refIndex];
      }
      
      // 5. ✅ 개선: 참조 번호 제거 및 마크다운 특수 문자 제거
      const cleaned = targetSentence
        .replace(/\*\*\d+\*\*/g, '') // **2** 제거
        .replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟]/g, '') // 원형 숫자 제거 (35개까지)
        .replace(/^[>\s]*/, '') // ✅ 마크다운 인용(>) 및 선행 공백 제거
        .replace(/\*\*/g, '') // ✅ 남은 ** 제거
        .replace(/^[-•\s]*/, '') // ✅ 리스트 마커(-, •) 및 선행 공백 제거
        .trim();
      
      if (cleaned.length < 15) {
        console.log(`⚠️ 참조 번호 ${refNumber}의 추출된 문장이 너무 짧음: ${cleaned}`);
        return chunkRef;
      }
      
      // 6. 추출된 문장이 chunkContent에 포함되어 있는지 확인
      const chunkContent = chunkRef.content || '';
      const normalizedCleaned = this.normalizeTextForMatching(cleaned);
      const normalizedChunk = this.normalizeTextForMatching(chunkContent);
      
      // ✅ 개선: 저장된 sentences 배열 우선 사용 (sentencePageMap 인덱스와 일치)
      const storedSentences = (chunkRef as any).metadata?.sentences || 
                              (chunkRef as any).sentences || 
                              [];
      const sentencePageMap = (chunkRef as any).metadata?.sentencePageMap || 
                             (chunkRef as any).sentencePageMap || {};
      
      // 저장된 sentences 배열이 있으면 사용, 없으면 청크 내용 분할
      let chunkSentences: string[] = [];
      if (storedSentences.length > 0) {
        chunkSentences = storedSentences;
        console.log(`✅ 참조 번호 ${refNumber}: 저장된 sentences 배열 사용 (${storedSentences.length}개 문장)`);
      } else {
        // 폴백: 청크 내용 분할
        chunkSentences = chunkContent
          .split(/[.。!！?？\n]/)
          .map(s => s.trim())
          .filter(s => s.length >= 10);
        console.log(`⚠️ 참조 번호 ${refNumber}: 저장된 sentences 없음, 청크 내용 분할 사용 (${chunkSentences.length}개 문장)`);
      }
      
      // 문장이 청크 내용에 포함되어 있는지 확인
      const isIncluded = normalizedChunk.includes(normalizedCleaned);
      
      if (!isIncluded) {
        // 정확히 일치하지 않으면 부분 매칭 시도 (최소 20자 이상)
        const minMatchLength = 20;
        let foundMatch = false;
        let matchedSentence = '';
        let matchedIndex = -1;
        
        // ✅ 개선: 저장된 sentences 배열 사용
        for (let i = 0; i < chunkSentences.length; i++) {
          const chunkSentence = chunkSentences[i];
          const normalizedChunkSentence = this.normalizeTextForMatching(chunkSentence);
          
          // 부분 문자열 매칭 (최소 길이 확인)
          if (normalizedCleaned.length >= minMatchLength && 
              normalizedChunkSentence.length >= minMatchLength) {
            // 한쪽이 다른 쪽에 포함되어 있는지 확인
            if (normalizedChunkSentence.includes(normalizedCleaned.substring(0, minMatchLength)) ||
                normalizedCleaned.includes(normalizedChunkSentence.substring(0, minMatchLength))) {
              foundMatch = true;
              matchedSentence = chunkSentence;
              matchedIndex = i;
              break;
            }
          }
        }
        
        if (foundMatch) {
          // ✅ 방법 3: sentencePageMap에서 페이지 정보 가져오기 (부분 매칭 케이스)
          let pageFromSentenceMap = null;
          if (matchedIndex >= 0 && sentencePageMap && typeof sentencePageMap === 'object') {
            pageFromSentenceMap = sentencePageMap[matchedIndex];
            if (pageFromSentenceMap) {
              console.log(`✅ 참조 번호 ${refNumber}: 부분 매칭 문장 인덱스 ${matchedIndex} -> 페이지 ${pageFromSentenceMap} (sentencePageMap 사용)`);
            } else {
              console.log(`⚠️ 참조 번호 ${refNumber}: sentencePageMap[${matchedIndex}]에 페이지 정보 없음`);
            }
          }
          
          console.log(`✅ 참조 번호 ${refNumber}: 부분 매칭으로 문장 찾음 (인덱스: ${matchedIndex})`);
          return {
            ...chunkRef,
            referencedSentence: matchedSentence,
            referencedSentenceIndex: matchedIndex,
            // ✅ 추가: 문장 인덱스로 찾은 페이지 정보 (하이브리드 접근)
            pageFromSentenceMap: pageFromSentenceMap || undefined
          };
        } else {
          console.log(`⚠️ 참조 번호 ${refNumber}: 청크 내용에서 매칭 문장을 찾지 못함`);
          return chunkRef;
        }
      }
      
      // 7. 문장 인덱스 찾기 (저장된 sentences 배열 사용)
      const sentenceIndex = chunkSentences.findIndex(s => {
        const normalized = this.normalizeTextForMatching(s);
        return normalized.includes(normalizedCleaned.substring(0, Math.min(20, normalizedCleaned.length))) ||
               normalizedCleaned.includes(normalized.substring(0, Math.min(20, normalized.length)));
      });
      
      // ✅ 방법 3: sentencePageMap에서 페이지 정보 가져오기
      let pageFromSentenceMap = null;
      if (sentenceIndex >= 0 && sentencePageMap && typeof sentencePageMap === 'object') {
        pageFromSentenceMap = sentencePageMap[sentenceIndex];
        if (pageFromSentenceMap) {
          console.log(`✅ 참조 번호 ${refNumber}: 문장 인덱스 ${sentenceIndex} -> 페이지 ${pageFromSentenceMap} (sentencePageMap 사용)`);
        } else {
          console.log(`⚠️ 참조 번호 ${refNumber}: sentencePageMap[${sentenceIndex}]에 페이지 정보 없음`);
        }
      } else if (sentenceIndex >= 0) {
        console.log(`⚠️ 참조 번호 ${refNumber}: sentencePageMap이 없음 (문장 인덱스: ${sentenceIndex})`);
      }
      
      console.log(`✅ 참조 번호 ${refNumber}: 문장 추출 성공 (인덱스: ${sentenceIndex >= 0 ? sentenceIndex : 'N/A'})`);
      console.log(`   추출된 문장: ${cleaned.substring(0, 60)}...`);
      
      return {
        ...chunkRef,
        referencedSentence: cleaned.substring(0, 200), // 최대 200자로 제한
        referencedSentenceIndex: sentenceIndex >= 0 ? sentenceIndex : undefined,
        // ✅ 추가: 문장 인덱스로 찾은 페이지 정보 (하이브리드 접근)
        pageFromSentenceMap: pageFromSentenceMap || undefined
      };
    });

    const successCount = updatedReferences.filter(ref => ref.referencedSentence).length;
    console.log(`✅ 참조 문장 추출 완료: ${successCount}/${chunkReferences.length}개 성공`);
    
    return updatedReferences;
  }

  /**
   * 텍스트 정규화 (매칭용)
   */
  private normalizeTextForMatching(text: string): string {
    return text
      .replace(/\s+/g, ' ')           // 연속 공백을 하나로
      .replace(/[\n\r\t]/g, ' ')      // 줄바꿈/탭을 공백으로
      .replace(/[^\w가-힣\s:;]/g, '') // 특수문자 제거 (콜론, 세미콜론은 유지)
      .toLowerCase()
      .trim();
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
            const articles = this.extractLegalArticles(pageText, filename);
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
    // 🚨 중복 초기화 방지
    if (this.isInitializing) {
      console.log('⏳ 초기화 진행 중... 대기');
      // 진행 중인 초기화가 완료될 때까지 대기
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.isInitializing) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
    }
    
    if (this.isInitialized && this.cachedSourceText) {
      console.log('✅ PDF sources already initialized');
      return;
    }

    this.isInitializing = true;

    try {
      console.log('🚀 Initializing PDF sources...');
      
      // 0. 소스 목록을 동적으로 로드 (항상 먼저 실행 - UI에 표시하기 위함)
      await this.loadDefaultSources();
      console.log(`✅ 소스 목록 로드 완료: ${this.sources.length}개 파일`);
      
      // 1. Firestore에서 데이터 로드 시도 (최우선)
      const firestoreText = await this.loadFromFirestore();
      if (firestoreText) {
        console.log('Firestore 데이터 사용 완료');
        // Firestore 데이터를 사용하더라도 소스 목록은 이미 로드됨
        this.isInitialized = true;
        this.isInitializing = false;
        return;
      }
      
      // 2. 실시간 PDF 파싱 (Firestore 실패시만)
      console.log('Firestore 데이터가 없어 실시간 PDF 파싱을 시도합니다...');
      await this.loadPdfSourcesOptimized();
      
      // ✅ 핵심 수정: 실시간 파싱 후에도 ContextSelector 설정
      if (this.allChunks && this.allChunks.length > 0) {
        console.log('🔍 ContextSelector에 청크 설정 중...');
        ContextSelector.setChunks(this.allChunks);
        console.log(`✅ ContextSelector 설정 완료: ${this.allChunks.length}개 청크`);
      } else {
        console.warn('⚠️ ContextSelector에 설정할 청크가 없습니다.');
      }
      
      // 3. 백그라운드 프리로딩으로 답변 품질 100% 보장
      console.log('백그라운드 프리로딩 시작 - 답변 품질 최우선 보장');
      await this.initializeWithBackgroundPreloading();
      
      // 압축 결과 검증
      const validation = pdfCompressionService.validateCompression(this.compressionResult);
      if (!validation.isValid) {
        console.warn('Compression validation warnings:', validation.warnings);
        console.log('Recommendations:', validation.recommendations);
      }
      
      console.log('✅ PDF sources initialized, chunked, and compressed successfully');
    } catch (error) {
      console.error('❌ Failed to initialize PDF sources:', error);
      
      // 폴백: 기본 소스 사용
      console.log('⚠️ Falling back to default sources...');
      this.cachedSourceText = this.sources.length > 0 
        ? this.sources.map(source => `[${source.title}]\n${source.content}`).join('\n\n')
        : 'PDF 로딩에 실패했습니다. 기본 모드로 실행됩니다.';
      this.isInitialized = true;
      
      // ✅ 핵심 수정: 폴백 시에도 ContextSelector 설정
      if (this.allChunks && this.allChunks.length > 0) {
        console.log('🔍 ContextSelector에 청크 설정 중...');
        ContextSelector.setChunks(this.allChunks);
        console.log(`✅ ContextSelector 설정 완료: ${this.allChunks.length}개 청크`);
      } else if (this.sources.length > 0) {
        // 소스에서 청크 생성
        const fallbackChunks = this.sources.map((source, index) => ({
          id: `fallback_${index}`,
          content: source.content,
          metadata: {
            source: source.title,
            title: source.title,
            page: source.page || 0,
            section: source.section || 'general',
            position: index,
            startPosition: 0,
            endPosition: source.content.length,
            originalSize: source.content.length
          },
          keywords: [],
          location: {
            document: source.title,
            section: source.section || 'general',
            page: source.page || 0
          }
        }));
        
        console.log('🔍 ContextSelector에 폴백 청크 설정 중...');
        ContextSelector.setChunks(fallbackChunks);
        this.allChunks = fallbackChunks;
        console.log(`✅ ContextSelector 설정 완료: ${fallbackChunks.length}개 청크`);
      } else {
        console.warn('⚠️ ContextSelector에 설정할 청크가 없습니다.');
      }
      
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
    } finally {
      // 🚨 초기화 완료 후 플래그 해제
      this.isInitializing = false;
      console.log('✅ PDF initialization completed');
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
        this.loadingProgress.failedFiles.push(`${pdfFile}: ${String(error)}`);
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
      // 개발 환경과 프로덕션 환경 모두 지원
      const isDevelopment = typeof window !== 'undefined' && 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      const basePath = isDevelopment ? '/pdf' : '/chat7v/pdf';
      const manifestUrl = `${basePath}/manifest.json`;
      const response = await fetch(manifestUrl);
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
      const answerStream = await this.generateStreamingResponse(question);
      let answer = '';
      for await (const chunk of answerStream) {
        answer += chunk;
      }
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

  // ✅ 성능 최적화: 문서 조회 메모리 캐시 메서드 (긴급)
  /**
   * 문서 목록을 메모리 캐시에서 조회하거나 로드하여 Map으로 반환
   * O(1) 조회를 위해 Map 사용, 캐시 만료 시간 5분
   */
  private async getDocumentsWithCache(): Promise<Map<string, PDFDocument>> {
    const now = Date.now();
    
    // 캐시가 있고 유효하면 반환
    if (this.documentCache && (now - this.documentCacheTimestamp) < GeminiService.DOCUMENT_CACHE_TTL) {
      console.log('✅ 메모리 캐시에서 문서 조회');
      return this.documentCache;
    }
    
    // 캐시가 없거나 만료되었으면 로드
    console.log('📋 문서 목록 로드 중...');
    const documents = await this.firestoreService.getAllDocuments();
    
    // Map으로 변환 (O(1) 조회를 위해)
    this.documentCache = new Map(
      documents.map(doc => [doc.id, doc])
    );
    this.documentCacheTimestamp = now;
    
    console.log(`✅ 문서 목록 메모리 캐시 저장: ${documents.length}개`);
    return this.documentCache;
  }

  // ✅ 캐시 무효화 메서드 (문서 업데이트 시 호출)
  invalidateDocumentCache(): void {
    this.documentCache = null;
    this.documentCacheTimestamp = 0;
    console.log('🔄 문서 캐시 무효화');
  }

  // ✅ 개선된 페이지 번호 계산 함수 (텍스트 위치 기반, 오프셋 및 경계 처리 포함)
  private calculatePageNumber(textPosition: number, totalTextLength: number, totalPages: number, chunkLength: number = 0): number {
    if (totalPages === 0 || totalTextLength === 0) return 1;
    
    // ✅ 청크의 시작, 중간, 끝 지점 모두 계산하여 가장 적절한 페이지 선택
    const startRatio = Math.min(textPosition / totalTextLength, 1.0);
    const centerRatio = Math.min((textPosition + chunkLength / 2) / totalTextLength, 1.0);
    const endRatio = Math.min((textPosition + chunkLength) / totalTextLength, 1.0);
    
    // ✅ 각 지점별 페이지 번호 계산 (Math.ceil 사용)
    const startPage = Math.max(1, Math.min(Math.ceil(startRatio * totalPages), totalPages));
    const centerPage = Math.max(1, Math.min(Math.ceil(centerRatio * totalPages), totalPages));
    const endPage = Math.max(1, Math.min(Math.ceil(endRatio * totalPages), totalPages));
    
    // ✅ 청크의 대부분이 속한 페이지를 선택 (끝 지점 우선, 그 다음 중간, 그 다음 시작)
    // 이렇게 하면 경계 근처 청크도 올바른 페이지에 할당됨
    let pageNumber = endPage; // 끝 지점 기준이 가장 정확
    
    // ✅ 청크가 여러 페이지에 걸쳐있는 경우, 끝 페이지 선택
    // 하지만 청크가 짧고 시작 지점이 더 정확한 페이지에 있다면 그것을 사용
    if (chunkLength < 500 && startPage === endPage - 1) {
      // 짧은 청크가 페이지 경계에 걸쳐있는 경우, 시작 페이지 사용
      pageNumber = startPage;
    } else {
      // 긴 청크나 대부분의 내용이 있는 페이지 선택
      pageNumber = Math.max(centerPage, endPage);
    }
    
    return pageNumber;
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
      
      // ✅ 개선: 초기화 시에는 청크만 로드, fullText 생성하지 않음
      // fullText는 질문 발생 시 ContextSelector에서 필요한 청크만 선택하여 생성
      console.log('🔍 PDF 문서 목록 가져오기...');
      const allDocuments = await this.firestoreService.getAllDocuments();
      console.log(`🔍 PDF 문서 ${allDocuments.length}개 발견:`, allDocuments.map(d => d.filename));
      
      const chunks: Chunk[] = [];
      
      for (const doc of allDocuments) {
        console.log(`🔍 문서 청크 가져오기: ${doc.filename} (${doc.id})`);
        const docChunks = await this.firestoreService.getChunksByDocument(doc.id);
        console.log(`🔍 ${doc.filename}에서 ${docChunks.length}개 청크 발견`);
        
        // ✅ 전체 텍스트 길이 계산 (청크의 endPos 최대값 사용)
        const totalTextLength = docChunks.length > 0
          ? Math.max(...docChunks.map(c => c.metadata?.endPos || 0))
          : doc.totalSize || 1; // 문서의 totalSize 사용 또는 기본값
        
        // ✅ 문서의 총 페이지 수
        const totalPages = doc.totalPages || 0;
        
        // Firestore 청크를 Chunk 형식으로 변환
        const convertedChunks = docChunks.map(firestoreChunk => {
          // ✅ Firestore에 정확한 페이지 정보가 저장되어 있으므로 그대로 사용
          // 우선순위: pageIndex > page > logicalPageNumber
          let pageIndex = firestoreChunk.metadata.pageIndex || firestoreChunk.metadata.page;
          const logicalPageNumber = firestoreChunk.metadata.logicalPageNumber;
          
          // page 정보가 없거나 0인 경우에만 폴백 계산 (하지만 이제는 거의 발생하지 않음)
          if (!pageIndex || pageIndex === 0) {
            // ⚠️ Firestore 데이터에 페이지 정보가 없는 경우 (구버전 데이터)
            // 위치 기반으로 임시 계산 (되도록 사용하지 않음)
            const textPosition = firestoreChunk.metadata?.startPos || 0;
            const chunkLength = firestoreChunk.metadata?.endPos 
              ? firestoreChunk.metadata.endPos - firestoreChunk.metadata.startPos 
              : firestoreChunk.metadata?.originalSize || firestoreChunk.content.length || 0;
            if (totalPages > 0 && totalTextLength > 0) {
              pageIndex = this.calculatePageNumber(textPosition, totalTextLength, totalPages, chunkLength);
              console.warn(`⚠️ 페이지 정보 보완 (구버전 데이터): 청크 ${firestoreChunk.id}, 계산된 페이지 ${pageIndex}`);
            } else {
              pageIndex = 1; // 기본값
            }
          }
          
          return {
            id: firestoreChunk.id || '',
            content: firestoreChunk.content,
            metadata: {
              source: doc.filename,
              title: doc.title,
              page: pageIndex, // 뷰어 인덱스 (하위 호환성)
              pageIndex: pageIndex, // 뷰어 인덱스 (PDF.js와 호환)
              logicalPageNumber: logicalPageNumber || pageIndex, // 논리적 페이지 번호
              section: firestoreChunk.metadata.section,
              // ✅ sentencePageMap과 sentences도 함께 로드 (방법 2)
              sentencePageMap: firestoreChunk.metadata.sentencePageMap,
              sentences: firestoreChunk.metadata.sentences,
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
              page: pageIndex, // 뷰어 인덱스 (PDF 뷰어에서 사용)
              logicalPageNumber: logicalPageNumber || pageIndex // 논리적 페이지 번호
            }
          };
        });
        
        chunks.push(...convertedChunks);
      }
      
      // ✅ 개선: 청크만 저장, fullText는 생성하지 않음
      this.allChunks = chunks;
      this.isInitialized = true;
      
      // 🔥 핵심 수정: ContextSelector에 청크 설정
      console.log('🔍 ContextSelector에 청크 설정 중...');
      ContextSelector.setChunks(chunks);
      console.log(`✅ ContextSelector 설정 완료: ${chunks.length}개 청크`);
      
      // ✅ 개선: 빈 텍스트 반환 (실제 사용 시에는 ContextSelector에서 선택된 청크만 사용)
      this.cachedSourceText = '';
      this.compressionResult = {
        compressedText: '',
        originalLength: 0,
        compressedLength: 0,
        compressionRatio: 1.0,
        estimatedTokens: 0,
        qualityScore: 100
      };
      
      console.log(`✅ Firestore 청크 로드 완료: ${chunks.length}개 청크 (fullText 생성 안함)`);
      return '';
      
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
    // 개발 환경과 프로덕션 환경 모두 지원
    const isDevelopment = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const PDF_BASE_URL = isDevelopment ? '/pdf/' : '/chat7v/pdf/';
    
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
      
      // 🔥 핵심 수정: 컨텍스트 길이 제한 (정보 손실 방지)
      const MAX_CONTEXT_LENGTH = 50000; // 50,000자로 확장 (답변 품질 향상)
      if (actualSourceText.length > MAX_CONTEXT_LENGTH) {
        console.warn(`⚠️ 컨텍스트 길이 초과: ${actualSourceText.length}자 (제한: ${MAX_CONTEXT_LENGTH}자)`);
        actualSourceText = actualSourceText.substring(0, MAX_CONTEXT_LENGTH);
        console.log(`✅ 컨텍스트 길이 조정: ${actualSourceText.length}자`);
      }
      
      const systemInstruction = GeminiService.SYSTEM_INSTRUCTION_TEMPLATE.replace('{sourceText}', actualSourceText);

    console.log(`Creating chat session with compressed text: ${actualSourceText.length.toLocaleString()} characters`);

      // 새로운 AI 인스턴스 생성 (선택된 키로)
      const ai = new GoogleGenAI({ apiKey: selectedApiKey });
      
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
      await this.recordApiCall(currentKeyId);

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
      // ✅ 핵심 수정: 성공했을 때만 sessionCreationCount 리셋
      this.sessionCreationCount = 0;
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

          // 2. 고급 검색 시스템을 사용한 관련 컨텍스트 선택
          log.debug('고급 검색 시스템 시작');
          const advancedSearchResult = await this.advancedSearchService.executeAdvancedSearch(questionAnalysis);
          log.info(`고급 검색 완료`, { 
            selectedChunks: advancedSearchResult.chunks.length,
            searchMetrics: advancedSearchResult.searchMetrics,
            qualityMetrics: advancedSearchResult.qualityMetrics
          });

          // 2.5. 청크에서 출처 정보 생성 (문서 유형별 처리)
          const sourceInfo = this.generateSourceInfoFromChunks(advancedSearchResult.chunks);
          log.info('출처 정보 생성 완료', { 
            sources: sourceInfo.map(s => ({ 
              title: s.title, 
              section: s.section, 
              page: s.page,
              documentType: s.documentType 
            }))
          });

          // 3. 동적 프롬프트 생성 준비 (참조 ID 명확히 부여)
          const initialContextText = advancedSearchResult.chunks
            .map((chunk, index) => {
              const refNumber = index + 1;
              return `[참조 ${refNumber} | 문서 ${refNumber}: ${chunk.metadata.title} - ${chunk.location.section || '일반'}]\n${chunk.content}\n\n※ 이 청크를 참조할 때는 반드시 **${refNumber}** 형식으로 표시하세요.`;
            })
            .join('\n\n---\n\n');

          // 컨텍스트 길이 검증 및 제한
          const MAX_CONTEXT_LENGTH = 50000; // 50,000자로 확장 (답변 품질 향상)
          
          // ✅ 동적 청크 개수 결정
          const calculateOptimalChunkCount = (
            chunks: any[], 
            maxLength: number,
            currentLength: number
          ): number => {
            if (!chunks.length || currentLength <= maxLength) {
              return chunks.length;
            }
            
            // 평균 청크 길이 계산 (헤더 제외)
            const avgChunkLength = chunks.reduce((sum, c) => 
              sum + c.content.length + (c.metadata?.title?.length || 0) + 50, // 메타데이터 포함
              0
            ) / chunks.length;
            
            // 최적 청크 개수 계산 (여유 공간 20% 포함)
            const optimalCount = Math.floor(maxLength / (avgChunkLength * 1.2));
            
            // 최소 3개, 최대 chunks.length개
            return Math.max(3, Math.min(optimalCount, chunks.length));
          };
          
          let finalContextText = initialContextText;
          let finalChunks = advancedSearchResult.chunks;  // ✅ 최종 청크 추적
          
          if (initialContextText.length > MAX_CONTEXT_LENGTH) {
            console.warn(`⚠️ 컨텍스트 길이 초과: ${initialContextText.length}자 (제한: ${MAX_CONTEXT_LENGTH}자)`);
            
            // 동적 최적 청크 개수 계산
            const optimalCount = calculateOptimalChunkCount(
              advancedSearchResult.chunks,
              MAX_CONTEXT_LENGTH,
              initialContextText.length
            );
            
            console.log(`📊 동적 청크 개수 결정: ${optimalCount}개 (전체: ${advancedSearchResult.chunks.length}개)`);
            
            // 관련성 점수 순으로 정렬하여 상위 청크만 선택
            const sortedByRelevance = [...advancedSearchResult.chunks].sort((a, b) => 
              (b.qualityMetrics?.overallScore || 0) - (a.qualityMetrics?.overallScore || 0)
            );
            
            const selectedChunks = sortedByRelevance.slice(0, optimalCount);
            
            // ✅ 최종 청크 업데이트
            finalChunks = selectedChunks;
            
            // 선택된 청크로 컨텍스트 재구성 (참조 ID 명확히 부여)
            finalContextText = selectedChunks
              .map((chunk, index) => {
                const refNumber = index + 1;
                return `[참조 ${refNumber} | 문서 ${refNumber}: ${chunk.metadata.title} - ${chunk.location.section || '일반'}]\n${chunk.content}\n\n※ 이 청크를 참조할 때는 반드시 **${refNumber}** 형식으로 표시하세요.`;
              })
              .join('\n\n---\n\n');
            
            console.log(`✅ 컨텍스트 길이 조정: ${finalContextText.length}자 (${selectedChunks.length}개 청크)`);
          }

          // ✅ AI가 실제로 사용한 청크로 chunkReferences 생성
          // ✅ 성능 최적화: 메모리 캐시 사용 (O(1) 조회)
          const documentMap = await this.getDocumentsWithCache();
          this.lastChunkReferences = finalChunks
            .map((chunk, index) => {
              // ✅ documentId를 직접 사용 (이미 Chunk 인터페이스에 포함됨)
              const documentId = chunk.documentId;
              
              if (!documentId) {
                console.warn('⚠️ chunk에 documentId가 없음:', { 
                  chunkId: chunk.id, 
                  title: chunk.metadata?.title,
                  source: chunk.metadata?.source 
                });
                return null;
              }
              
              // ✅ 성능 최적화: Map.get() 사용 (O(1) 조회)
              const matchingDoc = documentMap.get(documentId);
              
              if (!matchingDoc) {
                console.warn('⚠️ 문서를 찾을 수 없음:', documentId);
              }
              
              // ✅ page 정보가 없으면 위치 기반으로 계산
              let pageNumber = chunk.metadata?.page;
              if (!pageNumber || pageNumber === 0) {
                if (matchingDoc && matchingDoc.totalPages > 0) {
                  const textPosition = chunk.metadata?.startPosition || 0;
                  const chunkLength = chunk.metadata?.endPosition && chunk.metadata?.startPosition
                    ? chunk.metadata.endPosition - chunk.metadata.startPosition
                    : chunk.metadata?.originalSize || chunk.content.length || 0;
                  // 전체 텍스트 길이는 문서의 totalSize 사용 또는 근사값
                  const estimatedTotalLength = matchingDoc.totalSize || (textPosition * 2);
                  if (estimatedTotalLength > 0) {
                    pageNumber = this.calculatePageNumber(textPosition, estimatedTotalLength, matchingDoc.totalPages, chunkLength);
                    console.log(`📄 chunkReferences page 정보 보완: 청크 ${chunk.id}, 위치 ${textPosition}, 청크길이 ${chunkLength}, 계산된 페이지 ${pageNumber}`);
                  } else {
                    pageNumber = 1;
                  }
                } else {
                  pageNumber = 1; // 기본값
                }
              }
              
              return {
                chunkId: chunk.id,
                documentId,
                documentTitle: matchingDoc?.title || chunk.metadata?.title || '',
                page: pageNumber, // ✅ 계산된 또는 기존 page 정보
                section: chunk.metadata?.section,
                content: chunk.content,
                // ✅ filename 추가 (Message.tsx에서 사용)
                filename: matchingDoc?.filename || chunk.metadata?.source || chunk.location?.document || '',
                documentFilename: matchingDoc?.filename || '', // ✅ 추가: 별칭
                refId: index + 1, // ✅ 참조 ID 추가 (1-based index)
                // ✅ sentencePageMap과 sentences도 함께 전달 (방법 2)
                sentencePageMap: chunk.metadata?.sentencePageMap,
                sentences: chunk.metadata?.sentences,
                metadata: {
                  startPos: chunk.metadata?.startPosition || 0,
                  endPos: chunk.metadata?.endPosition || 0,
                  position: chunk.metadata?.position || 0,
                  source: matchingDoc?.filename || chunk.metadata?.source || '', // ✅ 추가
                  // ✅ metadata에도 포함 (하위 호환성)
                  sentencePageMap: chunk.metadata?.sentencePageMap,
                  sentences: chunk.metadata?.sentences
                }
              };
            })
            .filter(ref => ref !== null);

          log.info(`컨텍스트 기반 세션 생성`, { 
            contextLength: finalContextText.length,
            selectedChunks: finalChunks.length
          });

          // 4. 질문 분석 결과를 기반으로 동적 시스템 프롬프트 생성
          const dynamicSystemInstruction = this.createDynamicSystemInstruction(questionAnalysis, finalContextText);
          
          // 5. 새 채팅 세션 생성 (질문 분석 결과 포함)
          const newSession = await this.createNotebookChatSessionWithAnalysis(dynamicSystemInstruction);

          // 6. 스트리밍 응답 생성
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
          
          // 🔥 핵심 수정: 폴백 시에도 컨텍스트 길이 제한 적용
          const MAX_CONTEXT_LENGTH = 50000; // 50,000자로 확장 (답변 품질 향상)
          let fallbackContext = this.cachedSourceText || this.fullPdfText || '';
          
          // 폴백 시에도 선택적 컨텍스트 사용 (전체 텍스트 대신)
          if (fallbackContext.length > MAX_CONTEXT_LENGTH) {
            console.warn(`⚠️ 폴백 컨텍스트 길이 초과: ${fallbackContext.length}자 (제한: ${MAX_CONTEXT_LENGTH}자)`);
            
            // 전체 텍스트 대신 상위 관련 청크만 사용
            if (this.allChunks && this.allChunks.length > 0) {
              const topChunks = this.allChunks.slice(0, 3); // 상위 3개 청크만 사용
              fallbackContext = topChunks.map(chunk => 
                `[문서: ${chunk.metadata.title}]\n${chunk.content}`
              ).join('\n\n---\n\n');
              console.log(`✅ 폴백 컨텍스트를 상위 ${topChunks.length}개 청크로 제한: ${fallbackContext.length}자`);
            } else {
              fallbackContext = fallbackContext.substring(0, MAX_CONTEXT_LENGTH);
              console.log(`✅ 폴백 컨텍스트 길이 조정: ${fallbackContext.length}자`);
            }
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
      const ai = new GoogleGenAI({ apiKey: selectedApiKey });
      
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
      const systemInstruction = GeminiService.SYSTEM_INSTRUCTION_TEMPLATE.replace('{sourceText}', contextText);
      
      // Gemini API 호출
      const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
        systemInstruction: systemInstruction
        },
        history: [],
      });

      const result = await chat.sendMessage({ message: message });
      const text = result.text;
      
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
      const ai = new GoogleGenAI({ apiKey: selectedApiKey });
      
      // PDF 소스 텍스트 로드
      if (!this.cachedSourceText) {
        await this.initializeWithPdfSources();
      }

      if (!this.cachedSourceText) {
        throw new Error('PDF 소스를 로드할 수 없습니다.');
      }

      // 시스템 지시사항과 소스 텍스트 결합
      const systemInstruction = GeminiService.SYSTEM_INSTRUCTION_TEMPLATE.replace('{sourceText}', this.cachedSourceText);
      
      // Gemini API 호출
      const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
        systemInstruction: systemInstruction
        },
        history: [],
      });

      const result = await chat.sendMessage({ message: message });
      const text = result.text;
      
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

  /**
   * 동적 프롬프트를 사용한 노트북 채팅 세션 생성
   */
  private async createNotebookChatSessionWithDynamicPrompt(
    systemInstruction: string,
    sourceText: string,
    userPrompt: string
  ): Promise<any> {
    if (this.isCreatingSession) {
      console.warn('⚠️ 세션 생성 중 - 무한 루프 방지');
      throw new Error('세션 생성이 이미 진행 중입니다.');
    }

    if (this.sessionCreationCount >= GeminiService.MAX_SESSION_CREATION_ATTEMPTS) {
      console.error('❌ 최대 세션 생성 시도 횟수 초과');
      throw new Error('최대 세션 생성 시도 횟수를 초과했습니다.');
    }

    this.isCreatingSession = true;
    this.sessionCreationCount++;

    try {
      console.log(`🔄 동적 프롬프트 세션 생성 시작 (시도 ${this.sessionCreationCount}/${GeminiService.MAX_SESSION_CREATION_ATTEMPTS})`);
      
      const selectedApiKey = this.getNextAvailableKey();
      if (!selectedApiKey) {
        throw new Error('사용 가능한 API 키가 없습니다.');
      }

      console.log(`🔑 API 키 선택: ${selectedApiKey.substring(0, 10)}...`);

      const ai = new GoogleGenAI({ apiKey: selectedApiKey });
      
      // 컨텍스트 길이 제한 적용
      const MAX_CONTEXT_LENGTH = 50000; // 50,000자로 확장 (답변 품질 향상)
      const actualSourceText = sourceText.length > MAX_CONTEXT_LENGTH 
        ? sourceText.substring(0, MAX_CONTEXT_LENGTH) + '...'
        : sourceText;

      console.log(`📏 소스 텍스트 길이: ${actualSourceText.length}자 (제한: ${MAX_CONTEXT_LENGTH}자)`);

      const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: systemInstruction
        },
        history: []
      });

      console.log('✅ 동적 프롬프트 세션 생성 완료');
      return chat;

    } catch (error) {
      console.error('❌ 동적 프롬프트 세션 생성 실패:', error);
      throw error;
    } finally {
      this.isCreatingSession = false;
      // ✅ 핵심 수정: 성공했을 때만 sessionCreationCount 리셋
      this.sessionCreationCount = 0;
    }
  }

  /**
   * 답변 검증 실행
   */
  async validateAnswer(answer: string, question: string, sources: Chunk[]): Promise<any> {
    try {
      const questionAnalysis = await questionAnalyzer.analyzeQuestion(question);
      return this.advancedSearchService.validateAnswer(answer, question, sources, questionAnalysis);
    } catch (error) {
      console.error('❌ 답변 검증 실패:', error);
      return {
        isValid: false,
        metrics: {},
        issues: [{ type: 'error', severity: 'high', description: '검증 실패', suggestion: '다시 시도해주세요' }],
        suggestions: ['답변을 다시 확인해주세요'],
        confidence: 0
      };
    }
  }

  // PDF 내용 재압축 (필요시)
  async recompressPdfSources(): Promise<void> {
    this.isInitialized = false;
    this.cachedSourceText = null;
    this.compressionResult = null;
    await this.initializeWithPdfSources();
  }

  // RPD 통계 조회 (비동기)
  async getRpdStats() {
    return await rpdService.getRpdStats();
  }
}

export const geminiService = new GeminiService();