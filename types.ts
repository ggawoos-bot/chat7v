export const Role = {
  USER: 'user',
  MODEL: 'model',
} as const;

export type Role = typeof Role[keyof typeof Role];

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: Date;
  sources?: string[];
  chunkReferences?: ChunkReference[];
}

export interface ChunkReference {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  page?: number;
  section?: string;
  content: string;
  filename?: string; // ✅ PDF 파일명 추가
  documentFilename?: string; // ✅ 별칭 추가
  metadata?: {
    startPos: number;
    endPos: number;
    position: number;
    source?: string; // ✅ 추가
  };
}

export interface SourceInfo {
  id: string;
  title: string;
  content: string;
  type: 'pdf' | 'text' | 'url';
  section?: string;
  page?: number;
  documentType?: 'legal' | 'guideline';
}

export interface Chunk {
  id: string;
  documentId?: string;  // ✅ 추가: Firestore document ID
  content: string;
  metadata: {
    source: string;
    title: string;
    page: number; // 뷰어 인덱스 (하위 호환성)
    pageIndex?: number; // 뷰어 인덱스 (PDF.js에서 사용하는 1-based 인덱스)
    logicalPageNumber?: number; // 논리적 페이지 번호 (문서에 인쇄된 페이지 번호)
    section: string;
    position: number;
    startPosition: number;
    endPosition: number;
    originalSize: number;
    documentType?: 'legal' | 'guideline';
  };
  keywords: string[];
  location: {
    document: string;
    section: string;
    page: number; // 뷰어 인덱스
    logicalPageNumber?: number; // 논리적 페이지 번호
  };
  relevanceScore?: number;
}

export interface QuestionAnalysis {
  intent: string;
  keywords: string[];
  expandedKeywords?: string[];
  category: 'definition' | 'procedure' | 'regulation' | 'comparison' | 'analysis' | 'general';
  complexity: 'simple' | 'medium' | 'complex';
  entities: string[];
  context: string;
}