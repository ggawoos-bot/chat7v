/**
 * Firestore 서비스 클래스
 * PDF 청크 데이터를 Firestore에서 효율적으로 검색하고 관리
 */

import { 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs, 
  addDoc, 
  doc, 
  getDoc,
  writeBatch,
  QuerySnapshot,
  DocumentData,
  Timestamp
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import { FirestoreCacheService } from './firestoreCacheService';

export interface PDFChunk {
  id?: string;
  documentId: string;
  content: string;
  keywords: string[];
  embedding?: number[]; // ✅ 추가: 벡터 임베딩
  embeddingModel?: string; // ✅ 추가: 어떤 모델로 생성했는지
  metadata: {
    page?: number; // 뷰어 인덱스 (하위 호환성)
    pageIndex?: number; // 뷰어 인덱스 (PDF.js에서 사용하는 1-based 인덱스)
    logicalPageNumber?: number; // 논리적 페이지 번호 (문서에 인쇄된 페이지 번호)
    section?: string;
    position: number;
    startPos: number;
    endPos: number;
    originalSize: number;
    title?: string;      // ✅ 문서 제목
    source?: string;     // ✅ 문서 출처
  };
  searchableText: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PDFDocument {
  id: string;
  title: string;
  filename: string;
  totalChunks: number;
  totalPages: number;  // ✅ 추가: PDF 총 페이지 수
  totalSize: number;
  processedAt: Timestamp;
  version: string;
  metadata: {
    source: string;
    title: string;
  };
}

export class FirestoreService {
  private static instance: FirestoreService;
  private readonly chunksCollection = 'pdf_chunks';
  private readonly documentsCollection = 'pdf_documents';
  private firestoreCache: FirestoreCacheService;

  private constructor() {
    this.firestoreCache = FirestoreCacheService;
  }

  public static getInstance(): FirestoreService {
    if (!FirestoreService.instance) {
      FirestoreService.instance = new FirestoreService();
    }
    return FirestoreService.instance;
  }

  /**
   * 키워드로 청크 검색 (캐싱 적용)
   */
  async searchChunksByKeywords(
    keywords: string[], 
    documentId?: string, 
    limitCount: number = 15
  ): Promise<PDFChunk[]> {
    try {
      console.log(`🔍 Firestore 검색 시작: 키워드 ${keywords.length}개, 문서 ${documentId || '전체'}`);
      console.log(`🔍 검색 키워드:`, keywords);
      
      // 1. 캐시에서 먼저 조회
      const cached = await this.firestoreCache.getCachedSearchResults(keywords, documentId);
      if (cached) {
        console.log('📦 캐시에서 키워드 검색 결과 조회');
        return cached.slice(0, limitCount);
      }

      // 2. Firestore에서 검색
      console.log('🔥 Firestore에서 키워드 검색');
      const chunks = await this.fetchChunksFromFirestore(keywords, documentId, limitCount);
      
      // 3. 캐시에 저장
      await this.firestoreCache.setCachedSearchResults(keywords, documentId, chunks);
      
      return chunks;
    } catch (error) {
      console.error('❌ Firestore 검색 오류:', error);
      console.error('❌ 오류 상세:', error.message);
      console.error('❌ 오류 스택:', error.stack);
      return [];
    }
  }

  /**
   * Firestore에서 실제 청크 검색 (내부 메서드)
   */
  private async fetchChunksFromFirestore(
    keywords: string[], 
    documentId?: string, 
    limitCount: number = 15
  ): Promise<PDFChunk[]> {
    // ✅ 개선: 충분한 수량 조회 (30개 → 1000개)
    let q = query(
      collection(db, this.chunksCollection),
      limit(1000)
    );

    console.log(`🔍 Firestore 쿼리 실행 중...`);
    const snapshot = await getDocs(q);
    console.log(`🔍 Firestore 쿼리 결과: ${snapshot.size}개 문서 조회됨`);
    
    const chunksWithScore: Array<{chunk: PDFChunk, score: number}> = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data() as PDFChunk;
      
      // 클라이언트 사이드에서 필터링
      if (documentId && data.documentId !== documentId) {
        return;
      }
      
      // ✅ 개선: 키워드 매칭 점수 계산
      const matchScore = this.calculateKeywordMatchScore(keywords, data);
      
      // 0점 이상만 포함
      if (matchScore > 0) {
        chunksWithScore.push({
          chunk: {
            id: doc.id,
            ...data
          },
          score: matchScore
        });
        
        // ✅ 디버깅: 매칭된 청크 정보 로그
        console.log(`📝 청크 매칭: 점수 ${matchScore.toFixed(2)}`, {
          keywords: data.keywords?.slice(0, 5),
          contentPreview: data.content?.substring(0, 100),
          documentId: data.documentId,
          page: data.metadata?.page,
          section: data.metadata?.section
        });
      }
    });

    // ✅ 관련성 점수 순으로 정렬
    chunksWithScore.sort((a, b) => b.score - a.score);
    
    const sortedChunks = chunksWithScore.map(item => item.chunk);
    const limitedChunks = sortedChunks.slice(0, limitCount);
    
    console.log(`✅ Firestore 검색 완료: ${limitedChunks.length}개 청크 발견 (전체 ${sortedChunks.length}개 중, 최고 점수: ${chunksWithScore[0]?.score.toFixed(2) || 0})`);
    return limitedChunks;
  }

  /**
   * 키워드 매칭 점수 계산
   */
  private calculateKeywordMatchScore(keywords: string[], data: PDFChunk): number {
    let score = 0;
    
    keywords.forEach(keyword => {
      const keywordLower = keyword.toLowerCase();
      const contentLower = (data.content || '').toLowerCase();
      const searchableTextLower = (data.searchableText || '').toLowerCase();
      
      // 1. keywords 배열에서 정확히 매칭 (높은 점수)
      if (data.keywords) {
        data.keywords.forEach(k => {
          const kLower = k.toLowerCase();
          if (kLower === keywordLower) {
            score += 10; // 정확한 일치
          } else if (kLower.includes(keywordLower) || keywordLower.includes(kLower)) {
            score += 3; // 부분 일치
          }
        });
      }
      
      // 2. content에서 키워드가 포함된 경우
      if (contentLower.includes(keywordLower)) {
        score += 5; // content에서 발견
      }
      
      // 3. searchableText에서 키워드가 포함된 경우 (추가 점수)
      if (searchableTextLower.includes(keywordLower)) {
        score += 2; // searchableText에서 발견
      }
      
      // 4. content에서 키워드가 여러 번 나타나는 경우 (추가 점수)
      const keywordCount = (contentLower.match(new RegExp(keywordLower, 'g')) || []).length;
      if (keywordCount > 1) {
        score += Math.min(keywordCount - 1, 5); // 최대 5점까지
      }
    });
    
    return score;
  }

  /**
   * 텍스트 검색 (캐싱 적용)
   */
  async searchChunksByText(
    searchText: string, 
    documentId?: string, 
    limitCount: number = 10
  ): Promise<PDFChunk[]> {
    try {
      console.log(`🔍 Firestore 텍스트 검색: "${searchText}"`);
      
      // 1. 캐시에서 먼저 조회
      const cached = await this.firestoreCache.getCachedTextSearchResults(searchText, documentId);
      if (cached) {
        console.log('📦 캐시에서 텍스트 검색 결과 조회');
        return cached.slice(0, limitCount);
      }

      // 2. Firestore에서 검색
      console.log('🔥 Firestore에서 텍스트 검색');
      const chunks = await this.fetchChunksByTextFromFirestore(searchText, documentId, limitCount);
      
      // 3. 캐시에 저장
      await this.firestoreCache.setCachedTextSearchResults(searchText, documentId, chunks);
      
      return chunks;
    } catch (error) {
      console.error('❌ Firestore 텍스트 검색 오류:', error);
      return [];
    }
  }

  /**
   * Firestore에서 실제 텍스트 검색 (내부 메서드)
   */
  private async fetchChunksByTextFromFirestore(
    searchText: string, 
    documentId?: string, 
    limitCount: number = 10
  ): Promise<PDFChunk[]> {
    // ✅ 개선: 충분한 수량 조회
    let q = query(
      collection(db, this.chunksCollection),
      limit(1000)
    );

    const snapshot = await getDocs(q);
    const chunksWithScore: Array<{chunk: PDFChunk, score: number}> = [];
    const searchTextLower = searchText.toLowerCase();
    
    snapshot.forEach((doc) => {
      const data = doc.data() as PDFChunk;
      
      // 클라이언트 사이드에서 필터링
      if (documentId && data.documentId !== documentId) {
        return;
      }
      
      // ✅ 개선: 텍스트 매칭 점수 계산
      let score = 0;
      
      // searchableText에서 검색
      if (data.searchableText && data.searchableText.toLowerCase().includes(searchTextLower)) {
        score += 5;
        
        // 정확한 텍스트 매칭 확인
        const searchableTextLower = data.searchableText.toLowerCase();
        if (searchableTextLower.includes(searchTextLower)) {
          score += 3;
        }
      }
      
      // content에서도 검색
      if (data.content && data.content.toLowerCase().includes(searchTextLower)) {
        score += 2;
      }
      
      // keywords에서도 검색
      if (data.keywords) {
        data.keywords.forEach(k => {
          if (k.toLowerCase().includes(searchTextLower)) {
            score += 1;
          }
        });
      }
      
      if (score > 0) {
        chunksWithScore.push({
          chunk: {
            id: doc.id,
            ...data
          },
          score
        });
      }
    });

    // ✅ 관련성 점수 순으로 정렬
    chunksWithScore.sort((a, b) => b.score - a.score);
    
    const sortedChunks = chunksWithScore.map(item => item.chunk);
    const limitedChunks = sortedChunks.slice(0, limitCount);
    
    console.log(`✅ Firestore 텍스트 검색 완료: ${limitedChunks.length}개 청크 발견 (전체 ${sortedChunks.length}개 중, 최고 점수: ${chunksWithScore[0]?.score.toFixed(2) || 0})`);
    return limitedChunks;
  }

  /**
   * 특정 문서의 모든 청크 가져오기 (캐싱 적용)
   */
  async getChunksByDocument(documentId: string): Promise<PDFChunk[]> {
    try {
      console.log(`📄 문서 청크 가져오기: ${documentId}`);
      
      // 1. 캐시에서 먼저 조회
      const cached = await this.firestoreCache.getCachedChunks(documentId);
      if (cached) {
        console.log(`📦 캐시에서 문서 청크 조회: ${documentId}`);
        return cached;
      }

      // 2. Firestore에서 조회
      console.log(`🔥 Firestore에서 문서 청크 조회: ${documentId}`);
      const chunks = await this.fetchChunksByDocumentFromFirestore(documentId);
      
      // 3. 캐시에 저장
      await this.firestoreCache.setCachedChunks(documentId, chunks);
      
      return chunks;
    } catch (error) {
      console.error('❌ 문서 청크 로드 오류:', error);
      return [];
    }
  }

  /**
   * Firestore에서 실제 문서 청크 조회 (내부 메서드)
   */
  private async fetchChunksByDocumentFromFirestore(documentId: string): Promise<PDFChunk[]> {
    // 단순한 쿼리로 변경 (인덱스 문제 해결)
    const q = query(
      collection(db, this.chunksCollection),
      limit(1000) // 충분한 수량 가져오기
    );

    const snapshot = await getDocs(q);
    const chunks: PDFChunk[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data() as PDFChunk;
      
      // 클라이언트 사이드에서 필터링
      if (data.documentId === documentId) {
        chunks.push({
          id: doc.id,
          ...data
        });
      }
    });

    // 위치 순으로 정렬
    chunks.sort((a, b) => {
      const posA = a.metadata?.position || 0;
      const posB = b.metadata?.position || 0;
      return posA - posB;
    });

    console.log(`✅ 문서 청크 로드 완료: ${chunks.length}개`);
    return chunks;
  }

  /**
   * 특정 문서 ID로 문서 정보 가져오기
   */
  async getDocumentById(documentId: string): Promise<PDFDocument | null> {
    try {
      console.log(`📄 문서 정보 조회: ${documentId}`);
      
      const docRef = doc(collection(db, this.documentsCollection), documentId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data() as PDFDocument;
        console.log(`✅ 문서 정보 조회 성공: ${data.title}`);
        return {
          id: docSnap.id,
          ...data
        };
      } else {
        console.warn(`⚠️ 문서를 찾을 수 없음: ${documentId}`);
        return null;
      }
    } catch (error) {
      console.error('❌ 문서 정보 조회 오류:', error);
      return null;
    }
  }

  /**
   * 모든 PDF 문서 목록 가져오기 (캐싱 적용)
   */
  async getAllDocuments(): Promise<PDFDocument[]> {
    try {
      console.log('📋 모든 PDF 문서 목록 가져오기');
      
      // 1. 캐시에서 먼저 조회
      const cached = await this.firestoreCache.getCachedDocuments();
      if (cached) {
        console.log('📦 캐시에서 문서 목록 조회');
        return cached;
      }

      // 2. Firestore에서 조회
      console.log('🔥 Firestore에서 문서 목록 조회');
      const documents = await this.fetchDocumentsFromFirestore();
      
      // 3. 캐시에 저장
      await this.firestoreCache.setCachedDocuments(documents);
      
      return documents;
    } catch (error) {
      console.error('❌ 문서 목록 로드 오류:', error);
      console.error('❌ 오류 상세:', error.message);
      console.error('❌ 오류 스택:', error.stack);
      return [];
    }
  }

  /**
   * Firestore에서 실제 문서 목록 조회 (내부 메서드)
   */
  private async fetchDocumentsFromFirestore(): Promise<PDFDocument[]> {
    // 단순한 쿼리로 변경 (인덱스 문제 해결)
    const q = query(
      collection(db, this.documentsCollection)
    );

    console.log('🔍 Firestore 문서 쿼리 실행 중...');
    const snapshot = await getDocs(q);
    console.log(`🔍 Firestore 문서 쿼리 결과: ${snapshot.size}개 문서 조회됨`);
    
    const documents: PDFDocument[] = [];
    
    snapshot.forEach((doc) => {
      console.log('🔍 문서 데이터:', {
        id: doc.id,
        data: doc.data()
      });
      documents.push({
        id: doc.id,
        ...doc.data()
      } as PDFDocument);
    });

    console.log(`✅ 문서 목록 로드 완료: ${documents.length}개`);
    return documents;
  }

  /**
   * 청크 데이터 추가 (배치)
   */
  async addChunks(chunks: PDFChunk[]): Promise<boolean> {
    try {
      console.log(`📝 청크 데이터 추가: ${chunks.length}개`);
      
      const batch = writeBatch(db);
      const now = Timestamp.now();

      chunks.forEach((chunk) => {
        const docRef = doc(collection(db, this.chunksCollection));
        batch.set(docRef, {
          ...chunk,
          createdAt: now,
          updatedAt: now
        });
      });

      await batch.commit();
      console.log(`✅ 청크 데이터 추가 완료: ${chunks.length}개`);
      return true;
    } catch (error) {
      console.error('❌ 청크 데이터 추가 오류:', error);
      return false;
    }
  }

  /**
   * PDF 문서 메타데이터 추가
   */
  async addDocument(document: PDFDocument): Promise<boolean> {
    try {
      console.log(`📄 PDF 문서 추가: ${document.filename}`);
      
      const docRef = doc(collection(db, this.documentsCollection), document.id);
      await addDoc(collection(db, this.documentsCollection), {
        ...document,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });

      console.log(`✅ PDF 문서 추가 완료: ${document.filename}`);
      return true;
    } catch (error) {
      console.error('❌ PDF 문서 추가 오류:', error);
      return false;
    }
  }

  /**
   * 하이브리드 검색 (키워드 + 텍스트)
   */
  async hybridSearch(
    searchTerms: string[], 
    documentId?: string, 
    limitCount: number = 10
  ): Promise<PDFChunk[]> {
    try {
      console.log(`🔍 하이브리드 검색: ${searchTerms.join(', ')}`);
      
      // 키워드 검색과 텍스트 검색을 병렬로 실행
      const [keywordResults, textResults] = await Promise.all([
        this.searchChunksByKeywords(searchTerms, documentId, limitCount),
        this.searchChunksByText(searchTerms.join(' '), documentId, limitCount)
      ]);

      // 중복 제거 및 점수 기반 정렬
      const combinedResults = this.mergeAndRankResults(keywordResults, textResults, searchTerms);
      
      console.log(`✅ 하이브리드 검색 완료: ${combinedResults.length}개 청크`);
      return combinedResults.slice(0, limitCount);
    } catch (error) {
      console.error('❌ 하이브리드 검색 오류:', error);
      return [];
    }
  }

  /**
   * 벡터 유사도 검색 (새로운 기능)
   */
  async similaritySearch(
    queryEmbedding: number[], 
    documentId?: string, 
    limitCount: number = 10
  ): Promise<PDFChunk[]> {
    try {
      console.log('🔍 벡터 유사도 검색 시작');
      
      // 모든 청크 가져오기
      const q = query(collection(db, this.chunksCollection));
      const snapshot = await getDocs(q);
      
      const chunksWithSimilarity: Array<PDFChunk & { similarity: number }> = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data() as PDFChunk;
        
        // 문서 필터링
        if (documentId && data.documentId !== documentId) {
          return;
        }
        
        // 임베딩이 있는 청크만 처리
        if (data.embedding && data.embedding.length > 0) {
          const similarity = this.cosineSimilarity(queryEmbedding, data.embedding);
          
          chunksWithSimilarity.push({
            id: doc.id,
            ...data,
            similarity
          });
        }
      });
      
      // 유사도 순으로 정렬
      chunksWithSimilarity.sort((a, b) => b.similarity - a.similarity);
      
      const results = chunksWithSimilarity
        .slice(0, limitCount)
        .map(({ similarity, ...chunk }) => chunk);
      
      console.log(`✅ 벡터 검색 완료: ${results.length}개 결과`);
      console.log(`📊 평균 유사도: ${this.calculateAverageSimilarity(chunksWithSimilarity.slice(0, limitCount))}`);
      
      return results;
      
    } catch (error) {
      console.error('❌ 벡터 검색 오류:', error);
      return [];
    }
  }

  /**
   * 코사인 유사도 계산
   */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return 0;
    
    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      mag1 += vec1[i] * vec1[i];
      mag2 += vec2[i] * vec2[i];
    }
    
    mag1 = Math.sqrt(mag1);
    mag2 = Math.sqrt(mag2);
    
    if (mag1 === 0 || mag2 === 0) return 0;
    return dotProduct / (mag1 * mag2);
  }

  /**
   * 평균 유사도 계산
   */
  private calculateAverageSimilarity(chunks: Array<{ similarity: number }>): number {
    if (chunks.length === 0) return 0;
    const sum = chunks.reduce((acc, chunk) => acc + chunk.similarity, 0);
    return sum / chunks.length;
  }

  /**
   * 검색 결과 병합 및 랭킹
   */
  private mergeAndRankResults(
    keywordResults: PDFChunk[], 
    textResults: PDFChunk[], 
    searchTerms: string[]
  ): PDFChunk[] {
    const resultMap = new Map<string, PDFChunk & { score: number }>();

    // 키워드 검색 결과 (높은 점수)
    keywordResults.forEach(chunk => {
      const score = this.calculateKeywordScore(chunk, searchTerms) * 2; // 키워드 매치에 가중치
      resultMap.set(chunk.id || '', { ...chunk, score });
    });

    // 텍스트 검색 결과 (낮은 점수)
    textResults.forEach(chunk => {
      const existing = resultMap.get(chunk.id || '');
      if (existing) {
        existing.score += this.calculateTextScore(chunk, searchTerms);
      } else {
        const score = this.calculateTextScore(chunk, searchTerms);
        resultMap.set(chunk.id || '', { ...chunk, score });
      }
    });

    // 점수 순으로 정렬
    return Array.from(resultMap.values())
      .sort((a, b) => b.score - a.score)
      .map(({ score, ...chunk }) => chunk);
  }

  /**
   * 키워드 점수 계산
   */
  private calculateKeywordScore(chunk: PDFChunk, searchTerms: string[]): number {
    let score = 0;
    searchTerms.forEach(term => {
      if (chunk.keywords.some(keyword => 
        keyword.toLowerCase().includes(term.toLowerCase())
      )) {
        score += 1;
      }
    });
    return score;
  }

  /**
   * 텍스트 점수 계산
   */
  private calculateTextScore(chunk: PDFChunk, searchTerms: string[]): number {
    let score = 0;
    const content = chunk.content.toLowerCase();
    const searchableText = chunk.searchableText.toLowerCase();
    
    searchTerms.forEach(term => {
      const termLower = term.toLowerCase();
      if (content.includes(termLower)) score += 0.5;
      if (searchableText.includes(termLower)) score += 0.3;
    });
    
    return score;
  }

  /**
   * 데이터베이스 상태 확인 (IndexedDB 캐시 우선 확인)
   */
  async getDatabaseStats(): Promise<{
    totalChunks: number;
    totalDocuments: number;
    lastUpdated: string;
    source: 'firestore' | 'cache';
  }> {
    try {
      // ✅ 1. 먼저 IndexedDB 캐시 확인
      const cachedDocs = await this.firestoreCache.getCachedDocuments();
      if (cachedDocs && cachedDocs.length > 0) {
        console.log(`📦 IndexedDB 캐시에서 ${cachedDocs.length}개 문서 발견`);
        
        // 캐시된 문서의 청크 수 계산
        let totalChunks = 0;
        for (const doc of cachedDocs) {
          const cachedChunks = await this.firestoreCache.getCachedChunks(doc.id);
          if (cachedChunks) {
            totalChunks += cachedChunks.length;
          }
        }
        
        if (totalChunks > 0) {
          console.log(`📦 IndexedDB 캐시에서 총 ${totalChunks}개 청크 발견`);
          return {
            totalChunks,
            totalDocuments: cachedDocs.length,
            lastUpdated: new Date().toISOString(),
            source: 'cache'
          };
        }
      }
      
      // ✅ 2. 캐시가 없으면 Firestore 확인
      const [chunksSnapshot, docsSnapshot] = await Promise.all([
        getDocs(collection(db, this.chunksCollection)),
        getDocs(collection(db, this.documentsCollection))
      ]);

      return {
        totalChunks: chunksSnapshot.size,
        totalDocuments: docsSnapshot.size,
        lastUpdated: new Date().toISOString(),
        source: 'firestore'
      };
    } catch (error) {
      console.error('❌ 데이터베이스 상태 확인 오류:', error);
      
      // ✅ 3. 에러 발생 시에도 캐시 재확인
      try {
        const cachedDocs = await this.firestoreCache.getCachedDocuments();
        if (cachedDocs && cachedDocs.length > 0) {
          console.log(`📦 에러 발생, 캐시에서 ${cachedDocs.length}개 문서 발견`);
          let totalChunks = 0;
          for (const doc of cachedDocs) {
            const cachedChunks = await this.firestoreCache.getCachedChunks(doc.id);
            if (cachedChunks) {
              totalChunks += cachedChunks.length;
            }
          }
          
          if (totalChunks > 0) {
            return {
              totalChunks,
              totalDocuments: cachedDocs.length,
              lastUpdated: new Date().toISOString(),
              source: 'cache'
            };
          }
        }
      } catch (cacheError) {
        console.warn('⚠️ 캐시 확인 중 오류:', cacheError);
      }
      
      return {
        totalChunks: 0,
        totalDocuments: 0,
        lastUpdated: new Date().toISOString(),
        source: 'firestore'
      };
    }
  }

  /**
   * 캐시 무효화 (데이터 업데이트 시)
   */
  invalidateCache(): void {
    this.firestoreCache.clearAllFirestoreCache();
    console.log('🗑️ Firestore 캐시 무효화');
  }

  /**
   * 특정 문서 캐시 무효화
   */
  invalidateDocumentCache(documentId: string): void {
    this.firestoreCache.clearDocumentCache(documentId);
    console.log(`🗑️ 문서 캐시 무효화: ${documentId}`);
  }

  /**
   * 캐시 상태 확인
   */
  getCacheStatus(): any {
    return this.firestoreCache.getCacheStatus();
  }
}

export default FirestoreService;
